#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const releaseRoot = join(import.meta.dirname, '..', 'release')

async function findRuntime(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const candidate = join(directory, entry.name)
    if (entry.isDirectory()) {
      const found = await findRuntime(candidate)
      if (found) return found
    } else if (entry.name === 'index.mjs' && basename(join(candidate, '..')) === 'mastra') {
      return candidate
    }
  }
  return null
}

function jwt(secret) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1_000)
  const header = encode({ alg: 'HS256', typ: 'JWT' })
  const payload = encode({ aud: 'hermes-mastra-local', exp: now + 60, iat: now, jti: randomUUID(), sub: 'hermes-desktop' })
  const unsigned = `${header}.${payload}`
  return `${unsigned}.${createHmac('sha256', secret).update(unsigned).digest('base64url')}`
}

const runtime = await findRuntime(releaseRoot)
if (!runtime || !(await stat(runtime)).isFile()) throw new Error(`Packaged Mastra runtime not found below ${releaseRoot}.`)
const dataDirectory = await mkdtemp(join(tmpdir(), 'hermes-mastra-package-'))
const secret = randomBytes(32).toString('base64url')
const instanceId = randomUUID()
const port = 41_912 + Math.floor(Math.random() * 2_000)
const child = spawn(process.execPath, [runtime], {
  env: {
    ...process.env,
    KORGO_MASTRA_DATA_DIR: dataDirectory,
    KORGO_MASTRA_INSTANCE_ID: instanceId,
    KORGO_MASTRA_JWT_SECRET: secret,
    KORGO_MASTRA_PORT: String(port)
  },
  stdio: ['ignore', 'pipe', 'pipe']
})
let output = ''
child.stdout.on('data', data => { output += String(data) })
child.stderr.on('data', data => { output += String(data) })

try {
  const deadline = Date.now() + 45_000
  let health
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged Mastra exited early (${child.exitCode}).\n${output.slice(-4_000)}`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/korgo/health`, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) {
        health = await response.json()
        break
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  if (health?.instanceId !== instanceId) throw new Error(`Packaged Mastra health identity failed.\n${output.slice(-4_000)}`)

  const anonymous = await fetch(`http://127.0.0.1:${port}/korgo/runs`)
  if (anonymous.status !== 401) throw new Error(`Anonymous packaged run access returned ${anonymous.status}, expected 401.`)
  const authorized = await fetch(`http://127.0.0.1:${port}/korgo/runs?limit=1`, {
    headers: { Authorization: `Bearer ${jwt(secret)}` }
  })
  if (!authorized.ok) throw new Error(`Authenticated packaged run access returned ${authorized.status}.`)
  console.log(JSON.stringify({ ok: true, runtime, health, anonymousStatus: anonymous.status }, null, 2))
} finally {
  child.kill('SIGTERM')
}
