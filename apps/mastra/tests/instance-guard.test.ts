import { describe, expect, it } from 'vitest'
import { instanceMatches } from '../src/mastra/runs/instance-guard.ts'

describe('Mastra instance mutation guard', () => {
  it('fails closed for stale instance nonces', () => {
    expect(instanceMatches('current', 'current')).toBe(true)
    expect(instanceMatches('stale', 'current')).toBe(false)
    expect(instanceMatches('', 'current')).toBe(false)
  })
})
