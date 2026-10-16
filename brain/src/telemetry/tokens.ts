/** Token bleed protection — PRD §6.4: hard-kill di 250.000 token per run. */

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export class TokenBudgetExceededError extends Error {
  constructor(
    readonly used: number,
    readonly limit: number,
  ) {
    super(`TOKEN BLEED: run consumed ${used.toLocaleString()} tokens (limit ${limit.toLocaleString()})`);
    this.name = 'TokenBudgetExceededError';
  }
}

export class TokenBudget {
  private used = 0;
  private killed = false;

  constructor(readonly limit: number) {}

  /** Menambah pemakaian; melebihi limit → throw (hard-kill loop). */
  add(usage: TokenUsage): number {
    this.used += usage.inputTokens + usage.outputTokens;
    if (this.used > this.limit) {
      this.killed = true;
      throw new TokenBudgetExceededError(this.used, this.limit);
    }
    return this.used;
  }

  get total(): number {
    return this.used;
  }

  get remaining(): number {
    return Math.max(0, this.limit - this.used);
  }

  get exhausted(): boolean {
    return this.killed || this.used > this.limit;
  }

  get usageRatio(): number {
    return this.limit === 0 ? 1 : this.used / this.limit;
  }
}

/** Format ala HUD: 142800 → "142.8k". */
export function formatTokens(value: number): string {
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(1)}k`;
}
