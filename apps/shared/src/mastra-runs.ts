export type MastraRunState =
  'awaiting-approval' | 'cancelled' | 'failed' | 'preparing' | 'queued' | 'running' | 'succeeded'

export interface MastraCapabilities {
  agents: boolean
  evals: boolean
  mcpServer: boolean
  memory: boolean
  observability: boolean
  rag: boolean
  storage: boolean
  studio: boolean
  workflows: boolean
}

export interface MastraRuntimeStatus {
  available: boolean
  capabilities: MastraCapabilities
  instanceId: string | null
  mode: 'local' | 'remote'
  reason?: string
  service: 'hermes-mastra-local'
}

export interface MastraRunApproval {
  instanceId: string
  instructionsPreview: string
  profile: string
  requestedAt: string
  runId: string
  stepId: string
  taskId: string
  workspaceId: string
}

export interface MastraEvidenceSummary {
  reason?: string
  score?: number
  status: 'missing' | 'partial' | 'verified'
}

export interface MastraRunError {
  code?: string
  message: string
}

export interface MastraRunArtifact {
  content?: string
  id: string
  kind: 'file' | 'link' | 'text'
  label: string
  mimeType?: string
  value?: string
}

export interface MastraRunStep {
  error?: MastraRunError
  finishedAt?: string
  id: string
  startedAt?: string
  state: 'cancelled' | 'failed' | 'running' | 'skipped' | 'succeeded' | 'suspended' | 'waiting'
}

export interface MastraRunSummary {
  approval?: MastraRunApproval
  createdAt: string
  evidence: MastraEvidenceSummary
  finishedAt?: string
  instructionsPreview: string
  parentRunId?: string
  profile: string
  runId: string
  startedAt?: string
  state: MastraRunState
  taskId: string
  updatedAt: string
  workflowId: 'hermes-task-lifecycle'
  workspaceId: string
}

export interface MastraUsage {
  completionTokens: number
  promptTokens: number
  totalTokens: number
}

export interface MastraRunDetail extends MastraRunSummary {
  artifacts: MastraRunArtifact[]
  completionId?: string
  error?: MastraRunError
  finishReason?: string
  response?: string
  sessionId?: string
  steps: MastraRunStep[]
  traceId?: string
  usage?: MastraUsage
}

export interface MastraListRunsRequest {
  cursor?: string
  limit?: number
  state?: MastraRunState
  workspaceId?: string
}

export interface MastraListRunsResponse {
  nextCursor?: string
  runs: MastraRunSummary[]
  total: number
}

export interface MastraStartRunInput {
  instructions: string
  parentRunId?: string
  profile?: string
  systemContext?: string
  taskId: string
  workspaceId: string
}

export interface MastraRunMutation {
  instanceId: string
  runId: string
}

export interface MastraResolveApprovalInput extends MastraRunMutation {
  decision: 'approve' | 'decline'
  stepId: string
}

export interface MastraRunEvent {
  cursor: string
  run?: MastraRunSummary
  status?: MastraRuntimeStatus
  type: 'run-upserted' | 'runtime-status'
}

export interface MastraRunEventsResponse {
  cursor: string
  runs: MastraRunSummary[]
}
