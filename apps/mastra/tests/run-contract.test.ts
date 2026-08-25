import { describe, expect, it } from 'vitest'
import { nextKnowledgeVersion, hashKnowledgeContent } from '../src/mastra/rag/source-version.ts'
import { redactRunText } from '../src/mastra/runs/redaction.ts'
import { mapMastraRunState, mapMastraRunSummary } from '../src/mastra/runs/run-service.ts'

const createdAt = new Date('2026-08-25T12:00:00.000Z')
const updatedAt = new Date('2026-08-25T12:01:00.000Z')

describe('desktop run contract', () => {
  it('maps suspended native runs into stable approval identities', () => {
    const snapshot = {
      status: 'suspended',
      context: {
        input: {
          workspaceId: 'workspace-1',
          taskId: 'task-1',
          profile: 'agency',
          parentRunId: 'parent-1',
          instructions: 'Read the connected account and report evidence.'
        },
        'prepare-with-supervisor': { status: 'success' },
        'await-execution-approval': { status: 'suspended' }
      }
    } as any

    expect(mapMastraRunState(snapshot)).toBe('awaiting-approval')
    expect(mapMastraRunSummary('run-1', snapshot, createdAt, updatedAt)).toMatchObject({
      runId: 'run-1',
      parentRunId: 'parent-1',
      state: 'awaiting-approval',
      approval: {
        runId: 'run-1',
        stepId: 'await-execution-approval',
        workspaceId: 'workspace-1'
      }
    })
  })

  it('maps native terminal states without leaking Mastra wire names', () => {
    expect(mapMastraRunState({ status: 'success' } as any)).toBe('succeeded')
    expect(mapMastraRunState({ status: 'canceled' } as any)).toBe('cancelled')
    expect(mapMastraRunState({ status: 'tripwire' } as any)).toBe('failed')
  })

  it('redacts connector and authorization material from desktop text', () => {
    const text = 'Authorization: Bearer super-secret-token-123 and api_key=privatevalue123 ck_composio12345'
    const redacted = redactRunText(text)!
    expect(redacted).not.toContain('super-secret-token-123')
    expect(redacted).not.toContain('privatevalue123')
    expect(redacted).not.toContain('ck_composio12345')
    expect(redacted.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(3)
  })

  it('hashes content deterministically and increments only on replacement', () => {
    const firstHash = hashKnowledgeContent('version one')
    const nextHash = hashKnowledgeContent('version two')
    expect(firstHash).toBe(hashKnowledgeContent('version one'))
    expect(nextKnowledgeVersion(undefined, firstHash)).toBe(1)
    expect(nextKnowledgeVersion({ contentHash: firstHash, version: 3 }, firstHash)).toBe(3)
    expect(nextKnowledgeVersion({ contentHash: firstHash, version: 3 }, nextHash)).toBe(4)
  })
})
