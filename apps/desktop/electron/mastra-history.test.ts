import { describe, expect, it } from 'vitest'
import { mapHermesHistory } from './mastra-history'

describe('Mastra Hermes history import', () => {
  it('keeps only conversational messages with stable ids and chronological timestamps', () => {
    const result = mapHermesHistory([
      { content: 'assistant', id: 2, role: 'assistant', timestamp: 2 },
      { args: { token: 'do-not-import' }, content: 'tool payload', id: 3, role: 'tool', timestamp: 3 },
      { content: [{ text: 'user' }], id: 1, role: 'user', timestamp: 1 },
      { content: 'private system instructions', id: 0, role: 'system', timestamp: 0 }
    ], 'default', 'thread-1')

    expect(result).toEqual([
      expect.objectContaining({ content: 'user', id: 'hermes:default:thread-1:1', role: 'user' }),
      expect.objectContaining({ content: 'assistant', id: 'hermes:default:thread-1:2', role: 'assistant' })
    ])
  })

  it('derives the same id for legacy rows without a database row id', () => {
    const row = { content: 'same', role: 'user', timestamp: 100 }
    expect(mapHermesHistory([row], 'work', 'chat')[0]?.id).toBe(
      mapHermesHistory([row], 'work', 'chat')[0]?.id
    )
  })
})
