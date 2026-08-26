import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { MastraCompositeStore } from "@mastra/core/storage";
import { DuckDBStore } from "@mastra/duckdb";
import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import { mastraRuntimeConfig } from "./runtime-config.ts";

mkdirSync(mastraRuntimeConfig.dataDirectory, { recursive: true, mode: 0o700 });

export const primaryStore = new LibSQLStore({
  id: "hermes-mastra-primary",
  url: `file:${join(mastraRuntimeConfig.dataDirectory, "mastra.db")}`,
});

export const knowledgeVectorStore = new LibSQLVector({
  id: "hermes-knowledge-vectors",
  url: `file:${join(mastraRuntimeConfig.dataDirectory, "knowledge-vectors.db")}`,
});

export const observabilityStore = new DuckDBStore({
  id: "hermes-mastra-observability",
  path: join(mastraRuntimeConfig.dataDirectory, "observability.duckdb"),
  memoryLimit: "512MB",
  threads: 2,
});

export const mastraStorage = new MastraCompositeStore({
  id: "hermes-mastra-storage",
  default: primaryStore,
  domains: {
    observability: observabilityStore.observability,
  },
});
