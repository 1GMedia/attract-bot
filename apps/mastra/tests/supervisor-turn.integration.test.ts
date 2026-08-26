import { Mastra } from '@mastra/core/mastra'
import { InMemoryStore } from '@mastra/core/storage'
import { describe, expect, it, vi } from 'vitest'
import { mapTurnSummary } from '../src/mastra/turns/turn-service.ts'
import { createSupervisorTurnWorkflow } from '../src/mastra/workflows/supervisor-turn.ts'

describe('supervisor turn workflow', () => {
  it('persists a conversational response without creating an action run', async () => {
    const generate = vi.fn(async () => ({
      assistantMessage: 'I remember the workspace context.',
      linkedRunIds: [],
      traceId: 'trace-turn-1'
    }))
    const mastra = new Mastra({
      storage: new InMemoryStore({ id: 'supervisor-turn-conversation' }),
      workflows: { supervisorTurn: createSupervisorTurnWorkflow({ generate }) }
    })
    const run = await mastra.getWorkflow('supervisorTurn').createRun({
      runId: 'turn-1',
      resourceId: 'workspace-1:default'
    })
    const result = await run.start({
      inputData: {
        clientTurnId: 'client-1',
        message: 'What do you remember?',
        profile: 'default',
        threadId: 'chat-1',
        turnId: 'turn-1',
        workspaceId: 'workspace-1'
      }
    })

    expect(result.status).toBe('success')
    expect(generate).toHaveBeenCalledOnce()
    if (result.status !== 'success') throw new Error(`Expected success, received ${result.status}.`)
    expect(result.result).toMatchObject({
      assistantMessage: 'I remember the workspace context.',
      linkedRunIds: [],
      traceId: 'trace-turn-1'
    })
  })

  it('projects a completed proposal as approval-blocked while its linked run is suspended', () => {
    const snapshot = {
      status: 'success',
      payload: {
        clientTurnId: 'client-2',
        profile: 'agency',
        threadId: 'chat-2',
        turnId: 'turn-2',
        workspaceId: 'workspace-2'
      },
      result: { linkedRunIds: ['run-2'] }
    } as any
    const now = new Date('2026-08-26T00:00:00.000Z')
    const turn = mapTurnSummary('turn-2', snapshot, now, now, [{
      runId: 'run-2',
      workflowId: 'hermes-task-lifecycle',
      workspaceId: 'workspace-2',
      taskId: 'task-2',
      profile: 'agency',
      instructionsPreview: 'Observe Orgo.',
      state: 'awaiting-approval',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      evidence: { status: 'missing' }
    }])

    expect(turn).toMatchObject({
      turnId: 'turn-2',
      linkedRunIds: ['run-2'],
      state: 'awaiting-tool-approval'
    })
    expect(turn.finishedAt).toBeUndefined()
  })
})
