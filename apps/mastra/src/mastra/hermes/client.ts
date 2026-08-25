import { createHash } from "node:crypto";
import { z } from "zod";
import { normalizeProfile, type MastraRuntimeConfig } from "../runtime-config.ts";

const responseSchema = z.object({
  id: z.string(),
  choices: z.array(z.object({
    message: z.object({ content: z.string() }),
    finish_reason: z.string().nullable(),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
  }).optional(),
  hermes: z.object({
    completed: z.boolean().optional(),
    partial: z.boolean().optional(),
    failed: z.boolean().optional(),
    error_code: z.string().nullable().optional(),
  }).optional(),
});

export interface HermesExecutionInput {
  workspaceId: string;
  taskId: string;
  instructions: string;
  profile?: string;
  systemContext?: string;
}

export interface HermesExecutionResult {
  completionId: string;
  sessionId: string | null;
  status: "completed" | "partial" | "failed";
  finishReason: string | null;
  response: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class HermesClient {
  constructor(
    private readonly config: MastraRuntimeConfig["hermes"],
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async execute(input: HermesExecutionInput): Promise<HermesExecutionResult> {
    if (!this.config.apiKey) {
      throw new Error("Hermes execution is unavailable because its API credential is not configured.");
    }

    const profile = normalizeProfile(input.profile || this.config.defaultProfile);
    const path = profile === "default"
      ? "/v1/chat/completions"
      : `/p/${encodeURIComponent(profile)}/v1/chat/completions`;
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.config.requestTimeoutMs);

    try {
      const response = await this.fetchImplementation(`${this.config.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
          "X-Hermes-Session-Key": stableSessionKey(input.workspaceId, input.taskId),
        },
        body: JSON.stringify({
          model: "hermes",
          stream: false,
          messages: [
            ...(input.systemContext ? [{ role: "system", content: input.systemContext }] : []),
            { role: "user", content: input.instructions },
          ],
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`Hermes execution failed with HTTP ${response.status}.`);
      }

      const parsed = responseSchema.safeParse(await response.json());
      if (!parsed.success) {
        throw new Error("Hermes returned an invalid completion envelope.");
      }

      const choice = parsed.data.choices[0];
      const hermes = parsed.data.hermes;
      const status = hermes?.failed
        ? "failed"
        : hermes?.partial || hermes?.completed === false || choice.finish_reason === "length"
          ? "partial"
          : "completed";

      return {
        completionId: parsed.data.id,
        sessionId: response.headers.get("X-Hermes-Session-Id"),
        status,
        finishReason: choice.finish_reason,
        response: choice.message.content,
        usage: {
          promptTokens: parsed.data.usage?.prompt_tokens || 0,
          completionTokens: parsed.data.usage?.completion_tokens || 0,
          totalTokens: parsed.data.usage?.total_tokens || 0,
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function stableSessionKey(workspaceId: string, taskId: string): string {
  const digest = createHash("sha256")
    .update(`${workspaceId}\0${taskId}`)
    .digest("hex")
    .slice(0, 40);
  return `mastra-${digest}`;
}
