import { createStep, createWorkflow } from '@mastra/core/workflows'
import { z } from 'zod'
import { hermesSupervisorAgent } from '../agents/hermes-supervisor.ts'
import { HermesClient } from '../hermes/client.ts'
import { queryApprovedKnowledge, type KnowledgeMatch } from '../rag/knowledge.ts'
import { mastraRuntimeConfig } from '../runtime-config.ts'
import { executionEvidenceScorer } from '../scorers/execution-evidence.ts'
import { hermesExecutionOutputSchema, hermesLifecycleOutputSchema } from '../tools/hermes-execution.ts'

export const taskInputSchema = z.object({
  workspaceId: z.string().trim().min(1).max(128),
  taskId: z.string().trim().min(1).max(256),
  origin: z.object({
    threadId: z.string().trim().min(1).max(256),
    turnId: z.string().trim().min(1).max(128),
    toolCallId: z.string().trim().min(1).max(128)
  }).optional(),
  tool: z.object({
    name: z.string().trim().min(1).max(128),
    arguments: z.record(z.string(), z.unknown()),
    argumentsPreview: z.string().max(240),
    argumentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    policyVersion: z.string().trim().min(1).max(64),
    risk: z.enum(['read-only', 'private-read', 'mutation', 'external-send', 'expensive', 'unknown'])
  }).optional(),
  runtime: z.object({
    location: z.enum(['local', 'orgo']),
    remoteConnectionId: z.string().trim().min(1).max(128).optional(),
    version: z.string().trim().min(1).max(128).optional()
  }).optional(),
  parentRunId: z.string().trim().min(1).max(128).optional(),
  profile: z.string().trim().min(1).max(64).optional(),
  instructions: z.string().trim().min(1).max(40_000),
  systemContext: z.string().trim().max(8_000).optional()
})

const preparedTaskSchema = taskInputSchema.extend({
  preparation: z.object({
    knowledgeSources: z.array(z.string()),
    mode: z.enum(['agent', 'retrieval', 'none']),
    summary: z.string().max(8_000)
  })
})

type TaskInput = z.infer<typeof taskInputSchema>
type ExecutionOutput = z.infer<typeof hermesExecutionOutputSchema>

export interface HermesLifecycleDependencies {
  defaultProfile: string
  executeHermes(input: TaskInput): Promise<ExecutionOutput>
  prepareBrief?: (input: TaskInput & { knowledge: string; runId: string }) => Promise<string>
  queryKnowledge(query: string, workspaceId: string, topK: number): Promise<KnowledgeMatch[]>
  scoreEvidence(
    output: ExecutionOutput,
    runId: string
  ): Promise<{
    reason?: string
    score: number
    traceId?: string
  }>
}

const defaultDependencies: HermesLifecycleDependencies = {
  defaultProfile: mastraRuntimeConfig.hermes.defaultProfile,
  executeHermes: input => new HermesClient(mastraRuntimeConfig.hermes).execute(input),
  queryKnowledge: queryApprovedKnowledge,
  scoreEvidence: async (output, runId) => {
    const scored = await executionEvidenceScorer.run({ runId: `${runId}:evidence`, output })
    return { score: scored.score, reason: scored.reason, traceId: scored.scoreTraceId }
  },
  ...(mastraRuntimeConfig.modelConfigured
    ? {
        prepareBrief: async (input: TaskInput & { knowledge: string; runId: string }) => {
          const result = await hermesSupervisorAgent.generate(
            [
              'Prepare a concise, safe execution brief for the durable Hermes workflow.',
              `Task: ${input.instructions}`,
              input.knowledge
                ? `Approved project knowledge:\n${input.knowledge}`
                : 'No approved project knowledge matched.',
              'Do not execute tools. Identify concrete success evidence and important constraints.'
            ].join('\n\n'),
            {
              maxSteps: 3,
              memory: {
                resource: input.workspaceId,
                thread: `workspace:${input.workspaceId}`
              },
              runId: `${input.runId}:prepare`
            }
          )
          return result.text.slice(0, 8_000)
        }
      }
    : {})
}

export function createHermesTaskLifecycle(dependencies: HermesLifecycleDependencies = defaultDependencies) {
  const prepareStep = createStep({
    id: 'prepare-with-supervisor',
    inputSchema: taskInputSchema,
    outputSchema: preparedTaskSchema,
    execute: async ({ inputData, runId }) => {
      const matches = await dependencies.queryKnowledge(inputData.instructions, inputData.workspaceId, 5)
      const knowledge = matches
        .map(match => `[${match.sourceId}] ${match.text}`)
        .join('\n\n')
        .slice(0, 6_000)
      const summary = dependencies.prepareBrief
        ? (await dependencies.prepareBrief({ ...inputData, knowledge, runId })).slice(0, 8_000)
        : knowledge

      return {
        ...inputData,
        systemContext: [inputData.systemContext, summary].filter(Boolean).join('\n\n').slice(0, 8_000) || undefined,
        preparation: {
          knowledgeSources: [...new Set(matches.map(match => match.sourceId))],
          mode: dependencies.prepareBrief ? ('agent' as const) : knowledge ? ('retrieval' as const) : ('none' as const),
          summary
        }
      }
    }
  })

  const approvalStep = createStep({
    id: 'await-execution-approval',
    inputSchema: preparedTaskSchema,
    resumeSchema: z.object({ approved: z.boolean() }),
    suspendSchema: z.object({
      workspaceId: z.string(),
      taskId: z.string(),
      profile: z.string(),
      instructionsPreview: z.string(),
      origin: taskInputSchema.shape.origin,
      tool: taskInputSchema.shape.tool,
      runtime: taskInputSchema.shape.runtime
    }),
    outputSchema: preparedTaskSchema,
    execute: async ({ inputData, resumeData, suspend }) => {
      if (!resumeData) {
        return suspend({
          workspaceId: inputData.workspaceId,
          taskId: inputData.taskId,
          profile: inputData.profile || dependencies.defaultProfile,
          instructionsPreview: inputData.instructions.slice(0, 240),
          origin: inputData.origin,
          tool: inputData.tool,
          runtime: inputData.runtime
        })
      }
      if (!resumeData.approved) throw new Error('Hermes execution was declined by the operator.')
      return inputData
    }
  })

  const executeStep = createStep({
    id: 'execute-with-hermes',
    inputSchema: taskInputSchema,
    outputSchema: hermesExecutionOutputSchema,
    execute: async ({ inputData }) => dependencies.executeHermes(inputData)
  })

  const evidenceStep = createStep({
    id: 'score-execution-evidence',
    inputSchema: hermesExecutionOutputSchema,
    outputSchema: hermesLifecycleOutputSchema,
    execute: async ({ inputData, runId }) => {
      const scored = await dependencies.scoreEvidence(inputData, runId)
      const report = [
        '# Hermes execution evidence',
        '',
        `- Status: ${inputData.status}`,
        `- Completion: ${inputData.completionId}`,
        `- Session: ${inputData.sessionId || 'unavailable'}`,
        `- Score: ${scored.score}`,
        `- Reason: ${scored.reason || 'No reason returned.'}`,
        '',
        inputData.response
      ].join('\n')

      return {
        ...inputData,
        evidence: {
          score: scored.score,
          reason: scored.reason || 'Execution evidence scorer returned no reason.',
          ...(scored.traceId ? { traceId: scored.traceId } : {})
        },
        artifacts: [
          {
            id: `${runId}:evidence`,
            kind: 'text' as const,
            label: 'Hermes execution evidence',
            mimeType: 'text/markdown',
            content: report
          }
        ]
      }
    }
  })

  return createWorkflow({
    id: 'hermes-task-lifecycle',
    description: 'Durably approve, execute, and retain evidence for a Hermes task.',
    inputSchema: taskInputSchema,
    outputSchema: hermesLifecycleOutputSchema
  })
    .then(prepareStep)
    .then(approvalStep)
    .then(executeStep)
    .then(evidenceStep)
    .commit()
}

export const hermesTaskLifecycle = createHermesTaskLifecycle()
