export class BoundedRestartBudget {
  private attempt = 0

  constructor(private readonly delays = [1_000, 3_000, 10_000]) {}

  nextDelay(): number | null {
    const delay = this.delays[this.attempt]

    if (delay == null) {return null}
    this.attempt += 1

    return delay
  }

  reset(): void {
    this.attempt = 0
  }

  get attempts(): number {
    return this.attempt
  }
}
