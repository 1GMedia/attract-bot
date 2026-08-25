import { createScorer } from "@mastra/core/evals";

function outputObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export const executionEvidenceScorer = createScorer({
  id: "hermes-execution-evidence",
  description: "Requires a completed Hermes result plus completion and session evidence.",
})
  .analyze(({ run }) => {
    const output = outputObject(run.output);
    return {
      completed: output.status === "completed",
      hasCompletionId: typeof output.completionId === "string" && output.completionId.length > 0,
      hasSessionId: typeof output.sessionId === "string" && output.sessionId.length > 0,
      hasResponse: typeof output.response === "string" && output.response.trim().length > 0,
    };
  })
  .generateScore(({ results }) => {
    const evidence = results.analyzeStepResult;
    return evidence.completed && evidence.hasCompletionId && evidence.hasSessionId && evidence.hasResponse ? 1 : 0;
  })
  .generateReason(({ score }) => score === 1
    ? "Hermes completed the run and returned completion, session, and output evidence."
    : "The run lacks completed Hermes execution evidence.");
