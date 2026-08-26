import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export interface RemoteMastraBundleManifest {
  archiveHash: string
  architecture: 'arm64' | 'x64'
  nodeHash: string
  nodeVersion: string
  releaseVersion: string
}

export interface RemoteMastraSsh {
  exec(command: string, options?: { stdinData?: Buffer | string; timeoutMs?: number }): Promise<string>
  forward(localPort: number, remotePort: number, remoteHost?: string): Promise<void>
}

export interface RemoteMastraConnection {
  baseUrl: string
  instanceId: string
  jwtSecret: string
  localPort: number
  remotePort: number
  runtimeVersion: string
}

const REMOTE_MASTRA_PORT = 4112
const REMOTE_ROOT = '"$HOME/.hermes/mastra"'

function validateManifest(value: unknown): RemoteMastraBundleManifest {
  const manifest = value as Partial<RemoteMastraBundleManifest>
  if (
    !manifest ||
    !/^[a-f0-9]{64}$/.test(manifest.archiveHash || '') ||
    !['arm64', 'x64'].includes(manifest.architecture || '') ||
    !/^[a-f0-9]{64}$/.test(manifest.nodeHash || '') ||
    !/^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(manifest.nodeVersion || '') ||
    !/^[a-zA-Z0-9._-]{1,128}$/.test(manifest.releaseVersion || '')
  ) {
    throw new Error('The packaged Orgo Mastra runtime manifest is invalid.')
  }
  return manifest as RemoteMastraBundleManifest
}

export function remoteArchitecture(uname: string): 'arm64' | 'x64' {
  const normalized = uname.trim().toLowerCase()
  if (['aarch64', 'arm64'].includes(normalized)) return 'arm64'
  if (['amd64', 'x86_64'].includes(normalized)) return 'x64'
  throw new Error(`The Orgo computer architecture is unsupported (${normalized || 'unknown'}).`)
}

export function loadRemoteMastraBundle(directory: string, architecture: 'arm64' | 'x64') {
  const archivePath = path.join(directory, `linux-${architecture}.tar.gz`)
  const manifestPath = path.join(directory, `linux-${architecture}.json`)
  if (!fs.existsSync(archivePath) || !fs.existsSync(manifestPath)) {
    throw new Error(
      `The packaged Linux Mastra runtime for ${architecture} is missing. ` +
      'Install a Korgo Bot release that includes the Orgo runtime bundle.'
    )
  }
  const archive = fs.readFileSync(archivePath)
  const manifest = validateManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')))
  const actualHash = crypto.createHash('sha256').update(archive).digest('hex')
  if (manifest.architecture !== architecture || manifest.archiveHash !== actualHash) {
    throw new Error('The packaged Orgo Mastra runtime failed its architecture or bundle hash check.')
  }
  return { archive, manifest }
}

function parseRuntimeEnvironment(value: string): { instanceId: string; jwtSecret: string; version: string } | null {
  const entries = Object.fromEntries(value.split(/\r?\n/).flatMap(line => {
    const match = /^([A-Z0-9_]+)='([a-zA-Z0-9._:-]+)'$/.exec(line.trim())
    return match ? [[match[1], match[2]]] : []
  }))
  return entries.KORGO_MASTRA_INSTANCE_ID && entries.KORGO_MASTRA_JWT_SECRET && entries.KORGO_MASTRA_RUNTIME_VERSION
    ? {
        instanceId: entries.KORGO_MASTRA_INSTANCE_ID,
        jwtSecret: entries.KORGO_MASTRA_JWT_SECRET,
        version: entries.KORGO_MASTRA_RUNTIME_VERSION
      }
    : null
}

function shellQuotedEnvironmentValue(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error('Remote Mastra configuration contains a line break or null byte.')
  return `'${value.replaceAll("'", "'\\''")}'`
}

function runtimeEnvironment(input: {
  hermesApiKey: string
  hermesPort: number
  instanceId: string
  jwtSecret: string
  profile: string
  releaseVersion: string
}): string {
  const values = {
    KORGO_HERMES_API_KEY: input.hermesApiKey,
    KORGO_HERMES_PROFILE: input.profile,
    KORGO_HERMES_URL: `http://127.0.0.1:${input.hermesPort}`,
    KORGO_MASTRA_INSTANCE_ID: input.instanceId,
    KORGO_MASTRA_JWT_SECRET: input.jwtSecret,
    KORGO_MASTRA_PORT: String(REMOTE_MASTRA_PORT),
    KORGO_MASTRA_RUNTIME_LOCATION: 'orgo',
    KORGO_MASTRA_RUNTIME_VERSION: input.releaseVersion
  }
  return [
    ...Object.entries(values).map(([key, value]) => `${key}=${shellQuotedEnvironmentValue(value)}`),
    'KORGO_MASTRA_DATA_DIR="$HOME/.hermes/mastra/data"'
  ].join('\n') + '\n'
}

export async function provisionRemoteMastra(input: {
  bundleDirectory: string
  hermesApiKey: string
  hermesPort: number
  pickLocalPort(): Promise<number>
  profile: string
  ssh: RemoteMastraSsh
}): Promise<RemoteMastraConnection> {
  const architecture = remoteArchitecture(await input.ssh.exec('uname -m', { timeoutMs: 10_000 }))
  const { archive, manifest } = loadRemoteMastraBundle(input.bundleDirectory, architecture)
  const releaseDirectory = `${REMOTE_ROOT}/releases/${manifest.releaseVersion}-${manifest.archiveHash.slice(0, 12)}`
  const remoteIdentity = `${manifest.releaseVersion}:${manifest.archiveHash}`
  const installedIdentity = (await input.ssh.exec(
    `test -r ${REMOTE_ROOT}/runtime.manifest && cat ${REMOTE_ROOT}/runtime.manifest || true`,
    { timeoutMs: 10_000 }
  )).trim()
  if (installedIdentity !== remoteIdentity) {
    await input.ssh.exec(
      `umask 077; mkdir -p ${releaseDirectory}; tar -xzf - -C ${releaseDirectory}; ` +
      `printf '%s' '${remoteIdentity}' > ${REMOTE_ROOT}/runtime.manifest`,
      { stdinData: archive, timeoutMs: 5 * 60_000 }
    )
  }
  const bundledNodeIdentity = (await input.ssh.exec(
    `test -x ${releaseDirectory}/node && ` +
    `printf '%s:' "$(${releaseDirectory}/node -p 'process.versions.node')" && ` +
    `sha256sum ${releaseDirectory}/node | awk '{print $1}' || true`,
    { timeoutMs: 10_000 }
  )).trim()
  if (bundledNodeIdentity !== `${manifest.nodeVersion}:${manifest.nodeHash}`) {
    throw new Error('The pinned Orgo Node runtime is missing or does not match its bundle manifest.')
  }

  const existingEnvironment = await input.ssh.exec(
    `test -r ${REMOTE_ROOT}/runtime.env && cat ${REMOTE_ROOT}/runtime.env || true`,
    { timeoutMs: 10_000 }
  )
  const existing = parseRuntimeEnvironment(existingEnvironment)
  const alive = existing?.version === manifest.releaseVersion && (await input.ssh.exec(
    `test -s ${REMOTE_ROOT}/runtime.pid && kill -0 "$(cat ${REMOTE_ROOT}/runtime.pid)" 2>/dev/null && echo yes || true`,
    { timeoutMs: 10_000 }
  )).trim() === 'yes'

  const instanceId = alive ? existing!.instanceId : crypto.randomBytes(16).toString('hex')
  const jwtSecret = alive ? existing!.jwtSecret : crypto.randomBytes(32).toString('base64url')
  if (!alive) {
    const environment = runtimeEnvironment({
      hermesApiKey: input.hermesApiKey,
      hermesPort: input.hermesPort,
      instanceId,
      jwtSecret,
      profile: input.profile,
      releaseVersion: manifest.releaseVersion
    })
    await input.ssh.exec(
      `umask 077; mkdir -p ${REMOTE_ROOT}/data ${REMOTE_ROOT}/logs; cat > ${REMOTE_ROOT}/runtime.env; ` +
      `chmod 600 ${REMOTE_ROOT}/runtime.env`,
      { stdinData: environment, timeoutMs: 10_000 }
    )
    await input.ssh.exec(
      `if test -s ${REMOTE_ROOT}/runtime.pid; then old="$(cat ${REMOTE_ROOT}/runtime.pid)"; ` +
      `kill "$old" 2>/dev/null || true; fi; ` +
      `set -a; . ${REMOTE_ROOT}/runtime.env; set +a; ` +
      `nohup ${releaseDirectory}/node ${releaseDirectory}/index.mjs >> ${REMOTE_ROOT}/logs/runtime.log 2>&1 < /dev/null & ` +
      `echo $! > ${REMOTE_ROOT}/runtime.pid`,
      { timeoutMs: 10_000 }
    )
  }

  const localPort = await input.pickLocalPort()
  await input.ssh.forward(localPort, REMOTE_MASTRA_PORT)
  return {
    baseUrl: `http://127.0.0.1:${localPort}`,
    instanceId,
    jwtSecret,
    localPort,
    remotePort: REMOTE_MASTRA_PORT,
    runtimeVersion: manifest.releaseVersion
  }
}
