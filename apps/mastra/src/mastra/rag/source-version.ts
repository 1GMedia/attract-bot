import { createHash } from 'node:crypto'

export interface VersionedKnowledgeSource {
  contentHash: string
  version: number
}

export function hashKnowledgeContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

export function nextKnowledgeVersion(previous: VersionedKnowledgeSource | undefined, contentHash: string): number {
  if (!previous) return 1
  return previous.contentHash === contentHash ? previous.version : previous.version + 1
}
