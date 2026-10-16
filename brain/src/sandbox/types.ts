/** Kontrak sandbox — PRD §2.1 (isolasi eksekusi) & §6.1 (host isolation). */

export interface CoverageReport {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
}

/** Target coverage QA (PRD §3.2): minimal 90% statement. */
export const COVERAGE_THRESHOLD = 90;

export interface SandboxRequest {
  runId: string;
  /** Map path relatif → isi berkas (hasil codegen Dev Agent). */
  files: Record<string, string>;
  timeoutMs: number;
  /** Jalankan dengan `vitest run --coverage` (PRD §3.2 — target ≥ 90%). */
  coverage?: boolean;
}

export interface TypeCheckReport {
  ok: boolean;
  errors: string[];
}

export interface TestReport {
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  coverage?: CoverageReport;
}

export interface SandboxResult {
  ok: boolean;
  driver: string;
  typeCheck: TypeCheckReport;
  tests: TestReport;
  logs: string;
  durationMs: number;
  /** Diisi bila guard menolak kode sebelum dieksekusi. */
  rejectedBy?: string;
}

export interface SandboxDriver {
  readonly driver: string;
  run(request: SandboxRequest): Promise<SandboxResult>;
}

export function emptyResult(driver: string, durationMs = 0): SandboxResult {
  return {
    ok: false,
    driver,
    typeCheck: { ok: false, errors: [] },
    tests: { total: 0, passed: 0, failed: 0, durationMs: 0 },
    logs: '',
    durationMs,
  };
}
