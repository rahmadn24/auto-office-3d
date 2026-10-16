import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config';
import { EventBus } from '../src/events';
import { startSocketServer, type BrainServer } from '../src/server/socket';

let server: BrainServer;
let base: string;

beforeAll(async () => {
  server = await startSocketServer(
    { ...loadConfig(), port: 0, socketPath: '/brain-test' },
    new EventBus(),
  );
  const address = server.httpServer.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await server.close();
});

describe('server: health + Loop Controls HTTP endpoint', () => {
  it('GET /health menyertakan snapshot kontrol', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; control: { haltedAll: boolean } };
    expect(body.ok).toBe(true);
    expect(body.control.haltedAll).toBe(false);
  });

  it('POST /control/halt → GRAPH LOCKED di snapshot, /control/resume membukanya kembali', async () => {
    const halt = await fetch(`${base}/control/halt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(halt.status).toBe(200);
    const halted = (await halt.json()) as { control: { haltedAll: boolean } };
    expect(halted.control.haltedAll).toBe(true);

    const resume = await fetch(`${base}/control/resume`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const resumed = (await resume.json()) as { control: { haltedAll: boolean; runIds: string[] } };
    expect(resumed.control.haltedAll).toBe(false);
    expect(resumed.control.runIds).toEqual([]);
  });

  it('POST /control/halt dengan runId spesifik hanya mengunci run itu', async () => {
    const halt = await fetch(`${base}/control/halt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'run_targeted' }),
    });
    const body = (await halt.json()) as { control: { haltedAll: boolean; runIds: string[] } };
    expect(body.control.haltedAll).toBe(false);
    expect(body.control.runIds).toEqual(['run_targeted']);
    expect(server.control.isHalted('run_targeted')).toBe(true);
    expect(server.control.isHalted('run_other')).toBe(false);

    await fetch(`${base}/control/resume`, { method: 'POST', body: JSON.stringify({}) });
    expect(server.control.isHalted('run_targeted')).toBe(false);
  });

  it('endpoint tak dikenal → 404', async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });
});
