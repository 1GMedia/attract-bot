import { describe, expect, it } from 'vitest'
import {
  approvalArgumentHash,
  canonicalizeToolArguments,
  previewToolArguments,
  riskForSupervisorTool,
  TOOL_POLICY_VERSION
} from '../src/mastra/runs/tool-policy.ts'

describe('supervisor tool policy', () => {
  it('canonicalizes equivalent argument objects identically', () => {
    expect(canonicalizeToolArguments({ z: 1, nested: { b: true, a: 'x' } })).toBe(
      canonicalizeToolArguments({ nested: { a: 'x', b: true }, z: 1 })
    )
  })

  it('binds approval identity to arguments, policy, run, and instance', () => {
    const base = {
      toolName: 'operate-orgo-computer',
      arguments: { task: 'Open settings' },
      policyVersion: TOOL_POLICY_VERSION,
      runId: 'run-1',
      instanceId: 'instance-1'
    }
    const hash = approvalArgumentHash(base)

    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    expect(approvalArgumentHash({ ...base, arguments: { task: 'Delete settings' } })).not.toBe(hash)
    expect(approvalArgumentHash({ ...base, runId: 'run-2' })).not.toBe(hash)
    expect(approvalArgumentHash({ ...base, instanceId: 'instance-2' })).not.toBe(hash)
    expect(approvalArgumentHash({ ...base, policyVersion: 'next-policy' })).not.toBe(hash)
  })

  it('derives risk from server-owned metadata and fails unknown tools closed', () => {
    expect(riskForSupervisorTool('observe-orgo-computer')).toBe('private-read')
    expect(riskForSupervisorTool('operate-orgo-computer')).toBe('mutation')
    expect(riskForSupervisorTool('model-says-read-only')).toBe('unknown')
    expect(previewToolArguments({ long: 'x'.repeat(400) }, 40)).toHaveLength(40)
  })
})
