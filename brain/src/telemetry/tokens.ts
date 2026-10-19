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
    super(
      `TOKEN BLEED: run consumed ${used.toLocaleString()} tokens (limit ${limit.toLocaleString()})`,
    );
    this.name = 'TokenBudgetExceededError';
  }
}

export class TokenBudget {
  private used = 0;
  private inputUsed = 0;
  private outputUsed = 0;
  private killed = false;
  private readonly divisions: Record<string, number> = {};

  constructor(readonly limit: number) {}

  /** Menambah pemakaian (opsional per divisi); melebihi limit → throw (hard-kill). */
  add(usage: TokenUsage, division?: string): number {
    const total = usage.inputTokens + usage.outputTokens;
    this.used += total;
    this.inputUsed += usage.inputTokens;
    this.outputUsed += usage.outputTokens;
    if (division) this.divisions[division] = (this.divisions[division] ?? 0) + total;
    if (this.used > this.limit) {
      this.killed = true;
      throw new TokenBudgetExceededError(this.used, this.limit);
    }
    return this.used;
  }

  /** Pemakaian input/output terpisah — untuk estimasi biaya (Fase 13). */
  get usage(): TokenUsage {
    return { inputTokens: this.inputUsed, outputTokens: this.outputUsed };
  }

  /** Riwayat pemakaian per divisi (PM/Dev/QA…) untuk HUD. */
  byDivision(): Record<string, number> {
    return { ...this.divisions };
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
