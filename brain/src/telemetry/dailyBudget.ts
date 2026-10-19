import type { RunStore } from '../durability/store';

/**
 * Budget token harian lintas-run (Fase 13 — PRD §6.4).
 *
 * Guardrail `TOKEN_BUDGET` hanya membatasi satu run; pemakaian sehari bisa
 * membengkak tanpa terasa bila banyak run. Angka `used` dihitung dari total
 * token run yang selesai hari ini (kolom `tokens_used`, waktu lokal mesin).
 */
export interface DailyBudgetStatus {
  /** Batas token per hari; 0 = nonaktif. */
  limit: number;
  /** Token terpakai hari ini (run yang sudah selesai). */
  used: number;
  /** Sisa token hari ini (0 bila nonaktif / habis). */
  remaining: number;
  /** true bila budget diaktifkan dan sudah terpakai habis. */
  exhausted: boolean;
  /** Budget diaktifkan (limit > 0). */
  enabled: boolean;
  /** Tengah malam lokal berikutnya — kapan hitungan reset (ISO). */
  resetsAt: string;
}

export class DailyBudgetExceededError extends Error {
  constructor(readonly status: DailyBudgetStatus) {
    super(
      `DAILY BUDGET: hari ini sudah memakai ${status.used.toLocaleString('en-US')} token ` +
        `(batas ${status.limit.toLocaleString('en-US')}) — run baru ditolak. ` +
        `Budget reset ${status.resetsAt}.`,
    );
    this.name = 'DailyBudgetExceededError';
  }
}

/** Tengah malam hari ini menurut waktu lokal. */
export function startOfLocalDay(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** Tengah malam berikutnya (awal hari lokal setelah `now`). */
export function nextLocalMidnight(now: Date = new Date()): Date {
  const next = startOfLocalDay(now);
  next.setDate(next.getDate() + 1);
  return next;
}

export function dailyBudgetStatus(
  limit: number,
  used: number,
  now: Date = new Date(),
): DailyBudgetStatus {
  const enabled = limit > 0;
  const safeUsed = Math.max(0, used);
  return {
    limit,
    used: safeUsed,
    remaining: enabled ? Math.max(0, limit - safeUsed) : 0,
    exhausted: enabled && safeUsed >= limit,
    enabled,
    resetsAt: nextLocalMidnight(now).toISOString(),
  };
}

/** Hitung status aktual dari store (tanpa store → pemakaian 0). */
export function readDailyBudget(
  store: RunStore | undefined,
  limit: number,
  now: Date = new Date(),
): DailyBudgetStatus {
  const used = store && limit > 0 ? store.tokensUsedSince(startOfLocalDay(now).toISOString()) : 0;
  return dailyBudgetStatus(limit, used, now);
}

/** Lempar `DailyBudgetExceededError` bila budget harian habis (dipakai pra-run). */
export function assertDailyBudget(
  store: RunStore | undefined,
  limit: number,
  now: Date = new Date(),
): DailyBudgetStatus {
  const status = readDailyBudget(store, limit, now);
  if (status.exhausted) throw new DailyBudgetExceededError(status);
  return status;
}
