import type {
  MastraListMessagesRequest,
  MastraListMessagesResponse,
  MastraMessage,
  MastraRunSummary,
  MastraStartTurnInput,
  MastraTurnState,
  MastraTurnSummary
} from '@hermes/shared/mastra-runs'
import type { MastraDBMessage } from '@mastra/core/agent'
import type { Mastra } from '@mastra/core/mastra'
import type { WorkflowRun } from '@mastra/core/storage'
import type { WorkflowRunState, WorkflowState } from '@mastra/core/workflows'
import { supervisorMemory } from '../memory.ts'
import { mastraRuntimeConfig } from '../runtime-config.ts'
import { listRuns } from '../runs/run-service.ts'
import { redactRunText } from '../runs/redaction.ts'

type Snapshot = WorkflowRunState | WorkflowState

function workflow(mastra: Mastra) {
  return mastra.getWorkflow('supervisorTurn')
}

function snapshotOf(run: WorkflowRun): Snapshot {
  return typeof run.snapshot === 'string' ? JSON.parse(run.snapshot) as WorkflowRunState : run.snapshot
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function contextOf(snapshot: Snapshot): Record<string, any> {
  if ('context' in snapshot) return object(snapshot.context)
  return { input: snapshot.payload, ...object(snapshot.steps) }
}

function inputOf(snapshot: Snapshot): Record<string, any> {
  return object(contextOf(snapshot).input)
}

function outputOf(snapshot: Snapshot): Record<string, any> {
  return object(snapshot.result)
}

function linkedRunIds(snapshot: Snapshot): string[] {
  const value = outputOf(snapshot).linkedRunIds
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && Boolean(id)) : []
}

function baseState(snapshot: Snapshot): MastraTurnState {
  switch (snapshot.status) {
    case 'pending':
      return 'queued'
    case 'running':
    case 'waiting':
    case 'paused':
      return 'responding'
    case 'success':
      return 'succeeded'
    case 'canceled':
      return 'cancelled'
    case 'failed':
    case 'tripwire':
    case 'bailed':
    case 'skipped':
    case 'suspended':
      return 'failed'
  }
}

function stateWithRuns(state: MastraTurnState, linkedRuns: MastraRunSummary[]): MastraTurnState {
  if (!linkedRuns.length || state !== 'succeeded') return state
  if (linkedRuns.some(run => run.state === 'awaiting-approval')) return 'awaiting-tool-approval'
  if (linkedRuns.some(run => ['preparing', 'queued', 'running'].includes(run.state))) return 'running-tool'
  if (linkedRuns.some(run => run.state === 'failed')) return 'failed'
  if (linkedRuns.some(run => run.state === 'cancelled')) return 'cancelled'
  return 'succeeded'
}

function errorOf(snapshot: Snapshot): MastraTurnSummary['error'] {
  const error = object(snapshot.error)
  return typeof error.message === 'string'
    ? { message: redactRunText(error.message) || 'Supervisor turn failed.' }
    : undefined
}

export function mapTurnSummary(
  runId: string,
  snapshot: Snapshot,
  createdAt: Date,
  updatedAt: Date,
  linkedRuns: MastraRunSummary[] = []
): MastraTurnSummary {
  const input = inputOf(snapshot)
  const state = stateWithRuns(baseState(snapshot), linkedRuns)
  const terminal = ['cancelled', 'failed', 'succeeded'].includes(state)
  return {
    turnId: runId,
    clientTurnId: typeof input.clientTurnId === 'string' ? input.clientTurnId : runId,
    threadId: typeof input.threadId === 'string' ? input.threadId : 'unknown',
    workspaceId: typeof input.workspaceId === 'string' ? input.workspaceId : 'unknown',
    profile: typeof input.profile === 'string' ? input.profile : mastraRuntimeConfig.hermes.defaultProfile,
    instanceId: mastraRuntimeConfig.instanceId,
    linkedRunIds: linkedRunIds(snapshot),
    state,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    ...(terminal ? { finishedAt: updatedAt.toISOString() } : {}),
    ...(errorOf(snapshot) ? { error: errorOf(snapshot) } : {})
  }
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  try {
    const page = Number(Buffer.from(cursor, 'base64url').toString('utf8'))
    return Number.isSafeInteger(page) && page >= 0 ? page : 0
  } catch {
    return 0
  }
}

function messageText(message: MastraDBMessage): string {
  const content = object(message.content)
  if (typeof content.content === 'string') return content.content
  if (!Array.isArray(content.parts)) return ''
  return content.parts
    .flatMap(part => {
      const value = object(part)
      return value.type === 'text' && typeof value.text === 'string' ? [value.text] : []
    })
    .join('\n')
}

function messageDto(message: MastraDBMessage, threadId: string): MastraMessage | null {
  if (!['assistant', 'system', 'user'].includes(message.role)) return null
  const content = messageText(message)
  if (!content) return null
  const metadata = object(object(message.content).metadata)
  return {
    id: message.id,
    threadId: message.threadId || threadId,
    role: message.role as MastraMessage['role'],
    content,
    createdAt: message.createdAt.toISOString(),
    ...(typeof metadata.turnId === 'string' ? { turnId: metadata.turnId } : {})
  }
}

export async function listMessages(request: MastraListMessagesRequest): Promise<MastraListMessagesResponse> {
  const page = decodeCursor(request.cursor)
  const limit = Math.max(1, Math.min(100, request.limit || 40))
  const result = await supervisorMemory.recall({
    threadId: request.threadId,
    page,
    perPage: limit,
    orderBy: { field: 'createdAt', direction: 'ASC' }
  })
  const messages = result.messages.flatMap(message => {
    const dto = messageDto(message, request.threadId)
    return dto ? [dto] : []
  })
  return {
    messages,
    ...(result.hasMore ? { nextCursor: Buffer.from(String(page + 1)).toString('base64url') } : {})
  }
}

export async function changedMessages(threadIds: string[], after?: string): Promise<MastraMessage[]> {
  const uniqueThreadIds = [...new Set(threadIds.filter(Boolean))]
  if (!uniqueThreadIds.length) return []
  const start = after && !Number.isNaN(Date.parse(after)) ? new Date(after) : undefined
  const results = await Promise.all(uniqueThreadIds.map(async threadId => {
    const recalled = await supervisorMemory.recall({
      threadId,
      page: 0,
      perPage: 100,
      orderBy: { field: 'createdAt', direction: 'ASC' },
      ...(start ? { filter: { dateRange: { start, startExclusive: true } } } : {})
    })
    return recalled.messages.flatMap(message => {
      const dto = messageDto(message, threadId)
      return dto ? [dto] : []
    })
  }))
  return results.flat().sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  )
}

async function linkedRunsFor(mastra: Mastra, ids: string[]): Promise<MastraRunSummary[]> {
  if (!ids.length) return []
  const all = await listRuns(mastra, { limit: 100 })
  const wanted = new Set(ids)
  return all.runs.filter(run => wanted.has(run.runId))
}

export async function getTurn(mastra: Mastra, turnId: string): Promise<MastraTurnSummary | null> {
  const snapshot = await workflow(mastra).getWorkflowRunById(turnId)
  if (!snapshot) return null
  return mapTurnSummary(
    turnId,
    snapshot,
    snapshot.createdAt,
    snapshot.updatedAt,
    await linkedRunsFor(mastra, linkedRunIds(snapshot))
  )
}

export async function startTurn(mastra: Mastra, input: MastraStartTurnInput): Promise<MastraTurnSummary> {
  const run = await workflow(mastra).createRun({ resourceId: `${input.workspaceId}:${input.profile}` })
  await run.startAsync({ inputData: { ...input, turnId: run.runId } })
  const turn = await getTurn(mastra, run.runId)
  if (!turn) throw new Error('Mastra did not persist the supervisor turn.')
  return turn
}

export async function cancelTurn(mastra: Mastra, turnId: string): Promise<MastraTurnSummary> {
  const existing = await getTurn(mastra, turnId)
  if (!existing) throw new Error('Supervisor turn not found.')
  if (['cancelled', 'failed', 'succeeded'].includes(existing.state)) return existing
  await (await workflow(mastra).createRun({ runId: turnId, resourceId: `${existing.workspaceId}:${existing.profile}` })).cancel()
  return (await getTurn(mastra, turnId))!
}

export async function changedTurns(mastra: Mastra, after?: string): Promise<MastraTurnSummary[]> {
  const threshold = after && !Number.isNaN(Date.parse(after)) ? Date.parse(after) : 0
  const result: { runs: WorkflowRun[]; total: number } = await workflow(mastra).listWorkflowRuns({
    page: 0,
    perPage: 100
  })
  const projected = await Promise.all(result.runs.map(async run => {
    const snapshot = snapshotOf(run)
    return mapTurnSummary(
      run.runId,
      snapshot,
      run.createdAt,
      run.updatedAt,
      await linkedRunsFor(mastra, linkedRunIds(snapshot))
    )
  }))
  return projected
    .filter(turn => Date.parse(turn.updatedAt) > threshold || ['awaiting-tool-approval', 'running-tool'].includes(turn.state))
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
}
