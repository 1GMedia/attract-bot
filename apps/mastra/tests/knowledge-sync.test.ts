import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { verifyKnowledgeSource } from '../src/mastra/rag/routes.ts'

describe('remote knowledge sync contract', () => {
  it('accepts a content-addressed explicit source', () => {
    const content = '# Approved project knowledge'
    expect(() => verifyKnowledgeSource({
      content,
      contentHash: createHash('sha256').update(content).digest('hex'),
      path: 'README.md',
      sourceId: 'workspace:README.md'
    })).not.toThrow()
  })

  it('rejects content that changed after hashing', () => {
    expect(() => verifyKnowledgeSource({
      content: 'changed',
      contentHash: createHash('sha256').update('original').digest('hex'),
      path: 'README.md',
      sourceId: 'workspace:README.md'
    })).toThrow(/hash did not match/)
  })
})
