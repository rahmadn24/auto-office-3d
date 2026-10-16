/**
 * Run control — endpoint penghentian manual (PRD §3.2 "HALT GRAPH"
 * & status GRAPH LOCKED pada Loop Controls).
 *
 * Endpoint tersedia lewat:
 *   • Socket.io event `control:halt` / `control:resume` { runId?: string }
 *   • HTTP POST /control/halt (tanpa runId = semua run)
 */

export type ControlCommand = 'halt' | 'resume';

/**
 * Dilempar node ketika operator menghentikan run. Checkpointer menyimpan
 * `next` node yang sedang berjalan, sehingga `resumeRun` melanjutkan tepat
 * dari titik berhenti.
 */
export class GraphHaltedError extends Error {
  override readonly name = 'GraphHaltedError';

  constructor(readonly runId: string) {
    super(`GRAPH HALTED · run ${runId} paused by operator`);
  }
}

export class RunControl {
  private readonly halted = new Set<string>();
  private haltedAll = false;

  halt(runId?: string): void {
    if (runId) this.halted.add(runId);
    else this.haltedAll = true;
  }

  resume(runId?: string): void {
    if (runId) this.halted.delete(runId);
    else {
      this.halted.clear();
      this.haltedAll = false;
    }
  }

  isHalted(runId: string): boolean {
    return this.haltedAll || this.halted.has(runId);
  }

  snapshot(): { haltedAll: boolean; runIds: string[] } {
    return { haltedAll: this.haltedAll, runIds: [...this.halted] };
  }
}

export function createControl(): RunControl {
  return new RunControl();
}
