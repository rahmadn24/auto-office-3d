import { beforeEach, describe, expect, it } from 'vitest';

import type { ReplayFramePayload, ReplayEventPayload } from '../lib/events';
import { useReplay } from '../store/replayStore';

function event(seq: number, message: string): ReplayEventPayload {
  return {
    seq,
    id: 100 + seq,
    ts: `2026-01-01T00:00:0${seq}.000Z`,
    kind: 'agent',
    agent: 'dev_agent',
    message,
  };
}

function frame(
  phase: ReplayFramePayload['phase'],
  index: number,
  eventPayload?: ReplayEventPayload,
): ReplayFramePayload {
  const payload: ReplayFramePayload = {
    phase,
    runId: 'run_replay',
    total: 3,
    index,
    timestamp: '2026-01-01T00:00:00.000Z',
  };
  if (eventPayload) payload.event = eventPayload;
  return payload;
}

describe('replayStore — playback timeline (kartu 10.4)', () => {
  beforeEach(() => {
    useReplay.setState({
      runs: [],
      activeRunId: null,
      playing: false,
      total: 0,
      received: 0,
      events: [],
      error: null,
    });
  });

  it('setRuns menyimpan run history dari snapshot', () => {
    useReplay.getState().setRuns([
      {
        runId: 'run_1',
        directive: 'Build a landing page',
        projectName: 'Landing Demo',
        status: 'completed',
        stage: 'done',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:05:00.000Z',
        tokensUsed: 1200,
        liveUrl: 'http://127.0.0.1:4599',
        repoUrl: 'https://github.com/demo/landing',
      },
    ]);
    expect(useReplay.getState().runs).toHaveLength(1);
    expect(useReplay.getState().runs[0]?.projectName).toBe('Landing Demo');
  });

  it('begin → frame event* → end: progress & urutan event benar', () => {
    const store = useReplay.getState();
    store.begin('run_replay', 3);
    expect(useReplay.getState().playing).toBe(true);
    expect(useReplay.getState().activeRunId).toBe('run_replay');

    useReplay.getState().applyFrame(frame('start', 0));
    useReplay.getState().applyFrame(frame('event', 1, event(1, 'PRD written')));
    useReplay.getState().applyFrame(frame('event', 2, event(2, 'code emitted')));
    expect(useReplay.getState().received).toBe(2);
    expect(useReplay.getState().playing).toBe(true);

    useReplay.getState().applyFrame(frame('event', 3, event(3, 'deploy ready')));
    useReplay.getState().applyFrame(frame('end', 3));
    const state = useReplay.getState();
    expect(state.playing).toBe(false);
    expect(state.received).toBe(3);
    expect(state.events.map((e) => e.message)).toEqual([
      'PRD written',
      'code emitted',
      'deploy ready',
    ]);
    expect(state.events.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('frame run lain diabaikan (playback basi setelah ganti run)', () => {
    useReplay.getState().begin('run_replay', 3);
    const foreign: ReplayFramePayload = { ...frame('event', 1, event(1, 'x')), runId: 'run_other' };
    useReplay.getState().applyFrame(foreign);
    expect(useReplay.getState().events).toHaveLength(0);
    expect(useReplay.getState().received).toBe(0);
  });

  it('fail & stop menandai playback berhenti (error tampil di panel)', () => {
    useReplay.getState().begin('run_replay', 3);
    useReplay.getState().fail('run tidak ditemukan');
    expect(useReplay.getState().playing).toBe(false);
    expect(useReplay.getState().error).toBe('run tidak ditemukan');

    useReplay.getState().begin('run_replay', 3);
    useReplay.getState().stop();
    expect(useReplay.getState().playing).toBe(false);
    expect(useReplay.getState().error).toBeNull();
  });
});
