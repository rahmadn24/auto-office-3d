import { EventBus } from './events';
import { buildOrchestrator } from './graph/build';
import { initialState } from './graph/state';
import { createLLM } from './llm';
import { createMemory } from './memory';
import type { MemoryProvider } from './memory/provider';
import { createSandbox } from './sandbox';
import { slugify } from './slug';
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
}

export interface RunResult {
  state: RunState;
  events: EventBus;
  tokensUsed: number;
}

/** Menjalankan satu siklus penuh: Founder prompt → live URL → sale pertama. */
export async function runAutonomous(
  founderPrompt: string,
  options: RunOptions = {},
): Promise<RunResult> {
  const config = options.config ?? loadConfig();
  const events = options.emit ?? new EventBus();
  const budget = new TokenBudget(config.tokenBudget);

  const memory = createMemory(config);
  if (options.seed !== false) await seedMemory(memory);

  const deps: GraphDeps = {
    llm: createLLM(config),
    memory,
    sandbox: createSandbox(config),
    emit: events,
    budget,
  };

  const runId = `run_${Date.now().toString(36)}`;
  const app = buildOrchestrator(deps);

  const initial = initialState({
    runId,
    founderPrompt,
    projectName: guessProjectName(founderPrompt),
    maxIterations: config.maxIterations,
    model: deps.llm.model,
  });

  const state = (await app.invoke(initial, { recursionLimit: 64 })) as RunState;
  return { state, events, tokensUsed: budget.total };
}

/** Nama proyek untuk PRD & URL deploy, diturunkan dari prompt Founder. */
function guessProjectName(prompt: string): string {
  const words = prompt
    .split(/\s+/)
    .filter((w) => /^[a-zA-Z][a-zA-Z0-9'-]*$/.test(w))
    .filter((w) => !/^(a|an|the|with|for|and|of|that|which|to|in|on|my|our|please|build|make|create)$/i.test(w))
    .slice(0, 4);
  const joined = words.join(' ');
  return joined.trim() || 'AutoInvoice Engine';
}
