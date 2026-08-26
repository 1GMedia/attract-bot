import { Mastra } from '@mastra/core/mastra'
import { InMemoryStore } from '@mastra/core/storage'
import { describe, expect, it, vi } from 'vitest'
import { createHermesTaskLifecycle } from '../src/mastra/workflows/hermes-task-lifecycle.ts'

describe('Hermes task lifecycle integration', () => {
  it('prepares, suspends, survives run reattachment, executes once, and persists scored evidence', async () => {
    const executeHermes = vi.fn(async () => ({
      completionId: 'completion-1',
      sessionId: 'session-1',
      status: 'completed' as const,
      finishReason: 'stop',
      response: 'Read-only connector evidence returned.',
      usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 }
    }))
    const workflow = createHermesTaskLifecycle({
      defaultProfile: 'agency',
      executeHermes,
      queryKnowledge: async () => [{ sourceId: 'workspace:AGENTS.md', score: 0.9, text: 'Never mutate in a canary.' }],
      scoreEvidence: async () => ({
        score: 1,
        reason: 'Completion and session evidence are present.',
        traceId: 'trace-1'
      })
    })
    const mastra = new Mastra({
      storage: new InMemoryStore({ id: 'workflow-integration' }),
      workflows: { hermesTaskLifecycle: workflow }
    })
    const registered = mastra.getWorkflow('hermesTaskLifecycle')
    const runId = 'durable-run-1'
    const firstRun = await registered.createRun({ runId, resourceId: 'workspace-1' })
    const suspended = await firstRun.start({
      inputData: {
        workspaceId: 'workspace-1',
        taskId: 'task-1',
        profile: 'agency',
        instructions: 'Read the connected account and report evidence.'
      }
    })

    expect(suspended.status).toBe('suspended')
    expect(executeHermes).not.toHaveBeenCalled()

    // A new Run object with the same durable ID models desktop/service relaunch recovery.
    const recoveredRun = await registered.createRun({ runId, resourceId: 'workspace-1' })
    const completed = await recoveredRun.resume({
      step: 'await-execution-approval',
      resumeData: { approved: true }
    })

    expect(completed.status).toBe('success')
    expect(executeHermes).toHaveBeenCalledOnce()
    if (completed.status !== 'success') throw new Error(`Expected success, received ${completed.status}.`)
    expect(completed.result).toMatchObject({
      completionId: 'completion-1',
      sessionId: 'session-1',
      evidence: { score: 1, traceId: 'trace-1' },
      artifacts: [{ label: 'Hermes execution evidence' }]
    })
  })

  it('does not invoke Hermes when approval is declined', async () => {
    const executeHermes = vi.fn()
    const workflow = createHermesTaskLifecycle({
      defaultProfile: 'default',
      executeHermes,
      queryKnowledge: async () => [],
      scoreEvidence: async () => ({ score: 0 })
    })
    const mastra = new Mastra({
      storage: new InMemoryStore({ id: 'workflow-decline' }),
      workflows: { hermesTaskLifecycle: workflow }
    })
    const run = await mastra.getWorkflow('hermesTaskLifecycle').createRun({ resourceId: 'workspace-1' })
    const suspended = await run.start({
      inputData: { workspaceId: 'workspace-1', taskId: 'task-2', instructions: 'Do not execute.' }
    })
    expect(suspended.status).toBe('suspended')
    const declined = await run.resume({ step: 'await-execution-approval', resumeData: { approved: false } })
    expect(declined.status).toBe('failed')
    expect(executeHermes).not.toHaveBeenCalled()
  })
})
