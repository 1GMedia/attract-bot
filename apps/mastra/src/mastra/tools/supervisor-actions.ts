import type { MastraRunSummary, MastraStartRunInput } from '@hermes/shared/mastra-runs'
import type { Mastra } from '@mastra/core/mastra'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { startRun } from '../runs/run-service.ts'
import {
  previewToolArguments,
  riskForSupervisorTool,
  TOOL_POLICY_VERSION,
  type SupervisorToolName
} from '../runs/tool-policy.ts'

const supervisorRequestContextSchema = z.object({
  clientTurnId: z.string().trim().min(1).max(128),
  profile: z.string().trim().min(1).max(64),
  remoteConnectionId: z.string().trim().min(1).max(128).optional(),
  runtimeLocation: z.enum(['local', 'orgo']).default('local'),
  runtimeVersion: z.string().trim().min(1).max(128).optional(),
  threadId: z.string().trim().min(1).max(256),
  turnId: z.string().trim().min(1).max(128),
  workspaceId: z.string().trim().min(1).max(128)
})

const durableActionOutputSchema = z.object({
  approvalRequired: z.literal(true),
  argumentsPreview: z.string(),
  risk: z.enum(['read-only', 'private-read', 'mutation', 'external-send', 'expensive', 'unknown']),
  runId: z.string(),
  state: z.string(),
  toolName: z.string()
})

type SupervisorContext = z.infer<typeof supervisorRequestContextSchema>
type StartRun = (mastra: Mastra, input: MastraStartRunInput) => Promise<MastraRunSummary>

function contextValue(context: { requestContext: { get: (key: string) => unknown } }): SupervisorContext {
  return supervisorRequestContextSchema.parse({
    clientTurnId: context.requestContext.get('clientTurnId'),
    profile: context.requestContext.get('profile'),
    remoteConnectionId: context.requestContext.get('remoteConnectionId'),
    runtimeLocation: context.requestContext.get('runtimeLocation') || 'local',
    runtimeVersion: context.requestContext.get('runtimeVersion'),
    threadId: context.requestContext.get('threadId'),
    turnId: context.requestContext.get('turnId'),
    workspaceId: context.requestContext.get('workspaceId')
  })
}

export function durableActionInput(input: {
  arguments: Record<string, unknown>
  context: SupervisorContext
  instructions: string
  toolCallId: string
  toolName: SupervisorToolName
}): MastraStartRunInput {
  const risk = riskForSupervisorTool(input.toolName)
  return {
    workspaceId: input.context.workspaceId,
    taskId: `${input.context.turnId}:${input.toolCallId}`,
    profile: input.context.profile,
    instructions: input.instructions,
    origin: {
      threadId: input.context.threadId,
      turnId: input.context.turnId,
      toolCallId: input.toolCallId
    },
    tool: {
      name: input.toolName,
      arguments: input.arguments,
      argumentsPreview: previewToolArguments(input.arguments),
      policyVersion: TOOL_POLICY_VERSION,
      risk
    },
    runtime: {
      location: input.context.runtimeLocation,
      ...(input.context.remoteConnectionId ? { remoteConnectionId: input.context.remoteConnectionId } : {}),
      ...(input.context.runtimeVersion ? { version: input.context.runtimeVersion } : {})
    }
  }
}

function modelOutput(output: z.infer<typeof durableActionOutputSchema>) {
  return {
    type: 'text' as const,
    value: `Durable action run ${output.runId} is ${output.state} and requires operator approval.`
  }
}

function createDurableActionExecutor(
  toolName: SupervisorToolName,
  instruction: (argumentsValue: Record<string, unknown>) => string,
  start: StartRun
) {
  return async (
    argumentsValue: Record<string, unknown>,
    executionContext: {
      agent?: { toolCallId: string }
      mastra?: unknown
      requestContext: { get: (key: string) => unknown }
    }
  ) => {
    if (!executionContext.agent?.toolCallId || !executionContext.mastra) {
      throw new Error('Supervisor actions require an authenticated Mastra agent turn.')
    }
    const input = durableActionInput({
      arguments: argumentsValue,
      context: contextValue(executionContext),
      instructions: instruction(argumentsValue),
      toolCallId: executionContext.agent.toolCallId,
      toolName
    })
    const run = await start(executionContext.mastra as Mastra, input)
    return {
      approvalRequired: true as const,
      argumentsPreview: input.tool!.argumentsPreview,
      risk: input.tool!.risk,
      runId: run.runId,
      state: run.state,
      toolName
    }
  }
}

export function createSupervisorActionTools(start: StartRun = startRun) {
  const delegateHermesTask = createTool({
    id: 'delegate-hermes-task',
    description: 'Start an approval-gated durable workflow for a general task that Hermes must execute.',
    inputSchema: z.object({
      objective: z.string().trim().min(1).max(2_000),
      successEvidence: z.string().trim().min(1).max(1_000)
    }),
    outputSchema: durableActionOutputSchema,
    execute: createDurableActionExecutor(
      'delegate-hermes-task',
      args => `Use Hermes to complete this task: ${String(args.objective)}\nRequired evidence: ${String(args.successEvidence)}`,
      start
    ),
    toModelOutput: modelOutput
  })

  const observeOrgoComputer = createTool({
    id: 'observe-orgo-computer',
    description: 'Request a read-only observation of the configured Orgo computer through Hermes.',
    inputSchema: z.object({
      objective: z.string().trim().min(1).max(2_000),
      target: z.string().trim().min(1).max(512).optional()
    }),
    outputSchema: durableActionOutputSchema,
    execute: createDurableActionExecutor(
      'observe-orgo-computer',
      args =>
        `Through Hermes, observe the configured Orgo computer without modifying it. Objective: ${String(args.objective)}` +
        (args.target ? `\nTarget: ${String(args.target)}` : '') +
        '\nReturn current-state evidence and an artifact when available.',
      start
    ),
    toModelOutput: modelOutput
  })

  const operateOrgoComputer = createTool({
    id: 'operate-orgo-computer',
    description: 'Request an exact computer operation on the configured Orgo computer through Hermes.',
    inputSchema: z.object({
      operation: z.string().trim().min(1).max(4_000),
      successEvidence: z.string().trim().min(1).max(1_000)
    }),
    outputSchema: durableActionOutputSchema,
    execute: createDurableActionExecutor(
      'operate-orgo-computer',
      args =>
        `Through Hermes, perform this exact operation on the configured Orgo computer: ${String(args.operation)}` +
        `\nRequired evidence: ${String(args.successEvidence)}`,
      start
    ),
    toModelOutput: modelOutput
  })

  const useConnectedApp = createTool({
    id: 'use-connected-app',
    description: 'Request connected-app work through Hermes using Composio or GoHighLevel.',
    inputSchema: z.object({
      arguments: z.record(z.string(), z.unknown()).default({}),
      connector: z.enum(['composio', 'gohighlevel']),
      operation: z.string().trim().min(1).max(1_000),
      successEvidence: z.string().trim().min(1).max(1_000)
    }),
    outputSchema: durableActionOutputSchema,
    execute: createDurableActionExecutor(
      'use-connected-app',
      args =>
        `Through Hermes, use the configured ${String(args.connector)} connector for this operation: ${String(args.operation)}` +
        `\nCanonical connector arguments: ${JSON.stringify(args.arguments || {})}` +
        `\nRequired evidence: ${String(args.successEvidence)}`,
      start
    ),
    toModelOutput: modelOutput
  })

  return { delegateHermesTask, observeOrgoComputer, operateOrgoComputer, useConnectedApp }
}

export const supervisorActionTools = createSupervisorActionTools()
