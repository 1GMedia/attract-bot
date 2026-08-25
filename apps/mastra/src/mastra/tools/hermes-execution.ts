import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { HermesClient } from "../hermes/client.ts";
import { mastraRuntimeConfig } from "../runtime-config.ts";

export const hermesExecutionOutputSchema = z.object({
  completionId: z.string(),
  sessionId: z.string().nullable(),
  status: z.enum(["completed", "partial", "failed"]),
  finishReason: z.string().nullable(),
  response: z.string(),
  usage: z.object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
  }),
});

export const executeHermesTaskTool = createTool({
  id: "execute-hermes-task",
  description: "Delegate an approved task to Hermes, which owns tool execution and connected Composio apps.",
  requireApproval: true,
  inputSchema: z.object({
    workspaceId: z.string().trim().min(1).max(128),
    taskId: z.string().trim().min(1).max(256),
    profile: z.string().trim().min(1).max(64).optional(),
    instructions: z.string().trim().min(1).max(40_000),
    systemContext: z.string().trim().max(8_000).optional(),
  }),
  outputSchema: hermesExecutionOutputSchema,
  execute: async (input) => new HermesClient(mastraRuntimeConfig.hermes).execute(input),
});
