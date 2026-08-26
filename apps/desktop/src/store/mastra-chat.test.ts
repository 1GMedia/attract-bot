import type { MastraRuntimeStatus } from '@hermes/shared/mastra-runs'
import { describe, expect, it } from 'vitest'

import { mastraConversationDecision } from './mastra-chat'

const status = (available: boolean): MastraRuntimeStatus => ({
  available,
  capabilities: {
    agents: available,
    evals: available,
    mcpServer: available,
    memory: available,
    observability: available,
    rag: available,
    storage: available,
    studio: false,
    workflows: available
  },
  instanceId: available ? 'instance' : null,
  mode: 'remote',
  service: 'hermes-mastra-local'
})

describe('Mastra conversation rollout decision', () => {
  it('routes upgraded threads through an available supervisor', () => {
    expect(mastraConversationDecision({ enabled: true, status: status(true), threadId: 'chat-1' })).toBe('mastra')
  })

  it('fails closed instead of silently falling back for an upgraded thread', () => {
    expect(mastraConversationDecision({ enabled: true, status: status(false), threadId: 'chat-1' }))
      .toBe('mastra-unavailable')
  })

  it('keeps explicit compatibility mode and blank drafts on direct Hermes', () => {
    expect(mastraConversationDecision({ enabled: false, status: status(true), threadId: 'chat-1' }))
      .toBe('direct-hermes')
    expect(mastraConversationDecision({ enabled: true, status: status(true), threadId: null }))
      .toBe('direct-hermes')
  })
})
