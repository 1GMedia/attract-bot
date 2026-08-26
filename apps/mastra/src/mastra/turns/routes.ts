import type { MastraStartTurnInput } from '@hermes/shared/mastra-runs'
import { registerApiRoute, type ApiRoute } from '@mastra/core/server'
import { z } from 'zod'
import { mastraRuntimeConfig } from '../runtime-config.ts'
import { instanceMatches } from '../runs/instance-guard.ts'
import { supervisorTurnInputSchema } from '../workflows/supervisor-turn.ts'
import { cancelTurn, importHermesHistory, listMessages, startTurn } from './turn-service.ts'

const messageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  threadId: z.string().trim().min(1).max(256)
})
const startSchema = supervisorTurnInputSchema.omit({ turnId: true }).extend({ instanceId: z.string().min(1) })
const cancelSchema = z.object({ instanceId: z.string().min(1), turnId: z.string().min(1) })
const importSchema = z.object({
  instanceId: z.string().min(1),
  messages: z.array(z.object({
    content: z.string().max(40_000),
    createdAt: z.string().datetime(),
    id: z.string().min(1).max(256),
    role: z.enum(['assistant', 'user'])
  })).max(500),
  profile: z.string().trim().min(1).max(64),
  threadId: z.string().trim().min(1).max(256),
  workspaceId: z.string().trim().min(1).max(512)
})

function ensureInstance(instanceId: string): void {
  if (!instanceMatches(instanceId, mastraRuntimeConfig.instanceId)) {
    const error = new Error('Mastra instance changed. Refresh the conversation before retrying this action.')
    Object.assign(error, { status: 409 })
    throw error
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Mastra request failed.'
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

export const turnApiRoutes: ApiRoute[] = [
  registerApiRoute('/korgo/threads/import', {
    method: 'POST',
    requiresAuth: true,
    handler: async (c: any) => respond(c, async () => {
      const parsed = importSchema.parse(await body(c))
      ensureInstance(parsed.instanceId)
      const { instanceId: _instanceId, ...input } = parsed
      return importHermesHistory(input)
    })
  }),
  registerApiRoute('/korgo/messages', {
    method: 'GET',
    requiresAuth: true,
    handler: async (c: any) => respond(c, async () => listMessages(messageQuerySchema.parse(c.req.query())))
  }),
  registerApiRoute('/korgo/turns', {
    method: 'POST',
    requiresAuth: true,
    handler: async (c: any) => respond(c, async () => {
      const parsed = startSchema.parse(await body(c))
      ensureInstance(parsed.instanceId)
      const { instanceId: _instanceId, ...input } = parsed
      return startTurn(c.get('mastra'), input as MastraStartTurnInput)
    })
  }),
  registerApiRoute('/korgo/turns/:turnId/cancel', {
    method: 'POST',
    requiresAuth: true,
    handler: async (c: any) => respond(c, async () => {
      const parsed = cancelSchema.parse(await body(c))
      if (parsed.turnId !== c.req.param('turnId')) throw new Error('Turn identity mismatch.')
      ensureInstance(parsed.instanceId)
      return cancelTurn(c.get('mastra'), parsed.turnId)
    })
  })
]
