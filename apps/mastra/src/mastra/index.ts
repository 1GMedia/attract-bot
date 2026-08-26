import { MastraJwtAuth } from "@mastra/auth";
import { Mastra } from "@mastra/core/mastra";
import { registerApiRoute } from "@mastra/core/server";
import { PinoLogger } from "@mastra/loggers";
import { MastraStorageExporter, Observability, SensitiveDataFilter } from "@mastra/observability";
import { hermesSupervisorAgent } from "./agents/hermes-supervisor.ts";
import { hermesMastraMcpServer } from "./mcp/hermes-mcp.ts";
import { indexConfiguredKnowledgeSources } from "./rag/source-catalog.ts";
import { knowledgeApiRoutes } from "./rag/routes.ts";
import { mastraRuntimeConfig } from "./runtime-config.ts";
import { runApiRoutes } from "./runs/routes.ts";
import { executionEvidenceScorer } from "./scorers/execution-evidence.ts";
import { knowledgeVectorStore, mastraStorage } from "./storage.ts";
import { hermesTaskLifecycle } from "./workflows/hermes-task-lifecycle.ts";
import { turnApiRoutes } from "./turns/routes.ts";
import { supervisorTurn } from "./workflows/supervisor-turn.ts";

const auth = mastraRuntimeConfig.auth.jwtSecret
  ? new MastraJwtAuth({ secret: mastraRuntimeConfig.auth.jwtSecret })
  : undefined;

await indexConfiguredKnowledgeSources();

async function verifiedCapabilities() {
  const indexes: string[] = await knowledgeVectorStore.listIndexes().catch((): string[] => []);
  return {
    agents: mastraRuntimeConfig.modelConfigured,
    workflows: true,
    memory: true,
    rag: indexes.includes("hermes-knowledge"),
    evals: true,
    storage: true,
    observability: true,
    mcpServer: true,
    studio: Boolean(process.env.MASTRA_STUDIO_PATH && mastraRuntimeConfig.auth.configured),
  };
}

export const mastra = new Mastra({
  agents: { hermesSupervisorAgent },
  workflows: { hermesTaskLifecycle, supervisorTurn },
  scorers: { executionEvidenceScorer },
  vectors: { knowledgeVectorStore },
  mcpServers: { hermesMastraMcpServer },
  storage: mastraStorage,
  logger: new PinoLogger({
    name: "HermesMastra",
    level: "info",
    prettyPrint: false,
    redact: {
      paths: [
        "*.authorization",
        "*.apiKey",
        "*.token",
        "*.secret",
        "*.instructions",
        "*.arguments",
        "*.argumentsPreview",
        "*.content",
        "*.message",
        "*.systemContext",
        "*.response",
        "*.transcript",
      ],
      censor: "[REDACTED]",
    },
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: "hermes-mastra-local",
        exporters: [new MastraStorageExporter()],
        spanOutputProcessors: [new SensitiveDataFilter({
          sensitiveFields: [
            "authorization",
            "apiKey",
            "token",
            "secret",
            "instructions",
            "arguments",
            "argumentsPreview",
            "content",
            "message",
            "systemContext",
            "response",
            "transcript",
          ],
        })],
        logging: { enabled: true, level: "info" },
      },
    },
  }),
  server: {
    host: mastraRuntimeConfig.host,
    port: mastraRuntimeConfig.port,
    drainTimeout: 30_000,
    ...(auth ? { auth } : {}),
    build: {
      openAPIDocs: true,
      swaggerUI: true,
      apiReqLogs: {
        enabled: true,
        level: "info",
        excludePaths: ["/health", "/korgo/health"],
        includeQueryParams: false,
      },
    },
    apiRoutes: [
      registerApiRoute("/korgo/health", {
        method: "GET",
        requiresAuth: false,
        handler: async (context: { json: (value: Record<string, unknown>) => unknown }) => context.json({
          ok: true,
          service: "hermes-mastra-local",
          instanceId: mastraRuntimeConfig.instanceId,
          runtimeLocation: mastraRuntimeConfig.runtimeLocation,
          runtimeVersion: mastraRuntimeConfig.runtimeVersion,
          authConfigured: mastraRuntimeConfig.auth.configured,
          hermes: {
            configured: mastraRuntimeConfig.hermes.configured,
            executionOwner: true,
            composioOwner: true,
            modelBoundary: mastraRuntimeConfig.modelBoundary,
          },
          capabilities: await verifiedCapabilities(),
        }),
      }),
      ...runApiRoutes,
      ...turnApiRoutes,
      ...knowledgeApiRoutes,
    ],
  },
});
