import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config';
import { createControl, GraphHaltedError } from '../src/control';
import { EventBus } from '../src/events';
import { resumeRun, runAutonomous } from '../src/run';

const PROMPT = 'Micro-SaaS invoice generator with Stripe integration';

describe('Loop Controls — HALT GRAPH & resume dari checkpoint (PRD §3.2)', () => {
  it('unit RunControl: halt per-run vs semua run + snapshot', () => {
    const control = createControl();
    expect(control.isHalted('a')).toBe(false);

    control.halt('a');
    expect(control.isHalted('a')).toBe(true);
    expect(control.isHalted('b')).toBe(false);
    expect(control.snapshot()).toEqual({ haltedAll: false, runIds: ['a'] });

    control.resume('a');
    expect(control.isHalted('a')).toBe(false);

    control.halt();
    expect(control.isHalted('b')).toBe(true);
    expect(control.snapshot()).toEqual({ haltedAll: true, runIds: [] });

    control.resume();
    expect(control.isHalted('b')).toBe(false);

    const error = new GraphHaltedError('run_x');
    expect(error.name).toBe('GraphHaltedError');
    expect(error.runId).toBe('run_x');
  });

  it('halt sebelum node berjalan → stage halted, lalu resume menyelesaikan run', async () => {
    const control = createControl();
    const runId = 'run_ctrl_before';
    control.halt(runId);

    const events = new EventBus();
    const result = await runAutonomous(PROMPT, {
      config: loadConfig({ MEMORY_DRIVER: 'memory' }),
      emit: events,
      control,
      runId,
    });

    expect(result.state.stage).toBe('halted');
    expect(result.state.hasCustomers).toBe(false);
    expect(events.history.some((p) => p.agentId === 'qa_agent')).toBe(false);
    expect(events.history.some((p) => p.logMessage.includes('GRAPH HALTED'))).toBe(true);

    // Checkpoint tersimpan → resume melanjutkan dari founder tanpa kehilangan state.
    const resumed = await resumeRun(result.app, runId, control);
    expect(resumed.stage).toBe('done');
    expect(resumed.hasCustomers).toBe(true);
    expect(resumed.qaPassed).toBe(true);
    expect(control.isHalted(runId)).toBe(false);
  }, 60_000);

  it('halt di tengah run (sesudah Dev Agent) → QA dilewati, resume melanjutkan ke deploy', async () => {
    const control = createControl();
    const runId = 'run_ctrl_mid';
    const events = new EventBus();

    let halted = false;
    events.onAgent((p) => {
      if (p.agentId === 'dev_agent' && !halted) {
        halted = true;
        control.halt(runId);
      }
    });

    const result = await runAutonomous(PROMPT, {
      config: loadConfig({ MEMORY_DRIVER: 'memory' }),
      emit: events,
      control,
      runId,
    });

    expect(result.state.stage).toBe('halted');
    expect(events.history.some((p) => p.agentId === 'qa_agent')).toBe(false);
    expect(Object.keys(result.state.artifacts).length).toBeGreaterThan(3);

    const resumed = await resumeRun(result.app, runId, control);
    expect(resumed.stage).toBe('done');
    expect(resumed.qaPassed).toBe(true);
    expect(resumed.hasCustomers).toBe(true);
    expect(events.history.some((p) => p.agentId === 'qa_agent')).toBe(true);
  }, 60_000);
});
