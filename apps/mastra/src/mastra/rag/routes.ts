import { registerApiRoute, type ApiRoute } from '@mastra/core/server'
import { z } from 'zod'
import { mastraRuntimeConfig } from '../runtime-config.ts'
import { instanceMatches } from '../runs/instance-guard.ts'
import { hashKnowledgeContent } from './source-version.ts'
import { indexKnowledgeSource, replaceWorkspaceKnowledgeSources } from './source-catalog.ts'

const sourceSchema = z.object({
  content: z.string().max(2 * 1024 * 1024),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  path: z.string().trim().min(1).max(1_024),
  sourceId: z.string().trim().min(1).max(1_024)
})
const syncSchema = z.object({
  instanceId: z.string().min(1),
  sources: z.array(sourceSchema).max(20),
  workspaceId: z.string().trim().min(1).max(1_024)
})

export function verifyKnowledgeSource(source: z.infer<typeof sourceSchema>): void {
  if (Buffer.byteLength(source.content, 'utf8') > 2 * 1024 * 1024) {
    throw new Error('Knowledge source exceeds the 2 MiB byte limit.')
  }
  if (hashKnowledgeContent(source.content) !== source.contentHash) {
    throw new Error(`Knowledge source hash did not match for ${source.sourceId}.`)
  }
}

export const knowledgeApiRoutes: ApiRoute[] = [
  registerApiRoute('/korgo/knowledge/sources', {
    method: 'POST',
    requiresAuth: true,
    handler: async (c: any) => {
      try {
        const parsed = syncSchema.parse(await c.req.json())
        if (!instanceMatches(parsed.instanceId, mastraRuntimeConfig.instanceId)) {
          return c.json({ error: { message: 'Mastra instance changed. Refresh knowledge before syncing.' } }, 409)
        }
        const records = []
        for (const source of parsed.sources) {
          verifyKnowledgeSource(source)
          records.push(await indexKnowledgeSource({ ...source, workspaceId: parsed.workspaceId }))
        }
        await replaceWorkspaceKnowledgeSources(parsed.workspaceId, records.map(record => record.sourceId))
        return c.json({
          sources: records.map(record => ({
            contentHash: record.contentHash,
            sourceId: record.sourceId,
            version: record.version
          }))
        })
      } catch (error) {
        return c.json({ error: { message: error instanceof Error ? error.message : 'Knowledge sync failed.' } }, 400)
      }
    }
  })
]
