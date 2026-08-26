export type MastraRunState =
  'awaiting-approval' | 'cancelled' | 'failed' | 'preparing' | 'queued' | 'running' | 'succeeded'

export type MastraTurnState =
  'awaiting-tool-approval' | 'cancelled' | 'failed' | 'queued' | 'responding' | 'running-tool' | 'succeeded'

export type MastraRiskClassification =
  'expensive' | 'external-send' | 'mutation' | 'private-read' | 'read-only' | 'unknown'

export type MastraRuntimeLocation = 'local' | 'orgo'

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
  argumentHash?: string
  instanceId: string
  instructionsPreview: string
  originThreadId?: string
  originToolCallId?: string
  originTurnId?: string
  policyVersion?: string
  profile: string
  requestedAt: string
  risk?: MastraRiskClassification
  runId: string
  stepId: string
  taskId: string
  toolArgumentsPreview?: string
  toolName?: string
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
  originThreadId?: string
  originToolCallId?: string
  originTurnId?: string
  parentRunId?: string
  policyVersion?: string
  profile: string
  remoteConnectionId?: string
  risk?: MastraRiskClassification
  runId: string
  runtimeLocation?: MastraRuntimeLocation
  runtimeVersion?: string
  startedAt?: string
  state: MastraRunState
  taskId: string
  toolArgumentsPreview?: string
  toolName?: string
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
  origin?: {
    threadId: string
    toolCallId: string
    turnId: string
  }
  parentRunId?: string
  profile?: string
  runtime?: {
    location: MastraRuntimeLocation
    remoteConnectionId?: string
    version?: string
  }
  systemContext?: string
  taskId: string
  tool?: {
    argumentHash?: string
    arguments: Record<string, unknown>
    argumentsPreview: string
    name: string
    policyVersion: string
    risk: MastraRiskClassification
  }
  workspaceId: string
}

export interface MastraMessage {
  content: string
  createdAt: string
  id: string
  role: 'assistant' | 'system' | 'tool' | 'user'
  threadId: string
  turnId?: string
}

export interface MastraListMessagesRequest {
  cursor?: string
  limit?: number
  threadId: string
}

export interface MastraListMessagesResponse {
  messages: MastraMessage[]
  nextCursor?: string
}

export interface MastraStartTurnInput {
  clientTurnId: string
  message: string
  profile: string
  threadId: string
  workspaceId: string
}

export interface MastraCancelTurnInput {
  instanceId: string
  turnId: string
}

export interface MastraTurnSummary {
  clientTurnId: string
  createdAt: string
  error?: MastraRunError
  finishedAt?: string
  instanceId: string
  linkedRunIds: string[]
  profile: string
  state: MastraTurnState
  threadId: string
  turnId: string
  updatedAt: string
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
  message?: MastraMessage
  run?: MastraRunSummary
  status?: MastraRuntimeStatus
  turn?: MastraTurnSummary
  type: 'message-upserted' | 'run-upserted' | 'runtime-status' | 'turn-upserted'
}

export interface MastraRunEventsResponse {
  cursor: string
  runs: MastraRunSummary[]
}
