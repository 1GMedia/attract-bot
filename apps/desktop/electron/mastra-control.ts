import crypto from 'node:crypto'

import type {
  MastraCancelTurnInput,
  MastraListMessagesRequest,
  MastraListMessagesResponse,
  MastraListRunsRequest,
  MastraListRunsResponse,
  MastraResolveApprovalInput,
  MastraRunDetail,
  MastraRunEventsResponse,
  MastraRunMutation,
  MastraRunSummary,
  MastraRuntimeStatus,
  MastraStartRunInput,
  MastraStartTurnInput,
  MastraTurnSummary
} from '@hermes/shared/mastra-runs'

export interface MastraRuntimeConnection {
  baseUrl: string
  instanceId: string
  jwtSecret: string
}

const EMPTY_CAPABILITIES = {
  agents: false,
  evals: false,
  mcpServer: false,
  memory: false,
  observability: false,
  rag: false,
  storage: false,
  studio: false,
  workflows: false
}

function base64Json(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function signMastraJwt(secret: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = base64Json({ alg: 'HS256', typ: 'JWT' })

  const payload = base64Json({
    sub: 'hermes-desktop',
    aud: 'hermes-mastra-local',
    iat: nowSeconds,
    exp: nowSeconds + 60,
    jti: crypto.randomUUID()
  })

  const unsigned = `${header}.${payload}`
  const signature = crypto.createHmac('sha256', secret).update(unsigned).digest('base64url')

  return `${unsigned}.${signature}`
}

function queryString(request: MastraListRunsRequest): string {
  const params = new URLSearchParams()

  if (request.workspaceId) {params.set('workspaceId', request.workspaceId)}

  if (request.state) {params.set('state', request.state)}

  if (request.cursor) {params.set('cursor', request.cursor)}

  if (request.limit) {params.set('limit', String(request.limit))}
  const encoded = params.toString()

  return encoded ? `?${encoded}` : ''
}

function messageQueryString(request: MastraListMessagesRequest): string {
  const params = new URLSearchParams({ threadId: request.threadId })

  if (request.cursor) {params.set('cursor', request.cursor)}

  if (request.limit) {params.set('limit', String(request.limit))}

  return `?${params.toString()}`
}

function errorMessage(value: unknown): string {
  if (value && typeof value === 'object') {
    const nested = (value as any).error

    if (nested && typeof nested.message === 'string') {return nested.message}

    if (typeof (value as any).message === 'string') {return (value as any).message}
  }

  return 'Mastra request failed.'
}

export class MastraControlClient {
  private connection: MastraRuntimeConnection | null = null
  private mode: 'local' | 'remote' = 'local'
  private unavailableReason = 'Mastra is starting.'

  constructor(private fetchImplementation: typeof fetch = fetch) {}

  attach(connection: MastraRuntimeConnection): void {
    this.connection = connection
    this.mode = 'local'
    this.unavailableReason = ''
  }

  detach(options: { mode?: 'local' | 'remote'; reason?: string } = {}): void {
    this.connection = null
    this.mode = options.mode || 'local'
    this.unavailableReason =
      options.reason ||
      (this.mode === 'remote'
        ? 'Local Mastra orchestration is unavailable for remote Hermes profiles.'
        : 'Mastra is unavailable.')
  }

  get instanceId(): string | null {
    return this.connection?.instanceId || null
  }

  async getStatus(): Promise<MastraRuntimeStatus> {
    if (!this.connection) {
      return {
        available: false,
        capabilities: EMPTY_CAPABILITIES,
        instanceId: null,
        mode: this.mode,
        reason: this.unavailableReason,
        service: 'hermes-mastra-local'
      }
    }

    try {
      const response = await this.fetchImplementation(`${this.connection.baseUrl}/korgo/health`, {
        signal: AbortSignal.timeout(2_000)
      })

      const body = (await response.json()) as any

      if (!response.ok || body.instanceId !== this.connection.instanceId || body.ok !== true) {
        throw new Error('Mastra health identity did not match the active desktop instance.')
      }

      return {
        available: true,
        capabilities: { ...EMPTY_CAPABILITIES, ...body.capabilities },
        instanceId: this.connection.instanceId,
        mode: 'local',
        service: 'hermes-mastra-local'
      }
    } catch (error) {
      return {
        available: false,
        capabilities: EMPTY_CAPABILITIES,
        instanceId: this.connection.instanceId,
        mode: 'local',
        reason: error instanceof Error ? error.message : 'Mastra health check failed.',
        service: 'hermes-mastra-local'
      }
    }
  }

  listRuns(request: MastraListRunsRequest = {}): Promise<MastraListRunsResponse> {
    return this.request(`/korgo/runs${queryString(request)}`)
  }

  getRun(runId: string): Promise<MastraRunDetail> {
    return this.request(`/korgo/runs/${encodeURIComponent(runId)}`)
  }

  startRun(input: MastraStartRunInput): Promise<MastraRunSummary> {
    return this.mutate('/korgo/runs', { ...input, instanceId: this.requireConnection().instanceId })
  }

  resolveApproval(input: MastraResolveApprovalInput): Promise<MastraRunSummary> {
    return this.mutate(`/korgo/runs/${encodeURIComponent(input.runId)}/approval`, input)
  }

  cancelRun(input: MastraRunMutation): Promise<MastraRunSummary> {
    return this.mutate(`/korgo/runs/${encodeURIComponent(input.runId)}/cancel`, input)
  }

  retryRun(input: MastraRunMutation): Promise<MastraRunSummary> {
    return this.mutate(`/korgo/runs/${encodeURIComponent(input.runId)}/retry`, input)
  }

  pollEvents(after?: string): Promise<MastraRunEventsResponse> {
    const query = after ? `?after=${encodeURIComponent(after)}` : ''

    return this.request(`/korgo/runs/events${query}`)
  }

  listMessages(request: MastraListMessagesRequest): Promise<MastraListMessagesResponse> {
    return this.request(`/korgo/messages${messageQueryString(request)}`)
  }

  startTurn(input: MastraStartTurnInput): Promise<MastraTurnSummary> {
    return this.mutate('/korgo/turns', { ...input, instanceId: this.requireConnection().instanceId })
  }

  cancelTurn(input: MastraCancelTurnInput): Promise<MastraTurnSummary> {
    return this.mutate(`/korgo/turns/${encodeURIComponent(input.turnId)}/cancel`, input)
  }

  private requireConnection(): MastraRuntimeConnection {
    if (!this.connection) {throw new Error(this.unavailableReason || 'Mastra is unavailable.')}

    return this.connection
  }

  private mutate<T>(path: string, body: unknown): Promise<T> {
    return this.request(path, { method: 'POST', body: JSON.stringify(body) })
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const connection = this.requireConnection()

    const response = await this.fetchImplementation(`${connection.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${signMastraJwt(connection.jwtSecret)}`,
        'Content-Type': 'application/json',
        ...init.headers
      },
      signal: init.signal || AbortSignal.timeout(10_000)
    })

    const body = await response.json().catch(() => null)

    if (!response.ok) {throw new Error(errorMessage(body))}

    return body as T
  }
}
