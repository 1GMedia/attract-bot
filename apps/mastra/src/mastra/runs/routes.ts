import type { MastraListRunsRequest, MastraStartRunInput } from '@hermes/shared/mastra-runs'
import { registerApiRoute, type ApiRoute } from '@mastra/core/server'
import { z } from 'zod'
import { mastraRuntimeConfig } from '../runtime-config.ts'
import { taskInputSchema } from '../workflows/hermes-task-lifecycle.ts'
import { changedTurns } from '../turns/turn-service.ts'
import { cancelRun, changedRuns, getRun, listRuns, resolveRunApproval, retryRun, startRun } from './run-service.ts'
import { instanceMatches } from './instance-guard.ts'

const instanceSchema = z.object({ instanceId: z.string().min(1) })
const startSchema = taskInputSchema.extend({ instanceId: z.string().min(1) })
const mutationSchema = instanceSchema.extend({ runId: z.string().min(1) })
const approvalSchema = mutationSchema.extend({
  decision: z.enum(['approve', 'decline']),
  stepId: z.string().min(1)
})

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Mastra request failed.'
}

function ensureInstance(instanceId: string): void {
  if (!instanceMatches(instanceId, mastraRuntimeConfig.instanceId)) {
    const error = new Error('Mastra instance changed. Refresh runs before retrying this action.')
    Object.assign(error, { status: 409 })
    throw error
  }
}

async function body(c: any): Promise<unknown> {
  return c.req.json().catch(() => null)
}

async function respond(c: any, operation: () => Promise<unknown>) {
  try {
    return c.json(await operation())
  } catch (error) {
    const status = typeof (error as any)?.status === 'number' ? (error as any).status : 400
    return c.json({ error: { message: errorMessage(error) } }, status)
  }
}

export const runApiRoutes: ApiRoute[] = [
  registerApiRoute('/korgo/runs', {
    method: 'GET',
    requiresAuth: true,
    handler: async (c: any) =>
      respond(c, async () => {
        const query = c.req.query()
        const request: MastraListRunsRequest = {
          ...(query.workspaceId ? { workspaceId: query.workspaceId } : {}),
          ...(query.state ? { state: query.state } : {}),
          ...(query.cursor ? { cursor: query.cursor } : {}),
          ...(query.limit ? { limit: Number(query.limit) } : {})
        } as MastraListRunsRequest
        return listRuns(c.get('mastra'), request)
      })
  }),
  registerApiRoute('/korgo/runs', {
    method: 'POST',
    requiresAuth: true,
    handler: async (c: any) =>
      respond(c, async () => {
        const parsed = startSchema.parse(await body(c))
        ensureInstance(parsed.instanceId)
        const { instanceId: _instanceId, ...input } = parsed
        return startRun(c.get('mastra'), input as MastraStartRunInput)
      })
  }),
  registerApiRoute('/korgo/runs/events', {
    method: 'GET',
    requiresAuth: true,
    handler: async (c: any) =>
      respond(c, async () => {
        const cursor = new Date().toISOString()
        const after = c.req.query('after')
        const [runs, turns] = await Promise.all([
          changedRuns(c.get('mastra'), after),
          changedTurns(c.get('mastra'), after)
        ])
        return { cursor, runs, turns }
      })
  }),
  registerApiRoute('/korgo/runs/:runId', {
    method: 'GET',
    requiresAuth: true,
    handler: async (c: any) =>
      respond(c, async () => {
        const run = await getRun(c.get('mastra'), c.req.param('runId'))
        if (!run) {
          const error = new Error('Workflow run not found.')
          Object.assign(error, { status: 404 })
          throw error
        }
        return run
      })
  }),
  registerApiRoute('/korgo/runs/:runId/approval', {
    method: 'POST',
    requiresAuth: true,
    handler: async (c: any) =>
      respond(c, async () => {
        const parsed = approvalSchema.parse(await body(c))
        if (parsed.runId !== c.req.param('runId')) throw new Error('Run identity mismatch.')
        ensureInstance(parsed.instanceId)
        return resolveRunApproval(c.get('mastra'), parsed)
      })
  }),
  registerApiRoute('/korgo/runs/:runId/cancel', {
    method: 'POST',
    requiresAuth: true,
    handler: async (c: any) =>
      respond(c, async () => {
        const parsed = mutationSchema.parse(await body(c))
        if (parsed.runId !== c.req.param('runId')) throw new Error('Run identity mismatch.')
        ensureInstance(parsed.instanceId)
        return cancelRun(c.get('mastra'), parsed.runId)
      })
  }),
  registerApiRoute('/korgo/runs/:runId/retry', {
    method: 'POST',
    requiresAuth: true,
    handler: async (c: any) =>
      respond(c, async () => {
        const parsed = mutationSchema.parse(await body(c))
        if (parsed.runId !== c.req.param('runId')) throw new Error('Run identity mismatch.')
        ensureInstance(parsed.instanceId)
        return retryRun(c.get('mastra'), parsed.runId)
      })
  })
]
