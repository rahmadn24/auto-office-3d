import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { MemorySaver } from '@langchain/langgraph';

import { createControl, GraphHaltedError, type RunControl } from './control';
import { EventBus } from './events';
import { buildOrchestrator, type Orchestrator } from './graph/build';
import { initialState } from './graph/state';
import {
  createDeploy,
  createEmail,
  createGitHub,
  createHealthProbe,
  createSocial,
  StripeSentinel,
} from './integrations';
import { createLLM } from './llm';
import { createMemory } from './memory';
import type { MemoryProvider } from './memory/provider';
import { createSandbox } from './sandbox';
import { TokenBudget } from './telemetry/tokens';
import type { Config } from './config';
import { loadConfig } from './config';
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

export interface RunOptions {
  config?: Config;
  emit?: EventBus;
  seed?: boolean;
  /** Endpoint HALT GRAPH — bila tidak diberikan, dibuat internal (tidak pernah halt). */
  control?: RunControl;
  /** Sentinel Stripe bersama (idempoten lintas webhook & run). */
  sentinel?: StripeSentinel;
  /** Simpan checkpoint tiap langkah agar run bisa di-resume. */
  checkpointer?: BaseCheckpointSaver;
  /** Thread id LangGraph (default: id baru). Sama = state tersimpan yang sama. */
  runId?: string;
}

export interface RunResult {
  state: RunState;
  events: EventBus;
  tokensUsed: number;
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
  const events = options.emit ?? new EventBus();
  const budget = new TokenBudget(config.tokenBudget);
  const control = options.control ?? createControl();

  const memory = createMemory(config);
  if (options.seed !== false) await seedMemory(memory);

  const deps: GraphDeps = {
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
    sentinel: options.sentinel ?? new StripeSentinel(config.stripeWebhookSecret),
  };

  const runId = options.runId ?? `run_${Date.now().toString(36)}`;
  // Checkpointer selalu aktif: HALT bisa terjadi kapan saja dan run wajib
  // bisa di-resume dari state tersimpan (PRD).
  const checkpointer = options.checkpointer ?? new MemorySaver();
  const app = buildOrchestrator(deps, { checkpointer });
  const invokeConfig = { recursionLimit: 64, configurable: { thread_id: runId } };

  const initial = initialState({
    runId,
    founderPrompt,
    projectName: guessProjectName(founderPrompt),
    maxIterations: config.maxIterations,
    model: deps.llm.model,
  });

  let state: RunState;
  try {
    state = (await app.invoke(initial, invokeConfig)) as RunState;
  } catch (err) {
    if (!(err instanceof GraphHaltedError)) throw err;
    // Halt oleh operator: checkpoint tersimpan, stage di-report sebagai 'halted'.
    const snapshot = await app.getState(invokeConfig);
    state = { ...(snapshot.values as RunState), stage: 'halted' };
  }

  return {
    state,
    events,
    tokensUsed: budget.total,
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

/** Nama proyek untuk PRD & URL deploy, diturunkan dari prompt Founder. */
function guessProjectName(prompt: string): string {
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
