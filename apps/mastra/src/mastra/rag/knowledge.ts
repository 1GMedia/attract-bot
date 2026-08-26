import { createHash } from "node:crypto";
import { fastembed } from "@mastra/fastembed";
import { MDocument, createVectorQueryTool } from "@mastra/rag";
import { knowledgeVectorStore } from "../storage.ts";

export const KNOWLEDGE_INDEX = "hermes-knowledge";

export const queryHermesKnowledgeTool = createVectorQueryTool({
  id: "query-hermes-knowledge",
  description: "Search approved Hermes Bot operating knowledge and project context.",
  vectorStore: knowledgeVectorStore,
  indexName: KNOWLEDGE_INDEX,
  model: fastembed.small,
  includeSources: true,
});

export async function ingestKnowledgeDocument(input: {
  sourceId: string;
  text: string;
  metadata?: Record<string, string | number | boolean>;
}): Promise<{ sourceId: string; chunkCount: number }> {
  const document = MDocument.fromMarkdown(input.text, {
    ...input.metadata,
    sourceId: input.sourceId,
  });
  const chunks = await document.chunk({ strategy: "recursive", maxSize: 1_200, overlap: 160 });
  const texts = chunks.map((chunk) => chunk.getText());
  if (!texts.length) return { sourceId: input.sourceId, chunkCount: 0 };

  const { embeddings } = await fastembed.small.doEmbed({ values: texts });
  const indexes = await knowledgeVectorStore.listIndexes();
  if (!indexes.includes(KNOWLEDGE_INDEX)) {
    await knowledgeVectorStore.createIndex({
      indexName: KNOWLEDGE_INDEX,
      dimension: embeddings[0].length,
      metric: "cosine",
    });
  }

  await knowledgeVectorStore.upsert({
    indexName: KNOWLEDGE_INDEX,
    vectors: embeddings,
    ids: texts.map((text, index) => createHash("sha256")
      .update(`${input.sourceId}\0${index}\0${text}`)
      .digest("hex")),
    metadata: chunks.map((chunk, index) => ({
      ...chunk.metadata,
      sourceId: input.sourceId,
      text: texts[index],
      chunkIndex: index,
    })),
    deleteFilter: { sourceId: input.sourceId },
  });

  return { sourceId: input.sourceId, chunkCount: chunks.length };
}

export async function deleteKnowledgeDocument(sourceId: string): Promise<void> {
  const indexes = await knowledgeVectorStore.listIndexes();
  if (!indexes.includes(KNOWLEDGE_INDEX)) return;
  await knowledgeVectorStore.deleteVectors({
    indexName: KNOWLEDGE_INDEX,
    filter: { sourceId },
  });
}

export interface KnowledgeMatch {
  score: number;
  sourceId: string;
  text: string;
}

export async function queryApprovedKnowledge(query: string, workspaceId: string, topK = 5): Promise<KnowledgeMatch[]> {
  const indexes = await knowledgeVectorStore.listIndexes();
  if (!indexes.includes(KNOWLEDGE_INDEX)) return [];

  const { embeddings } = await fastembed.small.doEmbed({ values: [query] });
  const matches = await knowledgeVectorStore.query({
    indexName: KNOWLEDGE_INDEX,
    queryVector: embeddings[0],
    topK,
    minScore: 0.2,
    filter: { workspaceId },
  });

  return matches.flatMap((match) => {
    const sourceId = typeof match.metadata?.sourceId === "string" ? match.metadata.sourceId : "";
    const text = typeof match.metadata?.text === "string" ? match.metadata.text : "";
    return sourceId && text ? [{ score: match.score, sourceId, text }] : [];
  });
}
