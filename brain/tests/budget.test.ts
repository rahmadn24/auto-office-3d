import type { AddressInfo } from 'node:net';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';

import { loadConfig } from '../src/config';
import { RunStore } from '../src/durability/store';
import { EventBus } from '../src/events';
import { startSocketServer, type BrainServer } from '../src/server/socket';
import {
  assertDailyBudget,
  DailyBudgetExceededError,
  dailyBudgetStatus,
  nextLocalMidnight,
  readDailyBudget,
  startOfLocalDay,
} from '../src/telemetry/dailyBudget';

/**
 * Budget token harian lintas-run (Fase 13 — 13.2): status di /health &
 * Theater, plus penolakan run baru dengan pesan jelas saat budget habis.
 */

describe('dailyBudget: status & reset tengah malam', () => {
  it('status: used/remaining/exhausted + reset tengah malam lokal berikutnya', () => {
    const now = new Date(2026, 0, 15, 14, 30, 0);
    const status = dailyBudgetStatus(1000, 250, now);
    expect(status).toEqual({
      limit: 1000,
      used: 250,
      remaining: 750,
      exhausted: false,
      enabled: true,
      resetsAt: new Date(2026, 0, 16, 0, 0, 0).toISOString(),
    });

    const full = dailyBudgetStatus(1000, 1000, now);
    expect(full.exhausted).toBe(true);
    expect(full.remaining).toBe(0);

    expect(startOfLocalDay(now).getHours()).toBe(0);
    expect(nextLocalMidnight(now).getDate()).toBe(16);
  });

  it('limit 0 = nonaktif: tidak pernah exhausted & remaining 0', () => {
    const status = dailyBudgetStatus(0, 999, new Date());
    expect(status.enabled).toBe(false);
    expect(status.exhausted).toBe(false);
    expect(status.remaining).toBe(0);
    expect(() => assertDailyBudget(undefined, 0)).not.toThrow();
  });

  it('readDailyBudget: hanya run yang selesai HARI INI yang dihitung', () => {
    const db = new Database(':memory:');
    const store = new RunStore(db);
    store.startRun({ runId: 'run_kemarin', directive: 'a' });
    store.finishRun('run_kemarin', { status: 'completed', tokensUsed: 900_000 });
    // Geser updated_at ke kemarin — run lama tidak boleh ikut terhitung.
    db.prepare('UPDATE runs SET updated_at = ? WHERE run_id = ?').run(
      new Date(Date.now() - 26 * 3600_000).toISOString(),
      'run_kemarin',
    );
    store.startRun({ runId: 'run_hari_ini', directive: 'b' });
    store.finishRun('run_hari_ini', { status: 'completed', tokensUsed: 120 });

    const status = readDailyBudget(store, 1000);
    expect(status.used).toBe(120);
    expect(status.remaining).toBe(880);
    expect(status.exhausted).toBe(false);
    db.close();
  });

  it('assertDailyBudget: habis → DailyBudgetExceededError dengan pesan jelas', () => {
    const db = new Database(':memory:');
    const store = new RunStore(db);
    store.startRun({ runId: 'run_boros', directive: 'x' });
    store.finishRun('run_boros', { status: 'completed', tokensUsed: 500 });

    expect(() => assertDailyBudget(store, 500)).toThrow(DailyBudgetExceededError);
    expect(() => assertDailyBudget(store, 500)).toThrow(/DAILY BUDGET/);
    expect(() => assertDailyBudget(store, 500)).toThrow(/reset/);
    // Masih di bawah batas → hijau.
    expect(assertDailyBudget(store, 501).remaining).toBe(1);
    db.close();
  });
});

describe('dailyBudget: integrasi socket (run ditolak + budget:update)', () => {
  let server: BrainServer | null = null;
  const clients: ClientSocket[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) client.disconnect();
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('founder:directive saat budget habis → ack ok:false + broadcast exhausted', async () => {
    const db = new Database(':memory:');
    const store = new RunStore(db);
    store.startRun({ runId: 'run_boros', directive: 'x' });
    store.finishRun('run_boros', { status: 'completed', tokensUsed: 500 });

    server = await startSocketServer(
      { ...loadConfig(), port: 0, socketPath: '/brain-budget-test', dailyTokenBudget: 500 },
      new EventBus(),
      { store },
    );
    const addr = server.httpServer.address() as AddressInfo;
    const client = connectClient(`http://127.0.0.1:${addr.port}`, {
      path: '/brain-budget-test',
      transports: ['websocket'],
      forceNew: true,
    });
    clients.push(client);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('connect timeout')), 4000);
      client.on('connect', () => {
        clearTimeout(timer);
        resolve();
      });
    });

    const budgetEvent = new Promise<{ exhausted: boolean; used: number; limit: number }>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('budget:update timeout')), 4000);
        client.on('budget:update', (raw: unknown) => {
          clearTimeout(timer);
          resolve(raw as { exhausted: boolean; used: number; limit: number });
        });
      },
    );

    const ack = await new Promise<{ ok: boolean; error?: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ack timeout')), 4000);
      client.emit('founder:directive', 'bangun invoice generator', (result: unknown) => {
        clearTimeout(timer);
        resolve(result as { ok: boolean; error?: string });
      });
    });

    expect(ack.ok).toBe(false);
    expect(ack.error).toMatch(/DAILY BUDGET/);
    expect(ack.error).toMatch(/500/);

    const budget = await budgetEvent;
    expect(budget.exhausted).toBe(true);
    expect(budget.used).toBe(500);
    expect(budget.limit).toBe(500);
    db.close();
  });

  it('GET /health menyertakan budget harian (Fase 13)', async () => {
    server = await startSocketServer(
      { ...loadConfig(), port: 0, socketPath: '/brain-budget-health' },
      new EventBus(),
    );
    const addr = server.httpServer.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${addr.port}/health`);
    const body = (await res.json()) as {
      budget: { limit: number; used: number; enabled: boolean; exhausted: boolean } | null;
    };
    expect(res.status).toBe(200);
    expect(body.budget).not.toBeNull();
    expect(body.budget!.enabled).toBe(true);
    expect(body.budget!.limit).toBe(2_000_000);
    expect(body.budget!.exhausted).toBe(false);
  });
});
