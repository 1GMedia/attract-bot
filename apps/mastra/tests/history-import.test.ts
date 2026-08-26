import { describe, expect, it, vi } from 'vitest'
import { importHermesHistory } from '../src/mastra/turns/turn-service.ts'

describe('Hermes history import', () => {
  it('creates the scoped thread, redacts secrets, and skips existing message ids', async () => {
    const saveMessages = vi.fn(async ({ messages }) => ({ messages }))
    const saveThread = vi.fn(async ({ thread }) => thread)
    const memory = {
      getThreadById: vi.fn(async () => null),
      recall: vi.fn(async () => ({ messages: [{ id: 'existing' }] })),
      saveMessages,
      saveThread
    }
    const result = await importHermesHistory({
      messages: [
        { content: 'already imported', createdAt: '2026-08-25T00:00:00.000Z', id: 'existing', role: 'user' },
        {
          content: 'Authorization: Bearer secret-token',
          createdAt: '2026-08-25T00:00:01.000Z',
          id: 'new',
          role: 'assistant'
        }
      ],
      profile: 'default',
      threadId: 'chat-1',
      workspaceId: '/workspace'
    }, memory as never)

    expect(result).toEqual({ imported: 1, skipped: 1 })
    expect(saveThread).toHaveBeenCalledWith({ thread: expect.objectContaining({
      id: 'chat-1',
      resourceId: '/workspace:default'
    }) })
    const saved = saveMessages.mock.calls[0]?.[0].messages[0]
    expect(JSON.stringify(saved.content)).not.toContain('secret-token')
    expect(JSON.stringify(saved.content)).toContain('[REDACTED]')
  })
})
