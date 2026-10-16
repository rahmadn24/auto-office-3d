import type { BuildStep, DeployStatus } from '../types';
import type { DeployDriver, DeployInput, DeployResult } from './types';

function pseudoSlug(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x010000193) >>> 0;
  }
  return hash.toString(36).slice(0, 6);
}

/** Urutan langkah build sesuai AC kartu ▲ (tampil di panel CI/CD). */
function buildPipeline(): Array<{ label: string; delayMs: number }> {
  return [
    { label: 'npm run build', delayMs: 120 },
    { label: 'Compiled successfully', delayMs: 90 },
    { label: 'Generating static pages', delayMs: 80 },
    { label: 'Deployed to Edge Cache', delayMs: 70 },
  ];
}

function stepsTemplate(): BuildStep[] {
  return buildPipeline().map((s) => ({ label: s.label, status: 'pending' }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Driver offline: mensimulasikan Vercel build pipeline (npm run build →
 * Compiled successfully → Generating static pages → Deployed to Edge Cache → READY)
 * tanpa jaringan. Dipakai demo & test; `onStep` disiarkan bertahap ke Theater.
 */
export class LocalVercel implements DeployDriver {
  readonly driver = 'local';

  async deploy(input: DeployInput): Promise<DeployResult> {
    const steps = stepsTemplate();
    const pipeline = buildPipeline();
    const url = `${input.slug}.vercel.app`;
    input.onStep?.([...steps], 'building');

    for (let i = 0; i < pipeline.length; i++) {
      const step = pipeline[i];
      if (!step) continue;
      steps[i] = { label: step.label, status: 'running' };
      input.onStep?.([...steps], 'building');
      await sleep(step.delayMs);
      steps[i] = { label: step.label, status: 'done' };
      input.onStep?.([...steps], 'building');
    }

    input.onStep?.([...steps], 'deploying');
    await sleep(50);

    const result: DeployResult = {
      liveUrl: url,
      status: 'ready' as DeployStatus,
      buildSteps: steps,
      uptimeS: 0,
      bandwidthMb: Number((Object.keys(input.files).length * 0.12).toFixed(2)),
      edgeCache: true,
    };
    input.onStep?.([...steps], 'ready');
    return result;
  }
}

/** Driver produksi: Vercel Edge API (PRD §3.3). Butuh VERCEL_TOKEN. */
export class LiveVercel implements DeployDriver {
  readonly driver = 'vercel';

  constructor(private readonly token: string) {}

  private headers(): Record<string, string> {
    return { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' };
  }

  async deploy(input: DeployInput): Promise<DeployResult> {
    const steps = stepsTemplate();
    input.onStep?.([...steps], 'building');

    const res = await fetch('https://api.vercel.com/v13/deployments', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ name: input.slug, target: 'production', files: [] }),
    });
    if (!res.ok) {
      const stepsFailed = steps.map((s, i) => (i === 0 ? { ...s, status: 'done' as const } : s));
      input.onStep?.(stepsFailed, 'degraded');
      return {
        liveUrl: '',
        status: 'degraded',
        buildSteps: stepsFailed,
        uptimeS: 0,
        bandwidthMb: 0,
        edgeCache: false,
      };
    }
    const created = (await res.json()) as { url?: string; id?: string };
    const id = created.id ?? '';
    const host = created.url ?? `${input.slug}.vercel.app`;

    // Poll build status sampai READY (batas 60s, PRD §3.3).
    const deadline = Date.now() + 60_000;
    let state = 'BUILDING';
    while (Date.now() < deadline) {
      const poll = await fetch(`https://api.vercel.com/v6/deployments/${id}`, {
        headers: this.headers(),
      });
      const body = (await poll.json().catch(() => ({}))) as { readyState?: string };
      state = body.readyState ?? 'READY';
      if (state === 'READY' || state === 'ERROR') break;
      await sleep(1500);
    }

    const ready = state === 'READY';
    const doneSteps = steps.map((s) => ({ ...s, status: 'done' as const }));
    input.onStep?.([...doneSteps], ready ? 'ready' : 'degraded');
    return {
      liveUrl: ready ? host : '',
      status: ready ? 'ready' : 'degraded',
      buildSteps: doneSteps,
      uptimeS: 0,
      bandwidthMb: Number((Object.keys(input.files).length * 0.12).toFixed(2)),
      edgeCache: ready,
    };
  }
}

/** Nama file dipakai pula oleh health probe & factory. */
export { stepsTemplate, pseudoSlug };

export type { DeployDriver, DeployInput, DeployResult } from './types';
