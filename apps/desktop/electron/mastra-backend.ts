import type { ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export interface MastraSpawnSpec {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  healthUrl: string
  instanceId: string
}

export function resolveManagedNode(
  hermesHome: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform = process.platform,
  exists: (candidate: string) => boolean = fs.existsSync
): string {
  const candidates = [
    environment.npm_node_execpath,
    environment.NODE,
    platform === 'win32'
      ? path.win32.join(hermesHome, 'node', 'node.exe')
      : path.posix.join(hermesHome, 'node', 'bin', 'node')
  ].filter((candidate): candidate is string => Boolean(candidate))

  return candidates.find(exists) || 'node'
}

export function buildMastraSpawnSpec(options: {
  hermesRoot: string
  hermesHome: string
  hermesBaseUrl: string
  hermesApiKey: string
  jwtSecret: string
  instanceId: string
  profile?: string | null
  environment?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  exists?: (candidate: string) => boolean
}): MastraSpawnSpec {
  const mastraDirectory = path.join(options.hermesRoot, 'apps', 'mastra')
  const output = path.join(mastraDirectory, '.mastra', 'output', 'index.mjs')
  const studio = path.join(mastraDirectory, '.mastra', 'output', 'studio')
  const exists = options.exists || fs.existsSync

  if (!exists(output)) {
    throw new Error(`Mastra build output is missing at ${output}`)
  }

  return {
    command: resolveManagedNode(options.hermesHome, options.environment, options.platform, exists),
    args: [output],
    cwd: mastraDirectory,
    healthUrl: 'http://127.0.0.1:4112/korgo/health',
    instanceId: options.instanceId,
    env: {
      ...options.environment,
      KORGO_HERMES_API_KEY: options.hermesApiKey,
      KORGO_HERMES_URL: options.hermesBaseUrl,
      KORGO_HERMES_PROFILE: options.profile || 'default',
      KORGO_MASTRA_PORT: '4112',
      KORGO_MASTRA_JWT_SECRET: options.jwtSecret,
      KORGO_MASTRA_INSTANCE_ID: options.instanceId,
      MASTRA_STUDIO_PATH: studio
    }
  }
}

export async function waitForMastraReady(options: {
  healthUrl: string
  child: Pick<ChildProcess, 'exitCode' | 'killed'>
  expectedInstanceId: string
  fetchImplementation?: typeof fetch
  timeoutMs?: number
}): Promise<void> {
  const fetchImplementation = options.fetchImplementation || fetch
  const deadline = Date.now() + (options.timeoutMs || 30_000)

  while (Date.now() < deadline) {
    if (options.child.exitCode !== null || options.child.killed) {
      throw new Error('Mastra exited before it became ready.')
    }

    try {
      const response = await fetchImplementation(options.healthUrl, { signal: AbortSignal.timeout(1_000) })

      if (response.ok) {
        const body = await response.json() as { instanceId?: unknown; ok?: unknown; service?: unknown }

        if (
          body.ok === true &&
          body.service === 'hermes-mastra-local' &&
          body.instanceId === options.expectedInstanceId
        ) {
          return
        }
      }
    } catch {
      // Cold start: retry until the bounded deadline.
    }

    await new Promise(resolve => setTimeout(resolve, 200))
  }

  throw new Error('Timed out waiting for the Mastra orchestration service.')
}
