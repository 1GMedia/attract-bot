import type { MastraRiskClassification } from '@hermes/shared/mastra-runs'
import { createHash } from 'node:crypto'

export const TOOL_POLICY_VERSION = '2026-08-26.1'

export const SUPERVISOR_TOOL_RISK = {
  'delegate-hermes-task': 'unknown',
  'observe-orgo-computer': 'private-read',
  'operate-orgo-computer': 'mutation',
  'use-connected-app': 'unknown'
} as const satisfies Record<string, MastraRiskClassification>

export type SupervisorToolName = keyof typeof SUPERVISOR_TOOL_RISK

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalValue(entry)])
    )
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('Tool arguments must contain only finite JSON numbers.')
  }
  return value
}

export function canonicalizeToolArguments(argumentsValue: Record<string, unknown>): string {
  return JSON.stringify(canonicalValue(argumentsValue))
}

export function previewToolArguments(argumentsValue: Record<string, unknown>, limit = 240): string {
  const canonical = canonicalizeToolArguments(argumentsValue)
  return canonical.length <= limit ? canonical : `${canonical.slice(0, Math.max(0, limit - 1))}…`
}

export function approvalArgumentHash(input: {
  arguments: Record<string, unknown>
  instanceId: string
  policyVersion: string
  runId: string
  toolName: string
}): string {
  const payload = [
    input.toolName,
    canonicalizeToolArguments(input.arguments),
    input.policyVersion,
    input.runId,
    input.instanceId
  ].join('\n')
  return createHash('sha256').update(payload).digest('hex')
}

export function riskForSupervisorTool(toolName: string): MastraRiskClassification {
  return SUPERVISOR_TOOL_RISK[toolName as SupervisorToolName] || 'unknown'
}
