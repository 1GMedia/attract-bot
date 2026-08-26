import { afterEach, describe, expect, it } from 'vitest'

import { $mastraRuns } from './mastra-runs'
import { $operatorApprovals } from './operator-approvals'
import { clearAllPrompts, setApprovalRequest } from './prompts'

afterEach(() => {
  clearAllPrompts()
  $mastraRuns.set([])
})

describe('operator approval adapter', () => {
  it('projects Hermes tools and Mastra workflows into one discriminated model', () => {
    setApprovalRequest({ command: 'git status', description: 'Inspect repository', sessionId: 'session-1' })
    $mastraRuns.set([
      {
        runId: 'run-1',
        workflowId: 'hermes-task-lifecycle',
        workspaceId: 'workspace-1',
        taskId: 'task-1',
        profile: 'default',
        instructionsPreview: 'Read connected account evidence.',
        state: 'awaiting-approval',
        createdAt: '2026-08-25T12:00:00.000Z',
        updatedAt: '2026-08-25T12:01:00.000Z',
        evidence: { status: 'missing' },
        approval: {
          runId: 'run-1',
          stepId: 'await-execution-approval',
          instanceId: 'instance-1',
          requestedAt: '2026-08-25T12:01:00.000Z',
          workspaceId: 'workspace-1',
          taskId: 'task-1',
          profile: 'default',
          instructionsPreview: 'Read connected account evidence.'
        }
      }
    ])

    expect($operatorApprovals.get().map(approval => approval.source)).toEqual(['hermes-tool', 'mastra-workflow'])
  })
})
