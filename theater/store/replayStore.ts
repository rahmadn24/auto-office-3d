import { create } from 'zustand';

import type { ReplayEventPayload, ReplayFramePayload, RunRecordPayload } from '@/lib/events';

/**
 * Playback run masa lalu (kartu 10.4 — PRD §7).
 *
 * Frame `run:replay` dari brain (start → event* → end) di-buffer di sini;
 * panel Pipeline menampilkannya sebagai timeline. Store sengaja murni sinkron
 * (tanpa socket) supaya bisa dites tanpa network — bridge socket ada di
 * `lib/brainSocket.ts`.
 */

/** Batas buffer timeline (event runtut, terbaru di ujung). */
export const MAX_REPLAY_EVENTS = 500;

interface ReplayStore {
  /** Run history durable terakhir (snapshot `state:snapshot`). */
  runs: RunRecordPayload[];
  /** Run yang sedang diputar (null = idle). */
  activeRunId: string | null;
  playing: boolean;
  total: number;
  /** Jumlah frame event yang sudah diterima (progress). */
  received: number;
  events: ReplayEventPayload[];
  /** Pesan error terakhir (ack gagal / offline). */
  error: string | null;

  setRuns(runs: RunRecordPayload[]): void;
  /** Mulai playback (dipanggil dari ack `run:replay` / frame start). */
  begin(runId: string, total: number): void;
  applyFrame(frame: ReplayFramePayload): void;
  fail(message: string): void;
  stop(): void;
}

export const useReplay = create<ReplayStore>((set, get) => ({
  runs: [],
  activeRunId: null,
  playing: false,
  total: 0,
  received: 0,
  events: [],
  error: null,

  setRuns: (runs) => set({ runs }),

  begin: (runId, total) =>
    set({
      activeRunId: runId,
      playing: true,
      total,
      received: 0,
      events: [],
      error: null,
    }),

  applyFrame: (frame) => {
    const state = get();
    // Frame run lain (playback basi setelah ganti run) diabaikan.
    if (state.activeRunId !== frame.runId) return;
    if (frame.phase === 'start') {
      set({ playing: true, total: frame.total, received: 0, events: [], error: null });
      return;
    }
    if (frame.phase === 'event') {
      if (!frame.event) return;
      set({
        playing: true,
        total: frame.total,
        received: frame.index,
        events: [...state.events, frame.event].slice(-MAX_REPLAY_EVENTS),
      });
      return;
    }
    // end — playback selesai.
    set({ playing: false, total: frame.total, received: frame.index });
  },

  fail: (message) => set({ playing: false, error: message }),

  stop: () => set({ playing: false }),
}));
