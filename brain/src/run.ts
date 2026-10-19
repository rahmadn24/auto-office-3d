import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph';

import { createControl, GraphHaltedError, type RunControl } from './control';
import type { LeadsStore } from './cs/leads';
import type { RunStatus, RunStore } from './durability/store';
import { EventBus } from './events';
import { buildOrchestrator, type Orchestrator } from './graph/build';
import { initialState } from './graph/state';
import {
  createDeploy,
  createEmail,
  createGitHub,
  createHealthProbe,
  createSocial,
} from './integrations';
import { createLLM } from './llm';
import { estimateCostUsd } from './llm/pricing';
import { createMemory } from './memory';
import type { MemoryProvider } from './memory/provider';
import { createPayment, type PaymentProvider } from './payments';
import { createSandbox } from './sandbox';
import { assertDailyBudget } from './telemetry/dailyBudget';
import { TokenBudget } from './telemetry/tokens';
import type { Config } from './config';
import { loadConfig } from './config';
import { AGENT_HOME_ZONE, type ArtifactsPayload } from './types';
import type { GraphDeps } from './graph/nodes';
import type { RunState } from './graph/state';

/**
 * Membangkitkan memori awal (RAG seed) agar namespace tidak kosong pada run pertama —
 * mencerminkan ingatan lintas run (Milestone #3).
 */
export async function seedMemory(memory: MemoryProvider): Promise<void> {
  await memory.upsert('pm-memory', [
    {
      id: 'seed:prd-standard',
      text: 'PRD Section 4.2: Maximum PDF export generation time must remain under 1,200ms per tenant request',
      metadata: { kind: 'prd-standard' },
    },
    {
      id: 'seed:persona',
      text: 'User persona: technical founders and indie hackers orchestrating multi-agent systems',
      metadata: { kind: 'persona' },
    },
  ]);
  await memory.upsert('dev-memory', [
    {
      id: 'seed:stripe-idempotent',
      text: 'Stripe webhook idempotent handler using Supabase RPC billing_cycle_decrement(customer_uuid, invoice_ref)',
      metadata: { kind: 'architecture' },
    },
    {
      id: 'seed:next-boilerplate',
      text: 'Next.js App Router boilerplate with Stripe checkout session route handler and typed env validation',
      metadata: { kind: 'boilerplate' },
    },
  ]);
  await memory.upsert('qa-memory', [
    {
      id: 'seed:vat-assertion',
      text: 'Assertion template: checkZeroVATExemptionWithEUReverseCharge(buyerVatNumber, sellerCountry)',
      metadata: { kind: 'edge-case' },
    },
  ]);
  await memory.upsert('marketing-mem', [
    {
      id: 'seed:hook',
      text: 'Build-in-Public viral hook: plain client chats → Stripe-ready invoices in 3 seconds',
      metadata: { kind: 'copywriting' },
    },
  ]);
}

/** Siarkan bundel hasil run (PRD + berkas + diff + QA) ke viewer Artifacts (Fase 5). */
function emitArtifacts(
  events: EventBus,
  state: RunState,
  founderPrompt: string,
  tokensUsed: number,
  durationMs: number,
  costUsd?: number | null,
): void {
  if (!events.artifacts || Object.keys(state.artifacts).length === 0) return;
  const files = Object.entries(state.artifacts)
    .slice(0, 40)
    .map(([path, content]) => ({
      path,
      content: content.length > 2400 ? `${content.slice(0, 2400)}\n…` : content,
      diff: state.diffs[path] ?? { status: 'created' as const, added: 0, removed: 0 },
    }));
  const payload: ArtifactsPayload = {
    runId: state.runId,
    projectName: state.projectName || founderPrompt.slice(0, 40),
    prd: state.prd,
    files,
    qaSummary: state.lastQaSummary,
    qaPassed: state.qaPassed,
    cycles: state.iteration,
    maxCycles: state.maxIterations,
    tokensUsed,
    ...(typeof costUsd === 'number' ? { costUsd } : {}),
    liveUrl: state.liveUrl,
    repoUrl: state.repoUrl,
    durationMs,
    timestamp: new Date().toISOString(),
  };
  events.artifacts(payload);
}

/**
 * Run gagal sebelum sempat menyiarkan status akhir → reset agen yang sudah
 * aktif ke idle + bawa pesan error ke dashboard. Tanpa ini Theater hanya
 * menampilkan status terakhir (biasanya PM) seolah run masih berjalan.
 */
function emitRunFailure(
  events: EventBus,
  runId: string,
  err: unknown,
  tokensUsed: number,
  latencyMs: number,
  model: string,
): void {
  const message = err instanceof Error ? err.message : String(err);
  const activeAgents = new Set(events.history.map((p) => p.agentId));
  if (activeAgents.size === 0) activeAgents.add('founder_agent');

  for (const agentId of activeAgents) {
    events.agent(
      EventBus.payload({
        runId,
        agentId,
        action: 'idle',
        logMessage: `RUN FAILED · ${message}`,
        zone: AGENT_HOME_ZONE[agentId],
        telemetry: { tokensUsed, latencyMs, model },
      }),
    );
  }
}

export interface RunOptions {
  config?: Config;
  emit?: EventBus;
  seed?: boolean;
  /** Endpoint HALT GRAPH — bila tidak diberikan, dibuat internal (tidak pernah halt). */
  control?: RunControl;
  /** Payment Sentinel bersama (idempoten lintas webhook & run) — PRD §3.4. */
  payment?: PaymentProvider;
  /** Vector memory bersama (dibuat di index) — bila diberikan, tidak dibuat/di-seed ulang. */
  memory?: MemoryProvider;
  /** Simpan checkpoint tiap langkah agar run bisa di-resume. */
  checkpointer?: BaseCheckpointSaver;
  /** Thread id LangGraph (default: id baru). Sama = state tersimpan yang sama. */
  runId?: string;
  /** Run history + event log durable (PRD v3.0 §4.4). */
  store?: RunStore;
  /** Leads store bersama (Fase 11) — handoff Marketer → CS Inbox. */
  leads?: LeadsStore;
}

/** Status durable dari stage akhir run (PRD v3.0 §4.4). */
export function statusForStage(stage: RunState['stage']): RunStatus {
  if (stage === 'failed') return 'failed';
  if (stage === 'halted') return 'halted';
  return 'completed';
}

/** Susun dependency graph — dipakai runAutonomous & resumeAutonomous. */
function buildDeps(
  config: Config,
  events: EventBus,
  budget: TokenBudget,
  control: RunControl,
  memory: MemoryProvider,
  payment: PaymentProvider,
  leads?: LeadsStore,
): GraphDeps {
  return {
    llm: createLLM(config),
    memory,
    sandbox: createSandbox(config),
    emit: events,
    budget,
    control,
    github: createGitHub(config),
    deploy: createDeploy(config),
    healthProbe: createHealthProbe(config),
    social: createSocial(config),
    email: createEmail(config),
    payment,
    ...(leads ? { leads } : {}),
  };
}

export interface RunResult {
  state: RunState;
  events: EventBus;
  tokensUsed: number;
  /** Pemakaian input/output terpisah — dasar estimasi biaya (Fase 13). */
  usage: { inputTokens: number; outputTokens: number };
  /** Estimasi biaya (USD) dari tabel harga benchmark; null bila model tak dikenal. */
  costUsd: number | null;
  /** Riwayat pemakaian token per divisi (PM/Dev/QA). */
  tokenBreakdown: Record<string, number>;
  runId: string;
  control: RunControl;
  /** Graf bercheckpointer — dipakai `resumeRun` untuk melanjutkan run yang di-halt. */
  app: Orchestrator;
}

/** Menjalankan satu siklus penuh: Founder prompt → live URL → sale pertama. */
export async function runAutonomous(
  founderPrompt: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const config = options.config ?? loadConfig();
  // Budget harian lintas-run (Fase 13): tolak run baru dengan pesan jelas
  // sebelum ada efek samping (memory seed / LLM call).
  assertDailyBudget(options.store, config.dailyTokenBudget);
  const events = options.emit ?? new EventBus();
  const budget = new TokenBudget(config.tokenBudget);
  const control = options.control ?? createControl();
  const runStartedAt = Date.now();

  const memory = options.memory ?? createMemory(config);
  // Bila memory dibagikan dari index (untuk snapshot), ia sudah di-seed di sana.
  if (!options.memory && options.seed !== false) await seedMemory(memory);

  const deps = buildDeps(
    config,
    events,
    budget,
    control,
    memory,
    options.payment ?? createPayment(config),
    options.leads,
  );

  const runId = options.runId ?? `run_${Date.now().toString(36)}`;
  const projectName = guessProjectName(founderPrompt);
  options.store?.startRun({ runId, directive: founderPrompt, projectName });

  // Checkpointer selalu aktif: HALT bisa terjadi kapan saja dan run wajib
  // bisa di-resume dari state tersimpan (PRD).
  const checkpointer = options.checkpointer ?? new MemorySaver();
  const app = buildOrchestrator(deps, { checkpointer });
  const invokeConfig = { recursionLimit: 64, configurable: { thread_id: runId } };

  const initial = initialState({
    runId,
    founderPrompt,
    projectName,
    maxIterations: config.maxIterations,
    model: deps.llm.model,
  });

  let state: RunState;
  try {
    state = (await app.invoke(initial, invokeConfig)) as RunState;
  } catch (err) {
    if (!(err instanceof GraphHaltedError)) {
      emitRunFailure(events, runId, err, budget.total, Date.now() - runStartedAt, deps.llm.model);
      options.store?.finishRun(runId, {
        status: 'failed',
        stage: 'failed',
        tokensUsed: budget.total,
      });
      throw err;
    }
    // Halt oleh operator: checkpoint tersimpan, stage di-report sebagai 'halted'.
    const snapshot = await app.getState(invokeConfig);
    state = { ...(snapshot.values as RunState), stage: 'halted' };
  }

  const costUsd = estimateCostUsd(state.model, budget.usage);
  emitArtifacts(events, state, founderPrompt, budget.total, Date.now() - runStartedAt, costUsd);
  options.store?.finishRun(runId, {
    status: statusForStage(state.stage),
    stage: state.stage,
    tokensUsed: budget.total,
    liveUrl: state.liveUrl,
    repoUrl: state.repoUrl,
  });

  return {
    state,
    events,
    tokensUsed: budget.total,
    usage: budget.usage,
    costUsd,
    tokenBreakdown: budget.byDivision(),
    runId,
    control,
    app,
  };
}

/**
 * Menjalankan ulang run dari state tersimpan (checkpointer PRD).
 * Untuk run yang di-halt: panggil `control.resume(runId)` dulu (atau lewat
 * argumen `control`) — LangGraph melanjutkan dari node yang tertunda.
 */
export async function resumeRun(
  app: Orchestrator,
  runId: string,
  control?: RunControl,
): Promise<RunState> {
  control?.resume(runId);
  return (await app.invoke(null, {
    recursionLimit: 64,
    configurable: { thread_id: runId },
  })) as RunState;
}

/**
 * Resume run dari checkpoint **durable** setelah restart (PRD v3.0 §2.1 & #6).
 * Berbeda dengan `resumeRun` (app yang sama di memori), fungsi ini membangun
 * ulang seluruh dependency dari config + checkpointer SQLite di DATA_DIR.
 */
export async function resumeAutonomous(
  runId: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const config = options.config ?? loadConfig();
  const events = options.emit ?? new EventBus();
  const budget = new TokenBudget(config.tokenBudget);
  const control = options.control ?? createControl();
  const memory = options.memory ?? createMemory(config);
  const runStartedAt = Date.now();

  const deps = buildDeps(
    config,
    events,
    budget,
    control,
    memory,
    options.payment ?? createPayment(config),
    options.leads,
  );
  const checkpointer = options.checkpointer ?? new MemorySaver();
  const app = buildOrchestrator(deps, { checkpointer });
  const invokeConfig = { recursionLimit: 64, configurable: { thread_id: runId } };

  const snapshot = await app.getState(invokeConfig);
  const values = (snapshot?.values ?? {}) as Partial<RunState>;
  if (!values.runId) throw new Error(`No checkpoint found for run ${runId}`);

  options.store?.startRun({
    runId,
    directive: values.founderPrompt ?? '',
    projectName: values.projectName ?? '',
  });

  let state: RunState;
  try {
    state = (await app.invoke(null, invokeConfig)) as RunState;
  } catch (err) {
    if (!(err instanceof GraphHaltedError)) {
      emitRunFailure(events, runId, err, budget.total, Date.now() - runStartedAt, deps.llm.model);
      options.store?.finishRun(runId, {
        status: 'failed',
        stage: 'failed',
        tokensUsed: budget.total,
      });
      throw err;
    }
    const halted = await app.getState(invokeConfig);
    state = { ...(halted.values as RunState), stage: 'halted' };
  }

  const costUsd = estimateCostUsd(state.model, budget.usage);
  emitArtifacts(
    events,
    state,
    state.founderPrompt,
    budget.total,
    Date.now() - runStartedAt,
    costUsd,
  );
  options.store?.finishRun(runId, {
    status: statusForStage(state.stage),
    stage: state.stage,
    tokensUsed: budget.total,
    liveUrl: state.liveUrl,
    repoUrl: state.repoUrl,
  });

  return {
    state,
    events,
    tokensUsed: budget.total,
    usage: budget.usage,
    costUsd,
    tokenBreakdown: budget.byDivision(),
    runId,
    control,
    app,
  };
}

/** Nama proyek untuk PRD & URL deploy, diturunkan dari prompt Founder (dipakai juga oleh Briefing Room). */
export function guessProjectName(prompt: string): string {
  const words = prompt
    .split(/\s+/)
    .filter((w) => /^[a-zA-Z][a-zA-Z0-9'-]*$/.test(w))
    .filter(
      (w) =>
        !/^(a|an|the|with|for|and|of|that|which|to|in|on|my|our|please|build|make|create)$/i.test(
          w,
        ),
    )
    .slice(0, 4);
  const joined = words.join(' ');
  return joined.trim() || 'AutoInvoice Engine';
}
