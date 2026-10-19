import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';

import { BriefingService } from '../src/briefing';
import { loadConfig } from '../src/config';
import { EventBus } from '../src/events';
import { StubLLM } from '../src/llm/stub';
import { HashEmbedder } from '../src/memory/embeddings';
import { InMemoryVectorStore } from '../src/memory/inMemory';
import { parseBrief, parseChatTurn } from '../src/server/contract';
import { startSocketServer, type BrainServer } from '../src/server/socket';
import type { ArtifactsPayload, ChatTurnPayload, FirstSalePayload } from '../src/types';

/**
 * Fase 8 — E2E singkat (stub LLM, offline):
 * diskusi Founder↔PM via `founder:chat` → `pm:reply` → GO (`brief:compile`)
 * → `founder:directive` → run otonom penuh sampai milestone first sale.
 */

let server: BrainServer;
let base: string;
let client: ClientSocket;

function connect(url: string, path: string): Promise<ClientSocket> {
  return new Promise((resolve) => {
    const c = connectClient(url, { path, transports: ['websocket'], reconnection: false });
    c.on('connect', () => resolve(c));
  });
}

beforeAll(async () => {
  // MEMORY_DRIVER=memory → run dari socket tidak menyentuh disk DATA_DIR.
  const config = { ...loadConfig({ MEMORY_DRIVER: 'memory' }), port: 0, socketPath: '/brain-f8' };
  const memory = new InMemoryVectorStore(new HashEmbedder());
  const briefing = new BriefingService({ memory, llm: new StubLLM() });
  server = await startSocketServer(config, new EventBus(), { memory, briefing });
  const address = server.httpServer.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
  client = await connect(base, '/brain-f8');
});

afterAll(async () => {
  client?.close();
  await server?.close();
});

describe('Briefing Room via socket (Fase 8 — PRD §5.3)', () => {
  let agentTurn: ChatTurnPayload;

  it('founder:chat → ack queued + pm:reply sesuai kontrak ChatTurnPayload', async () => {
    const reply = new Promise<unknown>((resolve) => client.once('pm:reply', resolve));
    const ack = await new Promise<{ ok: boolean }>((resolve) => {
      client.emit(
        'founder:chat',
        { conversationId: 'conv_f8', message: 'bangun SaaS invoice generator untuk agensi' },
        resolve,
      );
    });
    expect(ack.ok).toBe(true);

    const parsed = parseChatTurn(await reply);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    agentTurn = parsed.payload;
    expect(agentTurn.conversationId).toBe('conv_f8');
    expect(agentTurn.channel).toBe('briefing');
    expect(agentTurn.role).toBe('agent');
    expect(agentTurn.agentId).toBe('pm_agent');
    expect(agentTurn.message.length).toBeGreaterThan(0);
  });

  it('briefing:history mengembalikan thread durable (human + agent)', async () => {
    const ack = await new Promise<{ ok: boolean; turns: ChatTurnPayload[] }>((resolve) => {
      client.emit('briefing:history', { conversationId: 'conv_f8' }, resolve);
    });
    expect(ack.ok).toBe(true);
    expect(ack.turns.map((t) => t.role)).toEqual(['human', 'agent']);
    expect(ack.turns[1]?.message).toBe(agentTurn.message);
  });

  it('founder:chat tanpa message → nack (error handling konsisten)', async () => {
    const ack = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      client.emit('founder:chat', { conversationId: 'conv_f8', message: '' }, resolve);
    });
    expect(ack.ok).toBe(false);
    expect(ack.error).toBeTruthy();
  });

  it('GO: brief:compile → brief valid → founder:directive → run penuh sampai milestone', async () => {
    const compileAck = await new Promise<{ ok: boolean; brief?: unknown }>((resolve) => {
      client.emit('brief:compile', { conversationId: 'conv_f8' }, resolve);
    });
    expect(compileAck.ok).toBe(true);
    const brief = parseBrief(compileAck.brief);
    expect(brief.ok).toBe(true);
    if (!brief.ok) return;
    expect(brief.payload.directive).toContain('[Brief Ringkas');

    // GO handoff: brief.directive dikirim sebagai founder:directive (kartu 8.4).
    const artifacts = new Promise<ArtifactsPayload>((resolve) =>
      client.once('artifacts:ready', resolve),
    );
    const ack = await new Promise<{ ok: boolean; queued?: boolean }>((resolve) => {
      client.emit('founder:directive', brief.payload.directive, resolve);
    });
    expect(ack.ok).toBe(true);
    expect(ack.queued).toBe(true);

    const bundle = await artifacts;
    expect(bundle.qaPassed).toBe(true);
    expect(bundle.files.length).toBeGreaterThan(0);
    expect(bundle.prd).toContain('Executive Summary');

    // Milestone #5 — transaksi pertama setelah produk live.
    const milestone = new Promise<FirstSalePayload>((resolve) =>
      client.once('milestone:first_sale', resolve),
    );
    client.emit('stripe:simulate', { runId: bundle.runId });
    const sale = await milestone;
    expect(sale.amount).toBe(29);
    expect(sale.hasCustomers).toBe(true);
  }, 120_000);
});
