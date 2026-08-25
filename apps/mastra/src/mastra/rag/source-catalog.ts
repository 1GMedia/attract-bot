import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { ingestKnowledgeDocument } from './knowledge.ts'
import { mastraRuntimeConfig } from '../runtime-config.ts'
import { hashKnowledgeContent, nextKnowledgeVersion } from './source-version.ts'

const CATALOG_FILE = join(mastraRuntimeConfig.dataDirectory, 'knowledge-sources.json')
const MAX_SOURCE_BYTES = 2 * 1024 * 1024

export interface KnowledgeSourceRecord {
  chunkCount: number
  contentHash: string
  indexedAt: string
  path: string
  sourceId: string
  version: number
  workspaceId: string
}

interface KnowledgeCatalog {
  sources: KnowledgeSourceRecord[]
  version: 1
}

async function readCatalog(): Promise<KnowledgeCatalog> {
  try {
    const parsed = JSON.parse(await readFile(CATALOG_FILE, 'utf8')) as KnowledgeCatalog
    return parsed?.version === 1 && Array.isArray(parsed.sources) ? parsed : { version: 1, sources: [] }
  } catch {
    return { version: 1, sources: [] }
  }
}

async function writeCatalog(catalog: KnowledgeCatalog): Promise<void> {
  await mkdir(mastraRuntimeConfig.dataDirectory, { recursive: true, mode: 0o700 })
  const temporary = `${CATALOG_FILE}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, CATALOG_FILE)
}

export async function listKnowledgeSources(workspaceId?: string): Promise<KnowledgeSourceRecord[]> {
  const catalog = await readCatalog()
  return catalog.sources
    .filter(source => !workspaceId || source.workspaceId === workspaceId)
    .sort((a, b) => b.indexedAt.localeCompare(a.indexedAt))
}

export async function indexKnowledgeSource(input: {
  content: string
  path: string
  sourceId: string
  workspaceId: string
}): Promise<KnowledgeSourceRecord> {
  const catalog = await readCatalog()
  const contentHash = hashKnowledgeContent(input.content)
  const previous = catalog.sources.find(source => source.sourceId === input.sourceId)
  if (previous?.contentHash === contentHash) return previous

  const version = nextKnowledgeVersion(previous, contentHash)
  const result = await ingestKnowledgeDocument({
    sourceId: input.sourceId,
    text: input.content,
    metadata: {
      contentHash,
      path: input.path,
      version,
      workspaceId: input.workspaceId
    }
  })
  const record: KnowledgeSourceRecord = {
    chunkCount: result.chunkCount,
    contentHash,
    indexedAt: new Date().toISOString(),
    path: input.path,
    sourceId: input.sourceId,
    version,
    workspaceId: input.workspaceId
  }
  await writeCatalog({
    version: 1,
    sources: [...catalog.sources.filter(source => source.sourceId !== input.sourceId), record]
  })
  return record
}

function configuredPaths(environment: NodeJS.ProcessEnv): string[] {
  const raw = environment.KORGO_MASTRA_KNOWLEDGE_SOURCES?.trim()
  if (!raw) return []
  return raw
    .split(process.platform === 'win32' ? ';' : ':')
    .map(value => value.trim())
    .filter(Boolean)
}

export async function indexConfiguredKnowledgeSources(
  environment: NodeJS.ProcessEnv = process.env
): Promise<KnowledgeSourceRecord[]> {
  const workspaceId = environment.KORGO_MASTRA_WORKSPACE_ID?.trim() || 'desktop'
  const records: KnowledgeSourceRecord[] = []
  for (const configuredPath of configuredPaths(environment)) {
    if (!isAbsolute(configuredPath)) throw new Error('Configured Mastra knowledge sources must use absolute paths.')
    const path = resolve(configuredPath)
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_SOURCE_BYTES) {
      throw new Error(`Knowledge source must be a file no larger than ${MAX_SOURCE_BYTES} bytes: ${path}`)
    }
    const content = await readFile(path, 'utf8')
    const sourceId = `${workspaceId}:${basename(path)}:${createHash('sha256').update(path).digest('hex').slice(0, 12)}`
    records.push(await indexKnowledgeSource({ content, path, sourceId, workspaceId }))
  }
  return records
}
