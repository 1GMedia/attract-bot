import { MastraJwtAuth } from "@mastra/auth";
import { Mastra } from "@mastra/core/mastra";
import { registerApiRoute } from "@mastra/core/server";
import { PinoLogger } from "@mastra/loggers";
import { MastraStorageExporter, Observability, SensitiveDataFilter } from "@mastra/observability";
import { hermesSupervisorAgent } from "./agents/hermes-supervisor.ts";
import { hermesMastraMcpServer } from "./mcp/hermes-mcp.ts";
import { queryHermesKnowledgeTool } from "./rag/knowledge.ts";
import { mastraRuntimeConfig } from "./runtime-config.ts";
import { executionEvidenceScorer } from "./scorers/execution-evidence.ts";
import { knowledgeVectorStore, mastraStorage } from "./storage.ts";
import { executeHermesTaskTool } from "./tools/hermes-execution.ts";
import { hermesTaskLifecycle } from "./workflows/hermes-task-lifecycle.ts";

const auth = mastraRuntimeConfig.auth.jwtSecret
  ? new MastraJwtAuth({ secret: mastraRuntimeConfig.auth.jwtSecret })
  : undefined;

export const mastra = new Mastra({
  agents: { hermesSupervisorAgent },
  workflows: { hermesTaskLifecycle },
  tools: { queryHermesKnowledgeTool, executeHermesTaskTool },
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
          authConfigured: mastraRuntimeConfig.auth.configured,
          hermes: {
            configured: mastraRuntimeConfig.hermes.configured,
            executionOwner: true,
            composioOwner: true,
          },
          capabilities: {
            agents: true,
            workflows: true,
            memory: true,
            rag: true,
            evals: true,
            storage: true,
            observability: true,
            mcpClient: true,
            mcpServer: true,
            studio: true,
          },
        }),
      }),
    ],
  },
});
