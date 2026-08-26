import { RequestContext } from '@mastra/core/request-context'
import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import { hermesSupervisorAgent } from '../agents/hermes-supervisor.ts'
import { mastraRuntimeConfig } from '../runtime-config.ts'

export const supervisorTurnInputSchema = z.object({
  clientTurnId: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(40_000),
  profile: z.string().trim().min(1).max(64),
  threadId: z.string().trim().min(1).max(256),
  turnId: z.string().trim().min(1).max(128),
  workspaceId: z.string().trim().min(1).max(128)
})

export const supervisorTurnOutputSchema = supervisorTurnInputSchema.omit({ message: true }).extend({
  assistantMessage: z.string().max(40_000),
  linkedRunIds: z.array(z.string()),
  traceId: z.string().optional()
})

export interface SupervisorTurnDependencies {
  generate(input: z.infer<typeof supervisorTurnInputSchema>): Promise<{
    assistantMessage: string
    linkedRunIds: string[]
    traceId?: string
  }>
}

function linkedRunIds(toolResults: unknown): string[] {
  if (!Array.isArray(toolResults)) return []
  return [...new Set(toolResults.flatMap(result => {
    if (!result || typeof result !== 'object') return []
    const output = (result as { output?: unknown }).output
    if (!output || typeof output !== 'object') return []
    const runId = (output as { runId?: unknown }).runId
    return typeof runId === 'string' && runId ? [runId] : []
  }))]
}

const defaultDependencies: SupervisorTurnDependencies = {
  generate: async input => {
    const requestContext = new RequestContext(Object.entries({
      clientTurnId: input.clientTurnId,
      profile: input.profile,
      runtimeLocation: mastraRuntimeConfig.runtimeLocation,
      runtimeVersion: mastraRuntimeConfig.runtimeVersion,
      threadId: input.threadId,
      turnId: input.turnId,
      workspaceId: input.workspaceId
    }))
    const result = await hermesSupervisorAgent.generate(input.message, {
      maxSteps: 6,
      memory: {
        resource: `${input.workspaceId}:${input.profile}`,
        thread: input.threadId
      },
      requestContext,
      runId: input.turnId,
      savePerStep: true
    })
    return {
      assistantMessage: result.text,
      linkedRunIds: linkedRunIds(result.toolResults),
      ...(result.traceId ? { traceId: result.traceId } : {})
    }
  }
}

export function createSupervisorTurnWorkflow(dependencies: SupervisorTurnDependencies = defaultDependencies) {
  const respond = createStep({
    id: 'respond-with-supervisor',
    inputSchema: supervisorTurnInputSchema,
    outputSchema: supervisorTurnOutputSchema,
    execute: async ({ inputData }) => ({
      ...inputData,
      ...(await dependencies.generate(inputData))
    })
  })

  return createWorkflow({
    id: 'supervisor-turn',
    description: 'Persist and execute a canonical Bot conversation turn through the Mastra supervisor.',
    inputSchema: supervisorTurnInputSchema,
    outputSchema: supervisorTurnOutputSchema
  })
    .then(respond)
    .commit()
}

export const supervisorTurn = createSupervisorTurnWorkflow()
