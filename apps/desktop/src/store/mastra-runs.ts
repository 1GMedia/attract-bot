import type {
  MastraListRunsRequest,
  MastraRunDetail,
  MastraRunEvent,
  MastraRunState,
  MastraRunSummary,
  MastraRuntimeStatus,
  MastraStartRunInput
} from '@hermes/shared/mastra-runs'
import { atom, computed } from 'nanostores'

const UNAVAILABLE_STATUS: MastraRuntimeStatus = {
  available: false,
  capabilities: {
    agents: false,
    evals: false,
    mcpServer: false,
    memory: false,
    observability: false,
    rag: false,
    storage: false,
    studio: false,
    workflows: false
  },
  instanceId: null,
  mode: 'local',
  reason: 'Mastra is starting.',
  service: 'hermes-mastra-local'
}

export const $mastraStatus = atom<MastraRuntimeStatus>(UNAVAILABLE_STATUS)
export const $mastraRuns = atom<MastraRunSummary[]>([])
export const $mastraRunDetails = atom<Record<string, MastraRunDetail>>({})
export const $mastraRunsLoading = atom(false)
export const $mastraRunsError = atom<string | null>(null)

export const $activeMastraRuns = computed($mastraRuns, runs =>
  runs.filter(run => ['awaiting-approval', 'preparing', 'queued', 'running'].includes(run.state))
)
export const $mastraApprovalRuns = computed($mastraRuns, runs =>
  runs.filter(run => run.state === 'awaiting-approval' && run.approval)
)

let initialized = false
let unsubscribe: (() => void) | null = null

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Mastra request failed.'
}

function upsertRun(run: MastraRunSummary): void {
  const current = $mastraRuns.get()
  const index = current.findIndex(item => item.runId === run.runId)

  if (index >= 0 && JSON.stringify(current[index]) === JSON.stringify(run)) {return}
  const next = index < 0 ? [run, ...current] : current.map(item => (item.runId === run.runId ? run : item))
  next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  $mastraRuns.set(next)

  const detail = $mastraRunDetails.get()[run.runId]

  if (detail) {$mastraRunDetails.set({ ...$mastraRunDetails.get(), [run.runId]: { ...detail, ...run } })}
}

function handleEvent(event: MastraRunEvent): void {
  if (event.type === 'runtime-status' && event.status) {$mastraStatus.set(event.status)}

  if (event.type === 'run-upserted' && event.run) {upsertRun(event.run)}
}

export function initMastraRuns(): () => void {
  if (initialized) {return () => {}}
  initialized = true
  unsubscribe = window.hermesDesktop.mastra.onEvent(handleEvent)
  void refreshMastraRuns()

  return () => {
    unsubscribe?.()
    unsubscribe = null
    initialized = false
  }
}

export async function refreshMastraRuns(request: MastraListRunsRequest = {}): Promise<void> {
  $mastraRunsLoading.set(true)

  try {
    const status = await window.hermesDesktop.mastra.getStatus()
    $mastraStatus.set(status)

    if (!status.available) {
      $mastraRuns.set([])
      $mastraRunsError.set(status.reason || 'Mastra is unavailable.')

      return
    }

    const result = await window.hermesDesktop.mastra.listRuns({ limit: 100, ...request })
    $mastraRuns.set(result.runs)
    $mastraRunsError.set(null)
  } catch (error) {
    $mastraRunsError.set(errorMessage(error))
  } finally {
    $mastraRunsLoading.set(false)
  }
}

export async function loadMastraRun(runId: string): Promise<MastraRunDetail> {
  const detail = await window.hermesDesktop.mastra.getRun(runId)
  $mastraRunDetails.set({ ...$mastraRunDetails.get(), [runId]: detail })
  upsertRun(detail)

  return detail
}

export async function startMastraRun(input: MastraStartRunInput): Promise<MastraRunSummary> {
  const run = await window.hermesDesktop.mastra.startRun(input)
  upsertRun(run)

  return run
}

export async function resolveMastraApproval(runId: string, decision: 'approve' | 'decline'): Promise<MastraRunSummary> {
  const run = $mastraRuns.get().find(item => item.runId === runId)

  if (!run?.approval) {throw new Error('This run is no longer awaiting approval.')}

  const updated = await window.hermesDesktop.mastra.resolveApproval({
    runId,
    decision,
    stepId: run.approval.stepId,
    instanceId: run.approval.instanceId
  })

  upsertRun(updated)

  return updated
}

export async function cancelMastraRun(runId: string): Promise<MastraRunSummary> {
  const instanceId = $mastraStatus.get().instanceId

  if (!instanceId) {throw new Error('Mastra is unavailable.')}
  const run = await window.hermesDesktop.mastra.cancelRun({ runId, instanceId })
  upsertRun(run)

  return run
}

export async function retryMastraRun(runId: string): Promise<MastraRunSummary> {
  const instanceId = $mastraStatus.get().instanceId

  if (!instanceId) {throw new Error('Mastra is unavailable.')}
  const run = await window.hermesDesktop.mastra.retryRun({ runId, instanceId })
  upsertRun(run)

  return run
}

export function mastraRunStateIsActive(state: MastraRunState): boolean {
  return ['awaiting-approval', 'preparing', 'queued', 'running'].includes(state)
}
