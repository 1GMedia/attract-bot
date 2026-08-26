#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readdir, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
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
const port = 41_912 + Math.floor(Math.random() * 2_000)
const hermesPort = port + 2_001
const baseUrl = `http://127.0.0.1:${port}`
const headers = { Authorization: `Bearer ${jwt(secret)}`, 'Content-Type': 'application/json' }
let hermesExecutions = 0
let child
let output = ''

const fakeHermes = createServer((request, response) => {
  if (request.method === 'POST' && request.url?.endsWith('/v1/model/chat/completions')) {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({
      id: 'packaged-smoke-model-completion',
      choices: [{ message: { content: 'Require approval, then retain completion evidence.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 6, completion_tokens: 6, total_tokens: 12 }
    }))
    return
  }
  if (request.method !== 'POST' || !request.url?.endsWith('/v1/chat/completions')) {
    response.writeHead(404).end()
    return
  }
  hermesExecutions += 1
  response.writeHead(200, {
    'Content-Type': 'application/json',
    'X-Hermes-Session-Id': 'packaged-smoke-session'
  })
  response.end(JSON.stringify({
    id: 'packaged-smoke-completion',
    choices: [{ message: { content: 'Read-only packaged Hermes evidence.' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
    hermes: { completed: true }
  }))
})

function waitForServer(server, listenPort) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(listenPort, '127.0.0.1', resolve)
  })
}

function closeServer(server) {
  return new Promise(resolve => server.close(resolve))
}

async function stopRuntime() {
  if (!child || child.exitCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGTERM')
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 10_000))])
  if (child.exitCode === null) child.kill('SIGKILL')
}

async function startRuntime(instanceId) {
  child = spawn(process.execPath, [runtime], {
    env: {
      ...process.env,
      KORGO_HERMES_API_KEY: 'packaged-smoke-hermes-key',
      KORGO_HERMES_URL: `http://127.0.0.1:${hermesPort}`,
      KORGO_MASTRA_DATA_DIR: dataDirectory,
      KORGO_MASTRA_INSTANCE_ID: instanceId,
      KORGO_MASTRA_JWT_SECRET: secret,
      KORGO_MASTRA_PORT: String(port),
      OPENAI_API_KEY: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout.on('data', data => { output += String(data) })
  child.stderr.on('data', data => { output += String(data) })

  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged Mastra exited early (${child.exitCode}).\n${output.slice(-4_000)}`)
    try {
      const response = await fetch(`${baseUrl}/korgo/health`, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) {
        const health = await response.json()
        if (health.instanceId === instanceId) return health
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`Packaged Mastra did not become ready.\n${output.slice(-4_000)}`)
}

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...init.headers } })
  const body = await response.json()
  return { body, response }
}

async function waitForRun(runId, predicate, description) {
  let lastRun
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const { body, response } = await request(`/korgo/runs/${encodeURIComponent(runId)}`)
    if (!response.ok) throw new Error(`Packaged run lookup returned ${response.status}.`)
    lastRun = body
    if (predicate(body)) return body
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error([
    `Timed out waiting for packaged run to ${description}.`,
    `Last run: ${JSON.stringify(lastRun)}`,
    `Runtime output:\n${output.slice(-4_000)}`
  ].join('\n'))
}

try {
  await waitForServer(fakeHermes, hermesPort)
  const firstInstanceId = randomUUID()
  const firstHealth = await startRuntime(firstInstanceId)

  const anonymous = await fetch(`${baseUrl}/korgo/runs`)
  if (anonymous.status !== 401) throw new Error(`Anonymous packaged run access returned ${anonymous.status}, expected 401.`)
  const authorized = await fetch(`${baseUrl}/korgo/runs?limit=1`, { headers })
  if (!authorized.ok) throw new Error(`Authenticated packaged run access returned ${authorized.status}.`)

  const started = await request('/korgo/runs', {
    method: 'POST',
    body: JSON.stringify({
      instanceId: firstInstanceId,
      workspaceId: 'packaged-smoke-workspace',
      taskId: 'packaged-smoke-task',
      profile: 'default',
      instructions: 'Return read-only fake connector evidence.'
    })
  })
  if (!started.response.ok) throw new Error(`Packaged run start returned ${started.response.status}.`)
  await waitForRun(started.body.runId, run => run.state === 'awaiting-approval', 'suspend')
  if (hermesExecutions !== 0) throw new Error('Hermes executed before packaged approval.')

  await stopRuntime()
  const secondInstanceId = randomUUID()
  const health = await startRuntime(secondInstanceId)
  const recovered = await waitForRun(started.body.runId, run => run.state === 'awaiting-approval', 'recover after restart')

  const staleApproval = await request(`/korgo/runs/${encodeURIComponent(started.body.runId)}/approval`, {
    method: 'POST',
    body: JSON.stringify({
      decision: 'approve',
      instanceId: firstInstanceId,
      runId: started.body.runId,
      stepId: recovered.approval.stepId
    })
  })
  if (staleApproval.response.status !== 409) {
    throw new Error(`Stale packaged approval returned ${staleApproval.response.status}, expected 409.`)
  }

  const approval = await request(`/korgo/runs/${encodeURIComponent(started.body.runId)}/approval`, {
    method: 'POST',
    body: JSON.stringify({
      decision: 'approve',
      instanceId: secondInstanceId,
      runId: started.body.runId,
      stepId: recovered.approval.stepId
    })
  })
  if (!approval.response.ok) throw new Error(`Recovered packaged approval returned ${approval.response.status}.`)
  const completed = await waitForRun(started.body.runId, run => run.state === 'succeeded', 'succeed')
  if (hermesExecutions !== 1) throw new Error(`Hermes executed ${hermesExecutions} times, expected exactly once.`)
  if (completed.completionId !== 'packaged-smoke-completion' || completed.evidence.score !== 1 || !completed.traceId) {
    throw new Error(`Packaged run evidence was incomplete: ${JSON.stringify(completed.evidence)}.`)
  }
  if (!completed.artifacts?.some(artifact => artifact.label === 'Hermes execution evidence')) {
    throw new Error('Packaged run did not publish its evidence artifact.')
  }

  console.log(JSON.stringify({
    ok: true,
    runtime,
    firstHealth,
    health,
    anonymousStatus: anonymous.status,
    durableRun: {
      runId: completed.runId,
      state: completed.state,
      hermesExecutions,
      completionId: completed.completionId,
      evidence: completed.evidence,
      traceId: completed.traceId,
      artifacts: completed.artifacts.length,
      staleApprovalStatus: staleApproval.response.status
    }
  }, null, 2))
} finally {
  await stopRuntime()
  await closeServer(fakeHermes).catch(() => {})
}
