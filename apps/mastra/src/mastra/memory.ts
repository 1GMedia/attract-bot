import { fastembed } from "@mastra/fastembed";
import { Memory } from "@mastra/memory";
import { knowledgeVectorStore, primaryStore } from "./storage.ts";

export const supervisorMemory = new Memory({
  storage: primaryStore,
  vector: knowledgeVectorStore,
  embedder: fastembed.small,
  options: {
    lastMessages: 30,
    semanticRecall: {
      topK: 8,
      messageRange: 3,
    },
    generateTitle: false,
  },
});
