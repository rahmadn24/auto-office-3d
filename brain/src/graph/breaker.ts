/**
 * Circuit breaker guardrail — PRD §3.2.
 * Maksimum 5 siklus Dev⇄QA; siklus ke-5 masih gagal → potong eksekusi,
 * aktifkan fallback safe-build untuk mencegah token bleed.
 */

export type BreakerAction = 'retry' | 'fallback' | 'deploy';

export interface BreakerInput {
  qaPassed: boolean;
  iteration: number;
  maxIterations: number;
}

export function decideBreaker(input: BreakerInput): BreakerAction {
  if (input.qaPassed) return 'deploy';
  return input.iteration >= input.maxIterations ? 'fallback' : 'retry';
}

export interface BreakerStatus {
  armed: boolean;
  label: string;
  current: number;
  max: number;
  exhausted: boolean;
}

export function breakerStatus(iteration: number, maxIterations: number): BreakerStatus {
  return {
    armed: iteration < maxIterations,
    label: `ARMED (${Math.min(iteration, maxIterations)}/${maxIterations})`,
    current: iteration,
    max: maxIterations,
    exhausted: iteration >= maxIterations,
  };
}

export function cycleLabel(iteration: number, maxIterations: number): string {
  return `Cycle ${Math.min(iteration + 1, maxIterations)}/${maxIterations}`;
}
