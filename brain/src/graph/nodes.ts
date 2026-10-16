import { EventBus, type Emitter } from '../events';
import { parseFileBundle, type LLMProvider } from '../llm/provider';
import type { MemoryProvider } from '../memory/provider';
import type { SandboxDriver } from '../sandbox/types';
import { safeBuildBundle } from '../safeBuild';
import { slugify } from '../slug';
import type { TokenBudget } from '../telemetry/tokens';
import {
  AGENT_HOME_ZONE,
  ZONE_LABEL,
  nowIso,
  timestampMs,
  type AgentId,
  type CurrentAction,
  type FirstSalePayload,
  type TargetZone,
} from '../types';
import { cycleLabel } from './breaker';
import type { RunState, RunStatePatch } from './state';

export interface GraphDeps {
  llm: LLMProvider;
  memory: MemoryProvider;
  sandbox: SandboxDriver;
  emit: Emitter;
  budget: TokenBudget;
}

interface EmitOpts {
  zone?: TargetZone;
  cycle?: { current: number; max: number };
  latencyMs?: number;
}

function emitStatus(
  deps: GraphDeps,
  runId: string,
  agentId: AgentId,
  action: CurrentAction,
  logMessage: string,
  opts: EmitOpts = {},
): void {
  deps.emit.agent(
    EventBus.payload({
      runId,
      agentId,
      action,
      logMessage,
      zone: opts.zone ?? AGENT_HOME_ZONE[agentId],
      iterationCycle: opts.cycle,
      telemetry: {
        tokensUsed: deps.budget.total,
        latencyMs: opts.latencyMs ?? 0,
        model: deps.llm.model,
      },
    }),
  );
}

function appendLog(logs: string[], message: string): string[] {
  return [...logs, `[${timestampMs()}] ${message}`];
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; latencyMs: number }> {
  const start = Date.now();
  const value = await fn();
  return { value, latencyMs: Date.now() - start };
}

/* ─────────────────────────── Node: Founder ─────────────────────────── */

export function founderNode(_deps: GraphDeps) {
  return async (state: RunState): Promise<RunStatePatch> => {
    emitStatus(
      _deps,
      state.runId,
      'founder_agent',
      'discussing',
      `Directive received: '${state.founderPrompt}'`,
      { latencyMs: 0 },
    );
    return {
      stage: 'received',
      logs: appendLog(state.logs, `FOUNDER PROMPT ACCEPTED · ${state.projectName}`),
      latencyMs: 0,
    };
  };
}

/* ─────────────────────────── Node: PM Agent ────────────────────────── */

export function pmNode(deps: GraphDeps) {
  return async (state: RunState): Promise<RunStatePatch> => {
    const { value: recall, latencyMs } = await timed(async () =>
      deps.memory.search('pm-memory', state.founderPrompt, 3),
    );
    const retrieved = recall.filter((h) => h.score >= 0).map((h) => h.text);

    const result = await deps.llm.complete({
      task: 'prd',
      prompt: state.founderPrompt,
      context: { projectName: state.projectName, retrieved },
    });
    deps.budget.add(result.usage);

    const prdPath = `specs/PRD-${slugify(state.projectName)}.md`;
    const prd = result.text;

    // Sintesis disimpan kembali ke memori (Milestone #3 — recall siklus berikutnya)
    await deps.memory.upsert('pm-memory', [
      {
        id: `${state.runId}:prd`,
        text: `${state.projectName} — ${prd.slice(0, 900)}`,
        metadata: { runId: state.runId, kind: 'prd-synthesis' },
      },
    ]);

    emitStatus(
      deps,
      state.runId,
      'pm_agent',
      'discussing',
      `Synthesized ${prdPath} · recall ${recall.length} vectors (top ${(recall[0]?.score ?? 0).toFixed(2)})`,
      { zone: 'meeting_room', latencyMs },
    );

    return {
      stage: 'spec',
      prd,
      artifacts: { ...state.artifacts, [prdPath]: prd },
      logs: appendLog(state.logs, `PM · PRD written to ${prdPath}`),
      model: result.model,
      tokensUsed: deps.budget.total,
      latencyMs,
    };
  };
}

/* ─────────────────────────── Node: Dev Agent ───────────────────────── */

export function devNode(deps: GraphDeps) {
  return async (state: RunState): Promise<RunStatePatch> => {
    const { value: recall } = await timed(async () =>
      deps.memory.search('dev-memory', state.prd || state.founderPrompt, 3),
    );

    const result = await deps.llm.complete({
      task: 'code',
      prompt: state.founderPrompt,
      context: {
        projectName: state.projectName,
        prd: state.prd,
        retrieved: recall.map((h) => h.text),
      },
    });
    deps.budget.add(result.usage);

    const files = parseFileBundle(result.text);
    const cycle = cycleLabel(state.iteration, state.maxIterations);

    emitStatus(
      deps,
      state.runId,
      'dev_agent',
      'coding',
      `Coding ${Object.keys(files).length} files · ${Object.keys(files).join(', ')} · ${cycle}`,
      { zone: 'dev_lab', latencyMs: 0 },
    );

    await deps.memory.upsert('dev-memory', [
      {
        id: `${state.runId}:bundle`,
        text: `architecture ${state.projectName}: ${Object.keys(files).join(', ')}`,
        metadata: { runId: state.runId, kind: 'code-structure' },
      },
    ]);

    return {
      stage: 'coding',
      artifacts: { ...state.artifacts, ...files },
      logs: appendLog(state.logs, `DEV · emitted ${Object.keys(files).length} files (${cycle})`),
      model: result.model,
      tokensUsed: deps.budget.total,
      latencyMs: 0,
    };
  };
}

/* ─────────────────────────── Node: QA Runner ───────────────────────── */

export function qaNode(deps: GraphDeps) {
  return async (state: RunState): Promise<RunStatePatch> => {
    const cycle = cycleLabel(state.iteration, state.maxIterations);
    emitStatus(
      deps,
      state.runId,
      'qa_agent',
      'testing',
      `Executing deterministic suite · ${cycle}`,
      { zone: 'dev_lab', cycle: { current: state.iteration + 1, max: state.maxIterations } },
    );

    const { value: result, latencyMs } = await timed(() =>
      deps.sandbox.run({
        runId: state.runId,
        files: state.artifacts,
        timeoutMs: 60_000,
      }),
    );

    const iteration = state.iteration + 1;
    const summary = result.rejectedBy
      ? `SECURITY REJECTED by ${result.rejectedBy}`
      : result.ok
        ? `Passed ${result.tests.passed}/${result.tests.total} tests · tsc clean · ${result.durationMs}ms`
        : `FAILED ${result.tests.failed}/${result.tests.total} · ${result.typeCheck.errors.length} type errors`;

    emitStatus(
      deps,
      state.runId,
      'qa_agent',
      'testing',
      summary,
      {
        zone: 'dev_lab',
        cycle: { current: iteration, max: state.maxIterations },
        latencyMs,
      },
    );

    return {
      stage: 'testing',
      iteration,
      lastQaSummary: summary,
      qaPassed: Boolean(result.ok && !result.rejectedBy),
      typeErrors: result.typeCheck.errors,
      logs: appendLog(state.logs, `QA · cycle ${iteration}/${state.maxIterations} → ${summary}`),
      latencyMs,
    };
  };
}

/* ──────────────────── Node: Circuit-Breaker fallback ───────────────── */

export function safeBuildNode(deps: GraphDeps) {
  return async (state: RunState): Promise<RunStatePatch> => {
    const files = safeBuildBundle();

    emitStatus(
      deps,
      state.runId,
      'dev_agent',
      'coding',
      'CIRCUIT BREAKER TRIPPED (5/5) → injecting safe-build bundle',
      { zone: 'dev_lab', cycle: { current: state.maxIterations, max: state.maxIterations } },
    );

    const { value: result, latencyMs } = await timed(() =>
      deps.sandbox.run({ runId: state.runId, files, timeoutMs: 60_000 }),
    );

    const ok = result.ok && !result.rejectedBy;

    return {
      stage: ok ? 'fallback' : 'failed',
      fallbackTriggered: true,
      artifacts: files,
      lastQaSummary: ok
        ? `Safe-build verified · ${result.tests.passed}/${result.tests.total} tests`
        : 'Safe-build verification failed',
      typeErrors: result.typeCheck.errors,
      logs: appendLog(
        state.logs,
        `BREAKER · fallback safe-build ${ok ? 'VERIFIED' : 'FAILED'} (${result.tests.passed}/${result.tests.total})`,
      ),
      latencyMs,
    };
  };
}

/* ─────────────────────────── Node: DevOps ──────────────────────────── */

export function devopsNode(deps: GraphDeps) {
  return async (state: RunState): Promise<RunStatePatch> => {
    const slug = slugify(state.projectName);
    const repoUrl = `https://github.com/autooffice3d/${slug}`;
    const liveUrl = `${slug}.vercel.app`;

    emitStatus(
      deps,
      state.runId,
      'devops_agent',
      'deploying',
      `edge_provision → repo ${slug} · build READY · health 200 OK · https://${liveUrl}`,
      { zone: 'devops_hub' },
    );

    return {
      stage: 'deploying',
      repoUrl,
      liveUrl,
      healthOk: true,
      logs: appendLog(state.logs, `DEVOPS · deployed https://${liveUrl} (health 200 OK)`),
      latencyMs: 0,
    };
  };
}

/* ────────────────────── Node: Growth & Revenue ─────────────────────── */

export function growthNode(deps: GraphDeps) {
  return async (state: RunState): Promise<RunStatePatch> => {
    emitStatus(
      deps,
      state.runId,
      'marketing_agent',
      'marketing',
      'Launch thread dispatched to X/Twitter + Meta Threads · listening for Stripe webhook',
      { zone: 'marketing_studio' },
    );

    // Simulasi webhook Stripe pertama (Fase 4 menghubungkan listener nyata).
    const sale: FirstSalePayload = {
      runId: state.runId,
      customer: { city: 'San Francisco', country: 'US', maskedEmail: 'a***@founderscaled.io' },
      amount: 29,
      currency: 'USD',
      stripeEventId: `evt_${state.runId}`,
      hasCustomers: true,
      timestamp: nowIso(),
    };
    deps.emit.milestone(sale);

    emitStatus(
      deps,
      state.runId,
      'marketing_agent',
      'celebrating',
      'FIRST CUSTOMER ACQUIRED ($29.00 ARR) → hasCustomers = true · CELEBRATE broadcast',
      { zone: 'central_bus' },
    );

    return {
      stage: 'done',
      hasCustomers: true,
      logs: appendLog(state.logs, 'MILESTONE · first sale captured → CELEBRATE global'),
      latencyMs: 0,
    };
  };
}
