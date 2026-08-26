import type { MastraStartRunInput } from '@hermes/shared/mastra-runs'
import { RequestContext } from '@mastra/core/request-context'
import { describe, expect, it, vi } from 'vitest'
import { createSupervisorActionTools, durableActionInput } from '../src/mastra/tools/supervisor-actions.ts'
import { riskForSupervisorTool, TOOL_POLICY_VERSION } from '../src/mastra/runs/tool-policy.ts'

const context = {
  clientTurnId: 'client-turn-1',
  profile: 'default',
  runtimeLocation: 'orgo' as const,
  remoteConnectionId: 'orgo-primary',
  runtimeVersion: 'release-1',
  threadId: 'chat-1',
  turnId: 'turn-1',
  workspaceId: 'workspace-1'
}

describe('supervisor durable action tools', () => {
  it('builds a workflow input with server-owned risk and origin identity', () => {
    const input = durableActionInput({
      arguments: { operation: 'Open the dashboard' },
      context,
      instructions: 'Perform the requested operation through Hermes.',
      toolCallId: 'tool-call-1',
      toolName: 'operate-orgo-computer'
    })

    expect(input).toMatchObject({
      workspaceId: 'workspace-1',
      taskId: 'turn-1:tool-call-1',
      origin: { threadId: 'chat-1', turnId: 'turn-1', toolCallId: 'tool-call-1' },
      tool: {
        name: 'operate-orgo-computer',
        arguments: { operation: 'Open the dashboard' },
        risk: 'mutation'
      },
      runtime: {
        location: 'orgo',
        remoteConnectionId: 'orgo-primary',
        version: 'release-1'
      }
    })
  })

  it('keeps connected-app risk unknown unless verified server metadata can classify it', () => {
    expect(riskForSupervisorTool('use-connected-app')).toBe('unknown')
    expect(TOOL_POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\./)
  })

  it('creates a durable run and never executes Hermes from the supervisor tool', async () => {
    const start = vi.fn(async (_mastra: never, input: MastraStartRunInput) => ({
      ...input,
      createdAt: '2026-08-26T00:00:00.000Z',
      evidence: { status: 'missing' as const },
      instructionsPreview: input.instructions.slice(0, 240),
      runId: 'run-1',
      state: 'awaiting-approval' as const,
      updatedAt: '2026-08-26T00:00:00.000Z',
      workflowId: 'hermes-task-lifecycle' as const
    }))
    const tools = createSupervisorActionTools(start as never)
    const requestContext = new RequestContext(Object.entries(context))

    const output = await tools.observeOrgoComputer.execute!(
      { objective: 'Describe the current desktop', target: 'primary display' },
      {
        agent: { toolCallId: 'tool-call-2' },
        mastra: {},
        requestContext
      } as never
    )

    expect(start).toHaveBeenCalledOnce()
    expect(start.mock.calls[0]?.[1]).toMatchObject({
      origin: { threadId: 'chat-1', turnId: 'turn-1', toolCallId: 'tool-call-2' },
      tool: { name: 'observe-orgo-computer', risk: 'private-read' }
    })
    expect(output).toMatchObject({
      approvalRequired: true,
      runId: 'run-1',
      state: 'awaiting-approval',
      toolName: 'observe-orgo-computer'
    })
  })

  it('fails closed outside an authenticated agent turn', async () => {
    const tools = createSupervisorActionTools(vi.fn() as never)
    await expect(
      tools.delegateHermesTask.execute!(
        { objective: 'Do work', successEvidence: 'A completion identifier' },
        { requestContext: new RequestContext(Object.entries(context)) } as never
      )
    ).rejects.toThrow('authenticated Mastra agent turn')
  })
})
