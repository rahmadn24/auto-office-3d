import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';

import { loadConfig } from '../src/config';
import { EventBus } from '../src/events';
import { isAuthorizedHandshake, isAuthorizedHeader } from '../src/server/auth';
import { startSocketServer, type BrainServer } from '../src/server/socket';

/**
 * Auth token (Fase 12 — kartu 12.2): unit helper + integrasi socket/HTTP.
 * Koneksi tanpa token tetap boleh masuk tapi hanya kanal widget; aksi
 * operator (kontrol/founder/CS) ditolak `unauthorized`.
 */

const TOKEN = 'token-rahasia';

describe('auth: helper header & handshake', () => {
  it('token kosong → semua lolos (dev lokal)', () => {
    expect(isAuthorizedHeader(undefined, undefined)).toBe(true);
    expect(isAuthorizedHandshake({}, undefined)).toBe(true);
  });

  it('header Authorization: Bearer / Basic / mentah', () => {
    expect(isAuthorizedHeader(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(
      isAuthorizedHeader(`Basic ${Buffer.from(`founder:${TOKEN}`).toString('base64')}`, TOKEN),
    ).toBe(true);
    expect(isAuthorizedHeader(TOKEN, TOKEN)).toBe(true);
    expect(isAuthorizedHeader('Bearer salah', TOKEN)).toBe(false);
    expect(
      isAuthorizedHeader('Basic ' + Buffer.from('founder:salah').toString('base64'), TOKEN),
    ).toBe(false);
    expect(isAuthorizedHeader(undefined, TOKEN)).toBe(false);
    // Header array (node http) memakai elemen pertama.
    expect(isAuthorizedHeader([`Bearer ${TOKEN}`], TOKEN)).toBe(true);
  });

  it('handshake socket: auth.token atau header proxy', () => {
    expect(isAuthorizedHandshake({ auth: { token: TOKEN } }, TOKEN)).toBe(true);
    expect(isAuthorizedHandshake({ auth: { token: 'x' } }, TOKEN)).toBe(false);
    expect(isAuthorizedHandshake({ headers: { authorization: `Bearer ${TOKEN}` } }, TOKEN)).toBe(
      true,
    );
    expect(isAuthorizedHandshake({ auth: { token: 42 } }, TOKEN)).toBe(false);
  });
});

describe('auth: integrasi server (BRAIN_AUTH_TOKEN terpasang)', () => {
  let server: BrainServer | null = null;
  const clients: ClientSocket[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) client.disconnect();
    if (server) {
      await server.close();
      server = null;
    }
  });

  async function boot(): Promise<string> {
    server = await startSocketServer(
      { ...loadConfig(), port: 0, socketPath: '/brain-auth-test', authToken: TOKEN },
      new EventBus(),
    );
    const addr = server.httpServer.address() as AddressInfo;
    return `http://127.0.0.1:${addr.port}`;
  }

  function connect(url: string, auth?: Record<string, unknown>): ClientSocket {
    const client = connectClient(url, {
      path: '/brain-auth-test',
      transports: ['websocket'],
      forceNew: true,
      ...(auth ? { auth } : {}),
    });
    clients.push(client);
    return client;
  }

  function emitAck<T>(client: ClientSocket, event: string, payload?: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout ${event}`)), 4000);
      const cb = (result: T) => {
        clearTimeout(timer);
        resolve(result);
      };
      if (payload === undefined) client.emit(event, cb);
      else client.emit(event, payload, cb);
    });
  }

  it('socket tanpa token → aksi operator ditolak, koneksi tetap hidup', async () => {
    const base = await boot();
    const anon = connect(base);
    await new Promise<void>((resolve) => anon.on('connect', () => resolve()));

    const denied = await emitAck<{ ok: boolean; error?: string }>(anon, 'state:request');
    expect(denied.ok).toBe(false);
    expect(denied.error).toContain('unauthorized');

    const halt = await emitAck<{ ok: boolean }>(anon, 'control:halt', {});
    expect(halt.ok).toBe(false);

    const quote = await emitAck<{ ok: boolean }>(anon, 'cs:quote', { leadId: 'x' });
    expect(quote.ok).toBe(false);

    // Kanal publik widget tetap boleh (tanpa cs service → error berbeda, bukan auth).
    const widget = await emitAck<{ ok: boolean; error?: string }>(anon, 'cs:widget_message', {
      visitorId: 'v1',
      message: 'hai',
    });
    expect(widget.error ?? '').not.toContain('unauthorized');
  });

  it('socket + auth.token → aksi operator lolos', async () => {
    const base = await boot();
    const authed = connect(base, { token: TOKEN });
    await new Promise<void>((resolve) => authed.on('connect', () => resolve()));

    const snapshot = await emitAck<{ ok?: boolean; snapshot?: { generatedAt?: string } }>(
      authed,
      'state:request',
    );
    expect(snapshot.snapshot?.generatedAt).toBeTruthy();

    const halt = await emitAck<{ ok: boolean; control?: { haltedAll: boolean } }>(
      authed,
      'control:halt',
      {},
    );
    expect(halt.ok).toBe(true);
    expect(halt.control?.haltedAll).toBe(true);
  });

  it('HTTP /control/* tanpa token → 401; dengan Bearer → 200', async () => {
    const base = await boot();

    const anon = await fetch(`${base}/control/halt`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    expect(anon.status).toBe(401);
    const body = (await anon.json()) as { error: string };
    expect(body.error).toContain('unauthorized');

    const authed = await fetch(`${base}/control/halt`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({}),
    });
    expect(authed.status).toBe(200);

    // /health tetap publik (dipakai health check VPS).
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
  });
});
