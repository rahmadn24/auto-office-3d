import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';

import { loadConfig } from '../src/config';
import { openOfficeDb, RunStore } from '../src/durability/store';
import { EventBus } from '../src/events';
import type { ReplayFramePayload } from '../src/server/contract';
import { startSocketServer, type BrainServer } from '../src/server/socket';

const db = openOfficeDb(':memory:');
const store = new RunStore(db);

describe('event replay — run_events → run:replay (kartu 10.4, PRD §7)', () => {
  let server: BrainServer;
  let base: string;
  let client: ClientSocket;

  beforeAll(async () => {
    store.startRun({
      runId: 'run_replay',
      directive: 'Build a landing page for waitlist',
      projectName: 'Replay Demo',
    });
    store.appendEvent({
      runId: 'run_replay',
      kind: 'agent',
      agent: 'pm_agent',
      message: 'PRD written · preset landing',
    });
    store.appendEvent({
      runId: 'run_replay',
      kind: 'agent',
      agent: 'dev_agent',
      message: '11 files emitted',
    });
    store.appendEvent({
      runId: 'run_replay',
      kind: 'deploy',
      agent: 'devops_agent',
      message: 'ready · http://127.0.0.1:4599',
      payload: { status: 'ready', liveUrl: 'http://127.0.0.1:4599' },
    });
    store.appendEvent({
      runId: 'run_replay',
      kind: 'milestone',
      message: 'first sale 29 USD',
    });
    store.finishRun('run_replay', { status: 'completed', stage: 'done' });

    server = await startSocketServer(
      { ...loadConfig(), port: 0, socketPath: '/brain-replay' },
      new EventBus(),
      { store },
    );
    const address = server.httpServer.address() as AddressInfo;
    base = `http://127.0.0.1:${address.port}`;
    client = await new Promise<ClientSocket>((resolve) => {
      const c = connectClient(base, {
        path: '/brain-replay',
        transports: ['websocket'],
        reconnection: false,
      });
      c.on('connect', () => resolve(c));
    });
  });

  afterAll(async () => {
    client.close();
    await server.close();
    db.close();
  });

  it('stream ulang memancarkan urutan event sama seperti run aslinya', async () => {
    const frames: ReplayFramePayload[] = [];
    const done = new Promise<void>((resolve) => {
      client.on('run:replay', (raw: ReplayFramePayload) => {
        frames.push(raw);
        if (raw.phase === 'end') resolve();
      });
    });

    const ack = await new Promise<{ ok: boolean; total: number; run?: { status: string } }>(
      (resolve) => {
        client.emit('run:replay', { runId: 'run_replay', stepMs: 0 }, resolve);
      },
    );
    expect(ack.ok).toBe(true);
    expect(ack.total).toBe(4);
    expect(ack.run?.status).toBe('completed');

    await done;
    expect(frames.map((frame) => frame.phase)).toEqual([
      'start',
      'event',
      'event',
      'event',
      'event',
      'end',
    ]);

    const stored = store.listEvents('run_replay', 50);
    const replayed = frames.filter((frame) => frame.phase === 'event').map((frame) => frame.event);
    expect(replayed.map((event) => event?.kind)).toEqual(stored.map((event) => event.kind));
    expect(replayed.map((event) => event?.agent)).toEqual(stored.map((event) => event.agent));
    expect(replayed.map((event) => event?.message)).toEqual(stored.map((event) => event.message));
    expect(replayed.map((event) => event?.seq)).toEqual([1, 2, 3, 4]);
    expect(frames.at(-1)?.index).toBe(4);
    // Payload durable ikut tersalin (mis. status deploy).
    expect((replayed[2]?.payload as { status?: string })?.status).toBe('ready');
  });

  it('runId tak dikenal / kosong → ack error tanpa stream', async () => {
    const missing = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      client.emit('run:replay', { runId: 'run_ghost' }, resolve);
    });
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain('tidak ditemukan');

    const empty = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      client.emit('run:replay', {}, resolve);
    });
    expect(empty.ok).toBe(false);
    expect(empty.error).toContain('runId required');
  });

  it('tanpa store → ack error (run store unavailable)', async () => {
    const bare = await startSocketServer(
      { ...loadConfig(), port: 0, socketPath: '/brain-replay-bare' },
      new EventBus(),
    );
    const address = bare.httpServer.address() as AddressInfo;
    const bareClient = await new Promise<ClientSocket>((resolve) => {
      const c = connectClient(`http://127.0.0.1:${address.port}`, {
        path: '/brain-replay-bare',
        transports: ['websocket'],
        reconnection: false,
      });
      c.on('connect', () => resolve(c));
    });
    const ack = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      bareClient.emit('run:replay', { runId: 'run_replay' }, resolve);
    });
    expect(ack.ok).toBe(false);
    expect(ack.error).toContain('run store unavailable');
    bareClient.close();
    await bare.close();
  });

  it('cancel menghentikan playback tanpa frame end', async () => {
    const frames: ReplayFramePayload[] = [];
    const listener = (raw: ReplayFramePayload): void => {
      frames.push(raw);
    };
    client.on('run:replay', listener);

    const ack = await new Promise<{ ok: boolean }>((resolve) => {
      client.emit('run:replay', { runId: 'run_replay', stepMs: 40 }, resolve);
    });
    expect(ack.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const cancelAck = await new Promise<{ ok: boolean; cancelled: boolean }>((resolve) => {
      client.emit('run:replay', { cancel: true }, resolve);
    });
    expect(cancelAck.cancelled).toBe(true);

    const countAtCancel = frames.length;
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(frames.filter((frame) => frame.phase === 'end')).toHaveLength(0);
    expect(frames.length).toBe(countAtCancel);
    client.off('run:replay', listener);
  });
});
