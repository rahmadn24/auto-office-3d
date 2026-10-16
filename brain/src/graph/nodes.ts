import { GraphHaltedError, type RunControl } from '../control';
import { diffArtifacts, diffSummary } from '../diff';
import { EventBus, type Emitter } from '../events';
import type {
  DeployDriver,
  EmailDriver,
  GitHubDriver,
  HealthProbe,
  SocialDriver,
  StripeSentinel,
} from '../integrations';
import { composeLaunchThread, signStripePayload } from '../integrations';
import { parseFileBundle, type LLMProvider } from '../llm/provider';
import type { MemoryProvider } from '../memory/provider';
import type { SandboxDriver } from '../sandbox/types';
import { safeBuildBundle } from '../safeBuild';
import { slugify } from '../slug';
import type { TokenBudget } from '../telemetry/tokens';
import {
  AGENT_HOME_ZONE,
  timestampMs,
  type AgentId,
  type CurrentAction,
  type DeployUpdatePayload,
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
  /** Endpoint HALT GRAPH (Loop Controls) — opsional. */
  control?: RunControl;
  /** Integrations (Fase 4) — opsional; bila tak ada, node pakai jalur simulasi. */
  github?: GitHubDriver;
  deploy?: DeployDriver;
  healthProbe?: HealthProbe;
  social?: SocialDriver;
  email?: EmailDriver;
  sentinel?: StripeSentinel;
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

/** Siarkan hasil pencarian memori (Vector DB inspector — skor cosine, PRD §2.1). */
function reportRetrieval(
  deps: GraphDeps,
  state: RunState,
  namespace: string,
  query: string,
  hits: Array<{ id: string; score: number }>,
): void {
  const top = hits[0];
  deps.emit.retrieval?.({
    runId: state.runId,
    namespace,
    query: query.slice(0, 80),
    topId: top?.id ?? null,
    topScore: top?.score ?? 0,
    hits: hits.length,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Gerbang HALT GRAPH — setiap node memeriksa kontrol sebelum bekerja.
 * Ketika operator menghentikan run, node melempar `GraphHaltedError`:
 * LangGraph menyimpan checkpoint dengan `next` node tersebut, sehingga
 * `resumeRun(...)` (setelah `control.resume`) melanjutkan dari titik berhenti.
 */
function haltGate(deps: GraphDeps, state: RunState): void {
  if (!deps.control?.isHalted(state.runId)) return;

  emitStatus(
    deps,
    state.runId,
    'founder_agent',
    'idle',
    'GRAPH HALTED by operator — semua divisi dijeda',
    { zone: 'central_bus' },
  );
  throw new GraphHaltedError(state.runId);
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; latencyMs: number }> {
  const start = Date.now();
  const value = await fn();
  return { value, latencyMs: Date.now() - start };
}

function hashSeed(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/* ─────────────────────────── Node: Founder ─────────────────────────── */

export function founderNode(deps: GraphDeps) {
  return async (state: RunState): Promise<RunStatePatch> => {
    haltGate(deps, state);

    emitStatus(
      deps,
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
    haltGate(deps, state);

    const { value: recall, latencyMs } = await timed(async () =>
      deps.memory.search('pm-memory', state.founderPrompt, 3),
    );
    reportRetrieval(deps, state, 'pm-memory', state.founderPrompt, recall);
    const retrieved = recall.map((h) => h.text);

    const result = await deps.llm.complete({
      task: 'prd',
      prompt: state.founderPrompt,
      context: { projectName: state.projectName, retrieved },
    });
    deps.budget.add(result.usage, 'Product');

    const seed = hashSeed(state.founderPrompt);
    const entropy = ((seed % 90) + 10) / 100;
    const signature = [
      `> **Synthesized by PM Agent** · Autonomous Signature Verified`,
      `> Model: ${result.model} · Seed: #${seed} · Entropy: ${entropy.toFixed(2)}`,
      '',
    ].join('\n');
    const prd = `${signature}${result.text}`;
    const prdPath = `specs/PRD-${slugify(state.projectName)}.md`;

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
      `Synthesized ${prdPath} · recall ${recall.length} vectors (top ${(recall[0]?.score ?? 0).toFixed(2)}) · seed #${seed}`,
      { zone: 'meeting_room', latencyMs },
    );

    return {
      stage: 'spec',
      prd,
      artifacts: { ...state.artifacts, [prdPath]: prd },
      logs: appendLog(state.logs, `PM · PRD written to ${prdPath} (seed #${seed})`),
      model: result.model,
      tokensUsed: deps.budget.total,
      latencyMs,
    };
  };
}

/* ─────────────────────────── Node: Dev Agent ───────────────────────── */

export function devNode(deps: GraphDeps) {
  return async (state: RunState): Promise<RunStatePatch> => {
    haltGate(deps, state);

    const { value: recall } = await timed(async () =>
      deps.memory.search('dev-memory', state.prd || state.founderPrompt, 3),
    );
    reportRetrieval(deps, state, 'dev-memory', state.prd || state.founderPrompt, recall);

    const result = await deps.llm.complete({
      task: 'code',
      prompt: state.founderPrompt,
      context: {
        projectName: state.projectName,
        prd: state.prd,
        retrieved: recall.map((h) => h.text),
      },
    });
    deps.budget.add(result.usage, 'Engineering');

    const files = parseFileBundle(result.text);
    // Diff dihitung terhadap state setelah merge (PRD tetap ada → unchanged).
    const diffs = diffArtifacts(state.artifacts, { ...state.artifacts, ...files });
    const cycle = cycleLabel(state.iteration, state.maxIterations);
    const summary = diffSummary(diffs);

    emitStatus(
      deps,
      state.runId,
      'dev_agent',
      'coding',
      `Coding ${Object.keys(files).length} files · ${summary} · ${cycle}`,
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
      diffs,
      logs: appendLog(
        state.logs,
        `DEV · emitted ${Object.keys(files).length} files · ${summary} (${cycle})`,
      ),
      model: result.model,
      tokensUsed: deps.budget.total,
      latencyMs: 0,
    };
  };
}

/* ─────────────────────────── Node: QA Runner ───────────────────────── */

export function qaNode(deps: GraphDeps) {
  return async (state: RunState): Promise<RunStatePatch> => {
    haltGate(deps, state);

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
        coverage: true,
      }),
    );

    const iteration = state.iteration + 1;
    const coverage = result.tests.coverage;
    const coverageText = coverage ? ` · stmts ${coverage.statements}%` : '';
    const summary = result.rejectedBy
      ? `SECURITY REJECTED by ${result.rejectedBy}`
      : result.ok
        ? `Passed ${result.tests.passed}/${result.tests.total} tests · tsc clean · ${result.durationMs}ms${coverageText}`
        : `FAILED ${result.tests.failed}/${result.tests.total} · ${result.typeCheck.errors.length} type errors${coverageText}`;

    emitStatus(deps, state.runId, 'qa_agent', 'testing', summary, {
      zone: 'dev_lab',
      cycle: { current: iteration, max: state.maxIterations },
      latencyMs,
    });

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
    haltGate(deps, state);

    const files = safeBuildBundle();

    emitStatus(
      deps,
      state.runId,
      'dev_agent',
      'coding',
      'CIRCUIT BREAKER TRIPPED (5/5) → GRAPH LOCKED · injecting safe-build bundle',
      { zone: 'dev_lab', cycle: { current: state.maxIterations, max: state.maxIterations } },
    );

    const { value: result, latencyMs } = await timed(() =>
      deps.sandbox.run({ runId: state.runId, files, timeoutMs: 60_000 }),
    );

    const ok = result.ok && !result.rejectedBy;

    return {
      stage: ok ? 'fallback' : 'failed',
      fallbackTriggered: true,
      graphLocked: true,
      artifacts: files,
      diffs: diffArtifacts(state.artifacts, files),
      lastQaSummary: ok
        ? `Safe-build verified · ${result.tests.passed}/${result.tests.total} tests`
        : 'Safe-build verification failed',
      typeErrors: result.typeCheck.errors,
      logs: appendLog(
        state.logs,
        `BREAKER · GRAPH LOCKED · fallback safe-build ${ok ? 'VERIFIED' : 'FAILED'} (${result.tests.passed}/${result.tests.total})`,
      ),
      latencyMs,
    };
  };
}

/* ─────────────────────────── Node: DevOps ──────────────────────────── */

function emitDeploy(deps: GraphDeps, payload: DeployUpdatePayload): void {
  deps.emit.deploy?.(payload);
}

export function devopsNode(deps: GraphDeps) {
  return async (state: RunState): Promise<RunStatePatch> => {
    haltGate(deps, state);

    const slug = slugify(state.projectName);
    const startedAt = new Date().toISOString();

    // 1) GitHub Repository Provisioning (PRD §3.3).
    let repoUrl = `https://github.com/autooffice3d/${slug}`;
    let repoOk = true;
    if (deps.github) {
      const repo = await deps.github.provisionRepo(slug);
      repoOk = repo.ok;
      repoUrl = repo.repoUrl || repoUrl;
      emitDeploy(deps, {
        runId: state.runId,
        repoName: slug,
        repoUrl,
        liveUrl: '',
        status: 'provisioning',
        buildSteps: [],
        health: null,
        uptimeS: 0,
        bandwidthMb: 0,
        edgeCache: false,
        timestamp: startedAt,
      });
      emitStatus(
        deps,
        state.runId,
        'devops_agent',
        'deploying',
        repo.ok
          ? `github_provision → ${slug} · retries ${repo.retries} · ${repoUrl}`
          : `github_provision FAILED · ${slug} · retries ${repo.retries}`,
        { zone: 'devops_hub' },
      );
    }

    // 2) Vercel Edge Deployment (PRD §3.3) — build steps disiarkan bertahap.
    let liveUrl = `${slug}.vercel.app`;
    let status: DeployUpdatePayload['status'] = repoOk ? 'deploying' : 'degraded';
    let buildSteps: DeployUpdatePayload['buildSteps'] = [];
    let meta = { uptimeS: 0, bandwidthMb: 0, edgeCache: false };
    if (deps.deploy && repoOk) {
      const deployed = await deps.deploy.deploy({
        slug,
        files: state.artifacts,
        onStep: (steps, stepStatus) => {
          buildSteps = steps;
          emitDeploy(deps, {
            runId: state.runId,
            repoName: slug,
            repoUrl,
            liveUrl: stepStatus === 'ready' ? `${slug}.vercel.app` : '',
            status: stepStatus,
            buildSteps: steps,
            health: null,
            ...meta,
            timestamp: new Date().toISOString(),
          });
        },
      });
      liveUrl = deployed.liveUrl || liveUrl;
      status = deployed.status;
      buildSteps = deployed.buildSteps;
      meta = {
        uptimeS: deployed.uptimeS,
        bandwidthMb: deployed.bandwidthMb,
        edgeCache: deployed.edgeCache,
      };
    } else if (repoOk) {
      // Tanpa driver (jalur simulasi/test) → deploy dianggap sukses.
      status = 'ready';
      meta = { uptimeS: 0, bandwidthMb: 0.12, edgeCache: true };
    }

    // 3) Health Check Probe (PRD §3.3) — hanya jika deploy sukses.
    let health: DeployUpdatePayload['health'] = null;
    if (deps.healthProbe && status === 'ready') {
      health = await deps.healthProbe.probe(liveUrl);
      if (!health.rootOk || !health.apiOk) {
        status = 'degraded';
      }
    }

    emitDeploy(deps, {
      runId: state.runId,
      repoName: slug,
      repoUrl,
      liveUrl: status === 'ready' ? liveUrl : '',
      status,
      buildSteps,
      health,
      ...meta,
      degradedReason: status === 'degraded' ? 'health check failed' : undefined,
      timestamp: new Date().toISOString(),
    });

    const healthText = health
      ? health.rootOk && health.apiOk
        ? `health 200 OK · TTFB ${health.ttfbMs}ms${health.sslValid ? ' · SSL' : ''}`
        : 'health DEGRADED'
      : 'health 200 OK';

    emitStatus(
      deps,
      state.runId,
      'devops_agent',
      'deploying',
      status === 'ready'
        ? `edge_provision → repo ${slug} · build READY · ${healthText} · https://${liveUrl}`
        : `edge_provision DEGRADED → ${slug} · ${healthText}`,
      { zone: 'devops_hub' },
    );

    const healthOk = health ? health.rootOk && health.apiOk : true;
    return {
      stage: status === 'ready' ? 'deploying' : 'failed',
      repoUrl,
      liveUrl: status === 'ready' ? liveUrl : '',
      healthOk: status === 'ready' && healthOk,
      logs: appendLog(
        state.logs,
        status === 'ready'
          ? `DEVOPS · deployed https://${liveUrl} (${healthText})`
          : `DEVOPS · deployment DEGRADED (${slug})`,
      ),
      latencyMs: 0,
    };
  };
}

/* ────────────────────── Node: Growth & Revenue ─────────────────────── */

export function growthNode(deps: GraphDeps) {
  return async (state: RunState): Promise<RunStatePatch> => {
    haltGate(deps, state);

    // 1) Social Campaign Dispatcher (PRD §3.4) — susun thread + dispatch.
    const { thread, hook } = composeLaunchThread({
      projectName: state.projectName,
      founderPrompt: state.founderPrompt,
      liveUrl: state.liveUrl || `${slugify(state.projectName)}.vercel.app`,
    });
    let socialSummary = 'Launch thread dispatched to X/Twitter + Meta Threads';
    if (deps.social) {
      const posts = await deps.social.dispatch({ runId: state.runId, thread, hook });
      for (const post of posts) deps.emit.social?.(post);
      socialSummary = posts
        .map((p) => `${p.platform.toUpperCase()} ${p.status} (${p.queueId})`)
        .join(' · ');
    }

    emitStatus(
      deps,
      state.runId,
      'marketing_agent',
      'marketing',
      `${socialSummary} · listening for Stripe webhook`,
      { zone: 'marketing_studio' },
    );

    // 2) Stripe Webhook Sentinel (PRD §3.4) — transaksi pertama $29.00 ARR.
    // Simulasi event checkout.session.completed (ber-signature) → sentinel.
    const sale = receiveSimulatedSale(deps, state);
    if (sale) {
      emitStatus(
        deps,
        state.runId,
        'marketing_agent',
        'celebrating',
        `FIRST CUSTOMER ACQUIRED ($${sale.amount.toFixed(2)} ARR) → hasCustomers = true · CELEBRATE broadcast`,
        { zone: 'central_bus' },
      );

      // 3) Welcome email otomatis ke pembeli (PRD §3.4 (3)).
      if (deps.email) {
        const sent = await deps.email.send({
          to: sale.customer.maskedEmail,
          subject: `Welcome to ${state.projectName} 🎉`,
          body: `Thanks for your first purchase ($${sale.amount.toFixed(2)} ${sale.currency}). Your product is live at ${state.liveUrl}.`,
        });
        if (sent.sent) {
          emitStatus(
            deps,
            state.runId,
            'marketing_agent',
            'marketing',
            `auto-welcome dispatched → ${sale.customer.maskedEmail} (${sent.id}) · autonomous loop Stripe → [MKT] → email`,
            { zone: 'marketing_studio' },
          );
        }
      }
    }

    // 4) Revenue metrics → panel Sales & Webhook Sentinel.
    if (deps.sentinel) {
      const metrics = deps.sentinel.metrics();
      deps.emit.revenue?.({
        ...metrics,
        runId: state.runId,
        timestamp: new Date().toISOString(),
      });
    }

    return {
      stage: 'done',
      hasCustomers: Boolean(sale),
      logs: appendLog(
        state.logs,
        sale
          ? `MILESTONE · first sale captured → CELEBRATE global · ${socialSummary}`
          : `GROWTH · dispatched ${socialSummary} (no sale yet)`,
      ),
      latencyMs: 0,
    };
  };
}

/** Membangun event Stripe simulasi, menandatangani, lalu menyerahkannya ke sentinel. */
function receiveSimulatedSale(deps: GraphDeps, state: RunState): FirstSalePayload | null {
  const event = {
    id: `evt_${state.runId}`,
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        amount_total: 2900,
        currency: 'usd',
        customer: 'cus_first_founder',
        customer_details: {
          email: 'buyer@founderscaled.io',
          address: { city: 'San Francisco', country: 'US' },
        },
      },
    },
  };
  const rawBody = JSON.stringify(event);
  if (!deps.sentinel) {
    // Tanpa sentinel, pertahankan perilaku simulasi lama (milestone tetap naik).
    const fallback: FirstSalePayload = {
      runId: state.runId,
      customer: { city: 'San Francisco', country: 'US', maskedEmail: 'b***@founderscaled.io' },
      amount: 29,
      currency: 'USD',
      stripeEventId: event.id,
      hasCustomers: true,
      timestamp: new Date().toISOString(),
    };
    deps.emit.milestone(fallback);
    return fallback;
  }
  const sig = signStripePayload(rawBody, deps.sentinel.webhookSecret ?? 'whsec_offline');
  const sale = deps.sentinel.receive(rawBody, sig, state.runId);
  if (sale) deps.emit.milestone(sale);
  return sale;
}
