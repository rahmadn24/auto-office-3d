import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config';
import { EventBus } from '../src/events';
import { startSocketServer, type BrainServer } from '../src/server/socket';

/**
 * Hardening HTTP (Fase 13 — 13.6): batas ukuran body webhook + allowlist CORS.
 */

describe('hardening: body limit & CORS (Fase 13)', () => {
  let server: BrainServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  async function boot(overrides: Record<string, unknown>): Promise<string> {
    server = await startSocketServer(
      {
        ...loadConfig(),
        port: 0,
        socketPath: '/brain-hardening-test',
        ...overrides,
      },
      new EventBus(),
    );
    const addr = server.httpServer.address() as AddressInfo;
    return `http://127.0.0.1:${addr.port}`;
  }

  it('body webhook melebihi limit → 413 dengan pesan jelas (bukan crash)', async () => {
    const base = await boot({ webhookMaxBodyBytes: 64 });
    const res = await fetch(`${base}/webhook/stub`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(200) }),
    });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/terlalu besar/);
  });

  it('payload normal di bawah limit tidak ditolak 413 (body terbaca)', async () => {
    const base = await boot({ webhookMaxBodyBytes: 4096 });
    const res = await fetch(`${base}/webhook/stub`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order_id: 'stub_tidak_ada' }),
    });
    // Driver stub menjawab 200 (duplikat/tidak ada sale) — yang penting bukan 413.
    expect(res.status).not.toBe(413);
    expect(res.status).toBeLessThan(500);
  });

  it('preflight OPTIONS → 204 + header CORS; origin diizinkan ter-echo', async () => {
    const base = await boot({ corsOrigins: ['https://office.example'] });
    const preflight = await fetch(`${base}/health`, {
      method: 'OPTIONS',
      headers: { origin: 'https://office.example' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://office.example');
    expect(preflight.headers.get('access-control-allow-headers')).toMatch(/authorization/);

    const denied = await fetch(`${base}/health`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    });
    expect(denied.status).toBe(204);
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('default lokal: semua origin diizinkan (`*`, CORS_ORIGINS kosong)', async () => {
    const base = await boot({});
    const res = await fetch(`${base}/health`, { headers: { origin: 'http://localhost:3001' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
