import { describe, expect, it } from 'vitest'

import { BoundedRestartBudget } from './mastra-restart'

describe('Mastra bounded restart budget', () => {
  it('backs off and stops instead of entering an infinite respawn loop', () => {
    const budget = new BoundedRestartBudget([10, 20, 40])
    expect([budget.nextDelay(), budget.nextDelay(), budget.nextDelay(), budget.nextDelay()]).toEqual([10, 20, 40, null])
    expect(budget.attempts).toBe(3)
  })

  it('resets only after the caller observes a stable process', () => {
    const budget = new BoundedRestartBudget([10])
    expect(budget.nextDelay()).toBe(10)
    expect(budget.nextDelay()).toBeNull()
    budget.reset()
    expect(budget.nextDelay()).toBe(10)
  })
})
