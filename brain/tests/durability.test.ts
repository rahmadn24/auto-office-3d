import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config';
import { createControl } from '../src/control';
import { createCheckpointer, openOfficeDb, RunStore } from '../src/durability/store';
import { EventBus } from '../src/events';
import { resumeAutonomous, runAutonomous } from '../src/run';
import type { ArtifactsPayload } from '../src/types';

const dir = mkdtempSync(join(tmpdir(), 'ao3d-dur-'));
const dbPath = join(dir, 'office.db');

describe('RunStore — run history & event log durable (PRD v3.0 §4.4)', () => {
  it('start → running · finish → completed · listRuns & events tersimpan', () => {
    const db = openOfficeDb(dbPath);
    const store = new RunStore(db);

    store.startRun({ runId: 'run_a', directive: 'buat invoice', projectName: 'AutoInvoice' });
    expect(store.getRun('run_a')?.status).toBe('running');
    expect(store.getRun('run_a')?.projectName).toBe('AutoInvoice');

    store.appendEvent({
      runId: 'run_a',
      kind: 'agent',
      agent: 'pm_agent',
      message: 'menyusun PRD',
    });
    store.finishRun('run_a', {
      status: 'completed',
      stage: 'done',
      tokensUsed: 1234,
      liveUrl: 'x.vercel.app',
      repoUrl: 'https://github.com/x/y',
    });

    const run = store.getRun('run_a')!;
    expect(run.status).toBe('completed');
    expect(run.stage).toBe('done');
    expect(run.tokensUsed).toBe(1234);
    expect(run.liveUrl).toBe('x.vercel.app');
    expect(store.listRuns()).toHaveLength(1);
    expect(store.listEvents('run_a')).toHaveLength(1);
    db.close();
  });

  it('boot recovery: run tersangkut `running` ditandai `interrupted` (idempoten)', () => {
    const db = openOfficeDb(dbPath);
    const store = new RunStore(db);
    store.startRun({ runId: 'run_b', directive: 'landing page portfolio' });

    expect(store.recoverInterrupted()).toEqual(['run_b']);
    expect(store.getRun('run_b')?.status).toBe('interrupted');
    expect(store.recoverInterrupted()).toEqual([]);
    db.close();
  });

  it('attach(bus): seluruh event bus mengalir ke event log', () => {
    const db = openOfficeDb(dbPath);
    const store = new RunStore(db);
    store.startRun({ runId: 'run_c', directive: 'y' });

    const bus = new EventBus();
    const off = store.attach(bus);
    bus.agent(
      EventBus.payload({
        runId: 'run_c',
        agentId: 'dev_agent',
        action: 'coding',
        logMessage: 'menulis kode',
        telemetry: { tokensUsed: 10, latencyMs: 5, model: 'stub' },
      }),
    );
    off();

    const events = store.listEvents('run_c');
    expect(events.some((e) => e.kind === 'agent' && e.agent === 'dev_agent')).toBe(true);
    db.close();
  });

  it('artifacts penuh durable: restart tidak mengosongkan tab Artifacts', () => {
    const db = openOfficeDb(dbPath);
    const store = new RunStore(db);
    store.startRun({ runId: 'run_art', directive: 'bangun invoice engine' });
    const payload: ArtifactsPayload = {
      runId: 'run_art',
      projectName: 'Invoice Engine',
      prd: '# Invoice Engine\n\n## 01 / Executive Summary',
      files: [
        {
          path: 'src/engine.ts',
          content: 'export const total = 0;',
          diff: { status: 'created', added: 1, removed: 0 },
        },
      ],
      qaSummary: 'tsc clean · 1/1 tests',
      qaPassed: true,
      cycles: 1,
      maxCycles: 5,
      tokensUsed: 1234,
      liveUrl: 'invoice.vercel.app',
      repoUrl: 'https://github.com/a/b',
      durationMs: 20_000,
      timestamp: new Date().toISOString(),
    };
    store.saveArtifacts(payload);

    expect(store.latestArtifacts()).toEqual(payload);

    // Data lama: safe-build sudah terverifikasi tetapi qaPassed masih false.
    store.saveArtifacts({
      ...payload,
      runId: 'run_art_legacy',
      qaPassed: false,
      qaSummary: 'Safe-build verified · 7/7 tests',
      timestamp: new Date(Date.now() + 1000).toISOString(),
    });
    expect(store.latestArtifacts()?.qaPassed).toBe(true);
    expect(store.latestArtifacts()?.fallback).toBe(true);
    db.close();
  });
});

describe('Resume setelah "restart" daemon (checkpoint SQLite durable)', () => {
  it('run di-halt di proses #1 → resumeAutonomous di proses #2 menyelesaikan run', async () => {
    const config = loadConfig({ MEMORY_DRIVER: 'memory', DATA_DIR: dir });
    const runId = 'run_restart_1';

    // Proses #1 — halt sebelum node berjalan: checkpoint awal tersimpan ke SQLite.
    const control1 = createControl();
    control1.halt(runId);
    const first = await runAutonomous('Micro-SaaS invoice generator dengan Stripe', {
      config,
      emit: new EventBus(),
      control: control1,
      runId,
      checkpointer: createCheckpointer(dbPath),
    });
    expect(first.state.stage).toBe('halted');

    // Proses #2 — "daemon restart": checkpointer & store baru dari file yang sama.
    const db = openOfficeDb(dbPath);
    const store = new RunStore(db);
    const resumed = await resumeAutonomous(runId, {
      config,
      emit: new EventBus(),
      store,
      checkpointer: createCheckpointer(dbPath),
    });

    expect(resumed.state.stage).toBe('done');
    expect(resumed.state.hasCustomers).toBe(true);
    expect(resumed.state.qaPassed).toBe(true);
    expect(store.getRun(runId)?.status).toBe('completed');
    db.close();
  }, 120_000);

  it('resume run tanpa checkpoint → error yang jelas', async () => {
    const config = loadConfig({ MEMORY_DRIVER: 'memory', DATA_DIR: dir });
    await expect(
      resumeAutonomous('run_tidak_ada', {
        config,
        checkpointer: createCheckpointer(dbPath),
      }),
    ).rejects.toThrow(/No checkpoint found/);
  }, 60_000);
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
