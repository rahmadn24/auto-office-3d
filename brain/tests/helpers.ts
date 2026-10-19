import { EventBus } from '../src/events';
import type { LeadsStore } from '../src/cs/leads';
import { buildOrchestrator } from '../src/graph/build';
import { type GraphDeps } from '../src/graph/nodes';
import { StubLLM } from '../src/llm/stub';
import { HashEmbedder } from '../src/memory/embeddings';
import { InMemoryVectorStore } from '../src/memory/inMemory';
import { LocalSandbox } from '../src/sandbox/local';
import type { SandboxDriver, SandboxRequest, SandboxResult } from '../src/sandbox/types';
import { TokenBudget } from '../src/telemetry/tokens';

/**
 * Sandbox tiruan dengan skrip hasil.
 * `mode: 'fail-then-safe'` = gagal untuk kode Dev Agent, lolos untuk bundle
 * safe-build (terdeteksi dari penanda `safebuild-`) — dipakai menguji circuit breaker.
 */
export class FakeSandbox implements SandboxDriver {
  readonly driver = 'fake';
  readonly calls: SandboxRequest[] = [];

  constructor(private readonly mode: 'pass' | 'fail' | 'fail-then-safe') {}

  async run(request: SandboxRequest): Promise<SandboxResult> {
    this.calls.push(request);
    const isSafeBuild = JSON.stringify(request.files).includes('safebuild-');
    const ok = this.mode === 'pass' ? true : this.mode === 'fail' ? false : isSafeBuild;

    return {
      ok,
      driver: this.driver,
      typeCheck: {
        ok,
        errors: ok ? [] : ['src/lib/engine.ts(1,1): TS2304: Cannot find name "boom".'],
      },
      tests: { total: ok ? 9 : 8, passed: ok ? 9 : 8, failed: ok ? 0 : 1, durationMs: 12 },
      logs: ok ? 'Tests 9 passed (9)' : 'Tests 1 failed (9)',
      durationMs: 12,
    };
  }
}

export interface DepsOverrides {
  sandbox?: SandboxDriver;
  budget?: TokenBudget;
  /** Fase 11: leads store — node Marketing menulis handoff lead ke CS Inbox. */
  leads?: LeadsStore;
}

export function makeDeps(overrides: DepsOverrides = {}): {
  deps: GraphDeps;
  bus: EventBus;
  budget: TokenBudget;
} {
  const bus = new EventBus();
  const budget = overrides.budget ?? new TokenBudget(250_000);
  const deps: GraphDeps = {
    llm: new StubLLM(),
    memory: new InMemoryVectorStore(new HashEmbedder()),
    sandbox: overrides.sandbox ?? new LocalSandbox(60_000),
    emit: bus,
    budget,
    ...(overrides.leads ? { leads: overrides.leads } : {}),
  };
  return { deps, bus, budget };
}

export function makeOrchestrator(overrides: DepsOverrides = {}) {
  const { deps, bus, budget } = makeDeps(overrides);
  return { app: buildOrchestrator(deps), bus, budget, deps };
}
