import crypto from 'node:crypto'

export interface MastraImportedMessage {
  content: string
  createdAt: string
  id: string
  role: 'assistant' | 'user'
}

function messageText(message: any): string {
  const value = message?.content ?? message?.text
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.flatMap(part => {
    if (typeof part === 'string') return [part]
    if (part && typeof part === 'object' && typeof part.text === 'string') return [part.text]
    return []
  }).join('\n')
}

function createdAt(timestamp: unknown, index: number): string {
  const numeric = Number(timestamp)
  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric < 1_000_000_000_000 ? numeric * 1_000 : numeric).toISOString()
  }
  return new Date(index).toISOString()
}

export function mapHermesHistory(messages: unknown, profile: string, threadId: string): MastraImportedMessage[] {
  if (!Array.isArray(messages)) return []
  const result = messages.flatMap((message, index): MastraImportedMessage[] => {
    if (!['assistant', 'user'].includes(message?.role)) return []
    const content = messageText(message).trim().slice(0, 40_000)
    if (!content) return []
    const rowId = message.row_id ?? message.id
    const stableId = rowId == null
      ? crypto.createHash('sha256')
          .update(`${profile}\0${threadId}\0${message.role}\0${message.timestamp || index}\0${content}`)
          .digest('hex')
      : String(rowId)
    return [{
      content,
      createdAt: createdAt(message.timestamp, index),
      id: `hermes:${profile}:${threadId}:${stableId}`,
      role: message.role
    }]
  })
  return result.sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
}
