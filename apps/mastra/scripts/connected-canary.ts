import type { MastraRunDetail, MastraRunSummary } from '@hermes/shared/mastra-runs'
import { createRuntimeConfig } from '../src/mastra/runtime-config.ts'
import { authenticatedHeaders } from './auth.ts'
import { TOOL_POLICY_VERSION } from '../src/mastra/runs/tool-policy.ts'

const config = createRuntimeConfig()
const connector = process.env.KORGO_CANARY_CONNECTOR?.trim().toLowerCase()
if (!config.auth.jwtSecret) throw new Error('Connected canary requires KORGO_MASTRA_JWT_SECRET.')
if (!config.hermes.configured) throw new Error('Connected canary requires a configured Hermes execution credential.')
if (!connector || !['composio', 'gohighlevel'].includes(connector)) {
  throw new Error('Set KORGO_CANARY_CONNECTOR to composio or gohighlevel.')
}
if (process.env.KORGO_CANARY_APPROVE_READ_ONLY !== '1') {
  throw new Error('Set KORGO_CANARY_APPROVE_READ_ONLY=1 to approve this explicitly read-only connector run.')
}

const baseUrl = `http://${config.host}:${config.port}`
const headers = authenticatedHeaders(config.auth.jwtSecret)
const request = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { ...headers, ...init.headers } })
  const body = await response.json()
  if (!response.ok) throw new Error(body?.error?.message || `Mastra request failed with HTTP ${response.status}.`)
  return body as T
}
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const run = await request<MastraRunSummary>('/korgo/runs', {
  method: 'POST',
  body: JSON.stringify({
    instanceId: config.instanceId,
    workspaceId: process.env.KORGO_MASTRA_WORKSPACE_ID || 'connected-canary',
    taskId: `read-only-${connector}-${Date.now()}`,
    profile: config.hermes.defaultProfile,
    tool: {
      name: 'use-connected-app',
      arguments: {
        connector,
        operation: connector === 'gohighlevel' ? 'read authenticated account identity' : 'list connected account names'
      },
      argumentsPreview: 'server replaces this preview',
      policyVersion: TOOL_POLICY_VERSION,
      risk: 'read-only'
    },
    instructions:
      connector === 'gohighlevel'
        ? 'READ-ONLY CANARY. Through Hermes and its configured GoHighLevel connector, read the authenticated account or location identity and return only non-sensitive identifiers. Do not create, update, delete, send, or trigger anything.'
        : 'READ-ONLY CANARY. Through Hermes and its configured Composio connector, list the names of available connected accounts and return only non-sensitive evidence. Do not create, update, delete, send, or trigger anything.'
  })
})

let detail: MastraRunDetail | undefined
for (let attempt = 0; attempt < 120; attempt += 1) {
  detail = await request<MastraRunDetail>(`/korgo/runs/${encodeURIComponent(run.runId)}`)
  if (detail.state === 'awaiting-approval' && detail.approval) break
  if (['failed', 'cancelled', 'succeeded'].includes(detail.state)) break
  await sleep(500)
}
if (!detail?.approval)
  throw new Error(`Connected canary did not suspend for approval (state ${detail?.state || 'unknown'}).`)
if (detail.risk !== 'unknown' || detail.policyVersion !== TOOL_POLICY_VERSION || detail.toolName !== 'use-connected-app') {
  throw new Error('Connected canary approval metadata was not bound by the server policy.')
}

await request(`/korgo/runs/${encodeURIComponent(run.runId)}/approval`, {
  method: 'POST',
  body: JSON.stringify({
    decision: 'approve',
    instanceId: detail.approval.instanceId,
    runId: run.runId,
    stepId: detail.approval.stepId
  })
})

for (let attempt = 0; attempt < 1_800; attempt += 1) {
  detail = await request<MastraRunDetail>(`/korgo/runs/${encodeURIComponent(run.runId)}`)
  if (['failed', 'cancelled', 'succeeded'].includes(detail.state)) break
  await sleep(1_000)
}
if (detail?.state !== 'succeeded' || !detail.completionId || detail.evidence.status === 'missing') {
  throw new Error(
    `Connected canary failed durable evidence acceptance: ${JSON.stringify({ state: detail?.state, completionId: detail?.completionId, evidence: detail?.evidence })}`
  )
}

console.log(
  JSON.stringify(
    {
      ok: true,
      connector,
      runId: detail.runId,
      completionId: detail.completionId,
      sessionId: detail.sessionId,
      evidence: detail.evidence,
      traceId: detail.traceId
    },
    null,
    2
  )
)
