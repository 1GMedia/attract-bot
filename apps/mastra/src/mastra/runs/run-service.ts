import type {
  MastraListRunsRequest,
  MastraListRunsResponse,
  MastraRunArtifact,
  MastraRunDetail,
  MastraRunError,
  MastraRiskClassification,
  MastraRunState,
  MastraRunStep,
  MastraRunSummary,
  MastraStartRunInput
} from '@hermes/shared/mastra-runs'
import type { Mastra } from '@mastra/core/mastra'
import type { WorkflowRun } from '@mastra/core/storage'
import type { WorkflowRunState, WorkflowState } from '@mastra/core/workflows'
import { mastraRuntimeConfig } from '../runtime-config.ts'
import { redactRunText } from './redaction.ts'
import { approvalArgumentHash } from './tool-policy.ts'

const WORKFLOW_ID = 'hermes-task-lifecycle' as const
const APPROVAL_STEP_ID = 'await-execution-approval'

type Snapshot = WorkflowRunState | WorkflowState

function object(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {}
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function risk(value: unknown): MastraRiskClassification | undefined {
  return ['read-only', 'private-read', 'mutation', 'external-send', 'expensive', 'unknown'].includes(String(value))
    ? (value as MastraRiskClassification)
    : undefined
}

function iso(value: unknown): string | undefined {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString()
  return undefined
}

function snapshotOf(run: WorkflowRun): Snapshot {
  if (typeof run.snapshot === 'string') return JSON.parse(run.snapshot) as WorkflowRunState
  return run.snapshot
}

function contextOf(snapshot: Snapshot): Record<string, any> {
  if ('context' in snapshot) return object(snapshot.context)
  return { input: snapshot.payload, ...object(snapshot.steps) }
}

function inputOf(snapshot: Snapshot): MastraStartRunInput {
  const context = contextOf(snapshot)
  return object(context.input) as MastraStartRunInput
}

function outputOf(snapshot: Snapshot): Record<string, any> {
  return object(snapshot.result)
}

function errorOf(value: unknown): MastraRunError | undefined {
  const error = object(value)
  const message = string(error.message)
  if (!message) return undefined
  return {
    message: redactRunText(message) || 'Run failed.',
    ...(string(error.code) ? { code: redactRunText(string(error.code)) } : {})
  }
}

export function mapMastraRunState(snapshot: Snapshot): MastraRunState {
  switch (snapshot.status) {
    case 'pending':
      return 'queued'
    case 'suspended':
      return 'awaiting-approval'
    case 'success':
      return 'succeeded'
    case 'canceled':
      return 'cancelled'
    case 'failed':
    case 'tripwire':
    case 'bailed':
      return 'failed'
    case 'running': {
      const prepare = object(contextOf(snapshot)['prepare-with-supervisor'])
      return prepare.status === 'running' || !prepare.status ? 'preparing' : 'running'
    }
    case 'paused':
    case 'skipped':
    case 'waiting':
      return 'running'
  }
}

function stepState(status: unknown): MastraRunStep['state'] {
  switch (status) {
    case 'success':
      return 'succeeded'
    case 'failed':
      return 'failed'
    case 'suspended':
      return 'suspended'
    case 'waiting':
    case 'paused':
      return 'waiting'
    case 'skipped':
      return 'skipped'
    case 'canceled':
      return 'cancelled'
    default:
      return 'running'
  }
}

function stepsOf(snapshot: Snapshot): MastraRunStep[] {
  const context = contextOf(snapshot)
  return Object.entries(context).flatMap(([id, raw]) => {
    if (id === 'input') return []
    const values = Array.isArray(raw) ? raw : [raw]
    return values.flatMap((entry, index) => {
      const step = object(entry)
      if (!step.status) return []
      const suffix = values.length > 1 ? `:${index}` : ''
      return [
        {
          id: `${id}${suffix}`,
          state: stepState(step.status),
          ...(iso(step.startedAt) ? { startedAt: iso(step.startedAt) } : {}),
          ...(iso(step.endedAt) ? { finishedAt: iso(step.endedAt) } : {}),
          ...(errorOf(step.error) ? { error: errorOf(step.error) } : {})
        }
      ]
    })
  })
}

function artifactsOf(output: Record<string, any>): MastraRunArtifact[] {
  if (!Array.isArray(output.artifacts)) return []
  return output.artifacts.flatMap((raw: unknown) => {
    const artifact = object(raw)
    const id = string(artifact.id)
    const label = string(artifact.label)
    const kind = artifact.kind
    if (!id || !label || !['file', 'link', 'text'].includes(kind)) return []
    return [
      {
        id,
        label,
        kind,
        ...(string(artifact.mimeType) ? { mimeType: string(artifact.mimeType) } : {}),
        ...(string(artifact.value) ? { value: redactRunText(string(artifact.value)) } : {}),
        ...(string(artifact.content) ? { content: redactRunText(string(artifact.content)) } : {})
      } as MastraRunArtifact
    ]
  })
}

export function mapMastraRunSummary(
  runId: string,
  snapshot: Snapshot,
  createdAt: Date,
  updatedAt: Date
): MastraRunSummary {
  const input = inputOf(snapshot)
  const output = outputOf(snapshot)
  const evidence = object(output.evidence)
  const steps = stepsOf(snapshot)
  const state = mapMastraRunState(snapshot)
  const startedAt = steps
    .map(step => step.startedAt)
    .filter(Boolean)
    .sort()[0]
  const finishedAt = ['cancelled', 'failed', 'succeeded'].includes(state) ? updatedAt.toISOString() : undefined
  const instructions = string(input.instructions) || ''
  const origin = object(input.origin)
  const tool = object(input.tool)
  const runtime = object(input.runtime)
  const suspendedStep = steps.find(step => step.state === 'suspended')?.id || APPROVAL_STEP_ID
  const score = number(evidence.score)
  const evidenceStatus = score === 1 ? 'verified' : score === undefined ? 'missing' : 'partial'

  return {
    runId,
    workflowId: WORKFLOW_ID,
    workspaceId: string(input.workspaceId) || 'unknown',
    taskId: string(input.taskId) || runId,
    profile: string(input.profile) || mastraRuntimeConfig.hermes.defaultProfile,
    instructionsPreview: redactRunText(instructions.slice(0, 240)) || '',
    state,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    evidence: {
      status: evidenceStatus,
      ...(score !== undefined ? { score } : {}),
      ...(string(evidence.reason) ? { reason: string(evidence.reason) } : {})
    },
    ...(string(origin.threadId) ? { originThreadId: string(origin.threadId) } : {}),
    ...(string(origin.turnId) ? { originTurnId: string(origin.turnId) } : {}),
    ...(string(origin.toolCallId) ? { originToolCallId: string(origin.toolCallId) } : {}),
    ...(string(tool.name) ? { toolName: string(tool.name) } : {}),
    ...(string(tool.argumentsPreview)
      ? { toolArgumentsPreview: redactRunText(string(tool.argumentsPreview)) }
      : {}),
    ...(string(tool.policyVersion) ? { policyVersion: string(tool.policyVersion) } : {}),
    ...(risk(tool.risk) ? { risk: risk(tool.risk) } : {}),
    ...(runtime.location === 'local' || runtime.location === 'orgo'
      ? { runtimeLocation: runtime.location }
      : {}),
    ...(string(runtime.remoteConnectionId) ? { remoteConnectionId: string(runtime.remoteConnectionId) } : {}),
    ...(string(runtime.version) ? { runtimeVersion: string(runtime.version) } : {}),
    ...(string(input.parentRunId) ? { parentRunId: string(input.parentRunId) } : {}),
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    ...(state === 'awaiting-approval'
      ? {
          approval: {
            runId,
            stepId: suspendedStep.split(':', 1)[0],
            instanceId: mastraRuntimeConfig.instanceId,
            requestedAt: updatedAt.toISOString(),
            workspaceId: string(input.workspaceId) || 'unknown',
            taskId: string(input.taskId) || runId,
            profile: string(input.profile) || mastraRuntimeConfig.hermes.defaultProfile,
            instructionsPreview: redactRunText(instructions.slice(0, 240)) || '',
            ...(string(origin.threadId) ? { originThreadId: string(origin.threadId) } : {}),
            ...(string(origin.turnId) ? { originTurnId: string(origin.turnId) } : {}),
            ...(string(origin.toolCallId) ? { originToolCallId: string(origin.toolCallId) } : {}),
            ...(string(tool.name) ? { toolName: string(tool.name) } : {}),
            ...(string(tool.argumentsPreview)
              ? { toolArgumentsPreview: redactRunText(string(tool.argumentsPreview)) }
              : {}),
            ...(string(tool.argumentHash) ? { argumentHash: string(tool.argumentHash) } : {}),
            ...(string(tool.policyVersion) ? { policyVersion: string(tool.policyVersion) } : {}),
            ...(risk(tool.risk) ? { risk: risk(tool.risk) } : {})
          }
        }
      : {})
  }
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0
  try {
    const offset = Number(Buffer.from(cursor, 'base64url').toString('utf8'))
    return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0
  } catch {
    return 0
  }
}

function workflow(mastra: Mastra) {
  return mastra.getWorkflow('hermesTaskLifecycle')
}

export async function listRuns(mastra: Mastra, request: MastraListRunsRequest = {}): Promise<MastraListRunsResponse> {
  const result: { runs: WorkflowRun[]; total: number } = await workflow(mastra).listWorkflowRuns({
    page: 0,
    perPage: false
  })
  const filtered = result.runs
    .map(run => mapMastraRunSummary(run.runId, snapshotOf(run), run.createdAt, run.updatedAt))
    .filter(run => !request.workspaceId || run.workspaceId === request.workspaceId)
    .filter(run => !request.state || run.state === request.state)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const offset = decodeCursor(request.cursor)
  const limit = Math.max(1, Math.min(100, request.limit || 40))
  const runs = filtered.slice(offset, offset + limit)
  const nextOffset = offset + runs.length
  return {
    runs,
    total: filtered.length,
    ...(nextOffset < filtered.length ? { nextCursor: Buffer.from(String(nextOffset)).toString('base64url') } : {})
  }
}

export async function getRun(mastra: Mastra, runId: string): Promise<MastraRunDetail | null> {
  const snapshot = await workflow(mastra).getWorkflowRunById(runId, {
    fields: ['result', 'error', 'steps', 'tracingContext']
  })
  if (!snapshot) return null
  const summary = mapMastraRunSummary(runId, snapshot, snapshot.createdAt, snapshot.updatedAt)
  const output = outputOf(snapshot)
  const usage = object(output.usage)
  const evidence = object(output.evidence)
  return {
    ...summary,
    steps: stepsOf(snapshot),
    artifacts: artifactsOf(output),
    ...(string(output.completionId) ? { completionId: string(output.completionId) } : {}),
    ...(string(output.sessionId) ? { sessionId: string(output.sessionId) } : {}),
    ...(string(output.finishReason) ? { finishReason: string(output.finishReason) } : {}),
    ...(string(output.response) ? { response: redactRunText(string(output.response)) } : {}),
    ...(number(usage.totalTokens) !== undefined
      ? {
          usage: {
            promptTokens: number(usage.promptTokens) || 0,
            completionTokens: number(usage.completionTokens) || 0,
            totalTokens: number(usage.totalTokens) || 0
          }
        }
      : {}),
    ...(string(evidence.traceId) || string(snapshot.tracingContext?.traceId)
      ? { traceId: string(evidence.traceId) || string(snapshot.tracingContext?.traceId) }
      : {}),
    ...(errorOf(snapshot.error) ? { error: errorOf(snapshot.error) } : {})
  }
}

export async function startRun(mastra: Mastra, input: MastraStartRunInput): Promise<MastraRunSummary> {
  const run = await workflow(mastra).createRun({ resourceId: input.workspaceId })
  const boundInput = input.tool
    ? {
        ...input,
        tool: {
          ...input.tool,
          argumentHash: approvalArgumentHash({
            toolName: input.tool.name,
            arguments: input.tool.arguments,
            policyVersion: input.tool.policyVersion,
            runId: run.runId,
            instanceId: mastraRuntimeConfig.instanceId
          })
        }
      }
    : input
  await run.startAsync({ inputData: boundInput })
  const detail = await getRun(mastra, run.runId)
  if (!detail) throw new Error('Mastra did not persist the new workflow run.')
  return detail
}

export async function resolveRunApproval(
  mastra: Mastra,
  input: { decision: 'approve' | 'decline'; runId: string; stepId: string }
): Promise<MastraRunSummary> {
  const existing = await getRun(mastra, input.runId)
  if (!existing) throw new Error('Workflow run not found.')
  if (existing.state !== 'awaiting-approval' || existing.approval?.stepId !== input.stepId) {
    throw new Error('Workflow run is not awaiting this approval.')
  }
  if (existing.approval.argumentHash) {
    const snapshot = await workflow(mastra).getWorkflowRunById(input.runId)
    if (!snapshot) throw new Error('Workflow run not found.')
    const runInput = inputOf(snapshot)
    if (!runInput.tool) throw new Error('Tool approval metadata is missing.')
    const expectedHash = approvalArgumentHash({
      toolName: runInput.tool.name,
      arguments: runInput.tool.arguments,
      policyVersion: runInput.tool.policyVersion,
      runId: input.runId,
      instanceId: mastraRuntimeConfig.instanceId
    })
    if (expectedHash !== existing.approval.argumentHash) {
      throw new Error('Tool approval identity changed. Start a new run before approving execution.')
    }
  }
  const run = await workflow(mastra).createRun({ runId: input.runId, resourceId: existing.workspaceId })
  if (input.decision === 'decline') await run.cancel()
  else await run.resumeAsync({ step: input.stepId, resumeData: { approved: true } })
  return (await getRun(mastra, input.runId))!
}

export async function cancelRun(mastra: Mastra, runId: string): Promise<MastraRunSummary> {
  const existing = await getRun(mastra, runId)
  if (!existing) throw new Error('Workflow run not found.')
  if (['cancelled', 'failed', 'succeeded'].includes(existing.state)) return existing
  await (await workflow(mastra).createRun({ runId, resourceId: existing.workspaceId })).cancel()
  return (await getRun(mastra, runId))!
}

export async function retryRun(mastra: Mastra, runId: string): Promise<MastraRunSummary> {
  const snapshot = await workflow(mastra).getWorkflowRunById(runId)
  if (!snapshot) throw new Error('Workflow run not found.')
  const input = inputOf(snapshot)
  return startRun(mastra, { ...input, parentRunId: runId })
}

export async function changedRuns(mastra: Mastra, after?: string): Promise<MastraRunSummary[]> {
  const threshold = after && !Number.isNaN(Date.parse(after)) ? Date.parse(after) : 0
  const result: { runs: WorkflowRun[]; total: number } = await workflow(mastra).listWorkflowRuns({
    page: 0,
    perPage: 100
  })
  return result.runs
    .filter(run => run.updatedAt.getTime() > threshold)
    .map(run => mapMastraRunSummary(run.runId, snapshotOf(run), run.createdAt, run.updatedAt))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
}
