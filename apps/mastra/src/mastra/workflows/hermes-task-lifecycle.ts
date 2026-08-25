import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { HermesClient } from "../hermes/client.ts";
import { mastraRuntimeConfig } from "../runtime-config.ts";
import { hermesExecutionOutputSchema } from "../tools/hermes-execution.ts";

const taskInputSchema = z.object({
  workspaceId: z.string().trim().min(1).max(128),
  taskId: z.string().trim().min(1).max(256),
  profile: z.string().trim().min(1).max(64).optional(),
  instructions: z.string().trim().min(1).max(40_000),
  systemContext: z.string().trim().max(8_000).optional(),
});

const approvalStep = createStep({
  id: "await-execution-approval",
  inputSchema: taskInputSchema,
  resumeSchema: z.object({ approved: z.boolean() }),
  suspendSchema: z.object({
    workspaceId: z.string(),
    taskId: z.string(),
    profile: z.string(),
    instructionsPreview: z.string(),
  }),
  outputSchema: taskInputSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) {
      return suspend({
        workspaceId: inputData.workspaceId,
        taskId: inputData.taskId,
        profile: inputData.profile || mastraRuntimeConfig.hermes.defaultProfile,
        instructionsPreview: inputData.instructions.slice(0, 240),
      });
    }
    if (!resumeData.approved) throw new Error("Hermes execution was declined by the operator.");
    return inputData;
  },
});

const executeStep = createStep({
  id: "execute-with-hermes",
  inputSchema: taskInputSchema,
  outputSchema: hermesExecutionOutputSchema,
  execute: async ({ inputData }) => new HermesClient(mastraRuntimeConfig.hermes).execute(inputData),
});

export const hermesTaskLifecycle = createWorkflow({
  id: "hermes-task-lifecycle",
  description: "Durably approve, execute, and retain evidence for a Hermes task.",
  inputSchema: taskInputSchema,
  outputSchema: hermesExecutionOutputSchema,
})
  .then(approvalStep)
  .then(executeStep)
  .commit();
