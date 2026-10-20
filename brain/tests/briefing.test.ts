import { describe, expect, it } from 'vitest';

import { BriefingService } from '../src/briefing';
import { StubLLM } from '../src/llm/stub';
import { HashEmbedder } from '../src/memory/embeddings';
import { InMemoryVectorStore } from '../src/memory/inMemory';

/**
 * Fase 8 — Briefing Room (PRD §3.1, §5.3):
 * chat flow durable + recall + compile brief, semua deterministik via stub LLM.
 */

function makeService(): { service: BriefingService; memory: InMemoryVectorStore } {
  const memory = new InMemoryVectorStore(new HashEmbedder());
  const service = new BriefingService({ memory, llm: new StubLLM() });
  return { service, memory };
}

describe('BriefingService — chat flow & durability (Fase 8)', () => {
  it('handleTurn: balasan PM sesuai kontrak ChatTurnPayload + tersimpan di namespace briefing', async () => {
    const { service, memory } = makeService();
    const agent = await service.handleTurn({
      conversationId: 'c1',
      message: 'bangun invoice generator untuk freelancer',
    });

    expect(agent.conversationId).toBe('c1');
    expect(agent.channel).toBe('briefing');
    expect(agent.role).toBe('agent');
    expect(agent.agentId).toBe('pm_agent');
    expect(agent.message.length).toBeGreaterThan(20);
    expect(new Date(agent.timestamp).getTime()).not.toBeNaN();

    // Turn human + agent durable di vector memory (AC: namespace briefing).
    const sizes = await memory.sizes();
    expect(sizes['briefing']).toBe(2);

    const turns = await service.history('c1');
    expect(turns.map((t) => t.role)).toEqual(['human', 'agent']);
    expect(turns[0]?.message).toContain('invoice generator');
  });

  it('turn kedua: citations recall dari briefing + pm-memory ikut menempel di balasan', async () => {
    const { service, memory } = makeService();
    await memory.upsert('pm-memory', [
      { id: 'seed:x', text: 'Stripe checkout idempotent handler dengan billing cycle decrement' },
    ]);

    await service.handleTurn({ conversationId: 'c1', message: 'fitur checkout stripe dong' });
    const second = await service.handleTurn({
      conversationId: 'c1',
      message: 'tambahkan invoice pdf export',
    });

    expect(second.citations && second.citations.length).toBeGreaterThan(0);
    expect(
      second.citations?.some((c) => c.startsWith('briefing[') || c.startsWith('pm-memory[')),
    ).toBe(true);
  });

  it('durable: instance baru (simulasi restart daemon) memulihkan thread dari vector memory', async () => {
    const { service, memory } = makeService();
    await service.handleTurn({ conversationId: 'c9', message: 'produk pertama: kasir untuk UMKM' });

    const restarted = new BriefingService({ memory, llm: new StubLLM() });
    const turns = await restarted.history('c9');
    expect(turns.length).toBe(2);
    expect(turns[0]?.message).toContain('kasir untuk UMKM');
    expect(turns[1]?.role).toBe('agent');

    // Lanjut percakapan setelah "restart" → seq tidak bentrok, thread utuh.
    await restarted.handleTurn({ conversationId: 'c9', message: 'lanjut, fokus pembukuan' });
    const all = await restarted.history('c9');
    expect(all.length).toBe(4);
    expect(new Set(all.map((t) => `${t.role}|${t.message}`)).size).toBe(4);
  });

  it('percakapan terisolasi per conversationId', async () => {
    const { service } = makeService();
    await service.handleTurn({ conversationId: 'a', message: 'proyek A: invoice generator' });
    await service.handleTurn({ conversationId: 'b', message: 'proyek B: kasir warung' });

    const a = await service.history('a');
    const b = await service.history('b');
    expect(a.every((t) => t.conversationId === 'a')).toBe(true);
    expect(b.every((t) => t.conversationId === 'b')).toBe(true);
    expect(a.length).toBe(2);
    expect(b.length).toBe(2);
  });

  it('compile (GO): brief terstruktur + directive siap founder:directive + masuk pm-memory', async () => {
    const { service, memory } = makeService();
    await service.handleTurn({
      conversationId: 'go',
      message: 'bangun SaaS invoice untuk agensi dengan checkout stripe, harga $19/mo',
    });

    const brief = await service.compile('go');
    expect(['landing', 'saas-fullstack', 'custom-app']).toContain(brief.preset);
    expect(brief.features.length).toBeGreaterThan(0);
    expect(brief.features.every((f) => f.length > 0)).toBe(true);
    expect(brief.directive).toContain('[Brief Ringkas');
    expect(brief.directive).toContain('Preset stack');
    expect(brief.directive.startsWith('bangun SaaS invoice untuk agensi')).toBe(true);
    expect(brief.pricing).toContain('$19');
    expect(brief.projectName).toBe('SaaS Invoice Agensi');
    expect(brief.projectName).not.toMatch(/brief|diskusi|founder/i);

    const pmHits = await memory.search('pm-memory', 'brief proyek invoice agensi', 5);
    expect(pmHits.some((h) => h.id === 'brief:go')).toBe(true);
  });

  it('compile thread kosong → error (tombol GO di UI bisa disabled)', async () => {
    const { service } = makeService();
    await expect(service.compile('kosong')).rejects.toThrow(/kosong/i);
  });

  it('pesan kosong / conversationId kosong ditolak', async () => {
    const { service } = makeService();
    await expect(service.handleTurn({ conversationId: '', message: 'hai' })).rejects.toThrow(
      /conversationId/,
    );
    await expect(service.handleTurn({ conversationId: 'c1', message: '   ' })).rejects.toThrow(
      /message/,
    );
  });
});
