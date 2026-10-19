import { beforeEach, describe, expect, it } from 'vitest';

import type { ChatTurnPayload } from '../lib/events';
import { newConversationId, useBriefing } from '../store/briefingStore';

/**
 * Fase 8 — store Briefing Room: optimistic human turn, typing indicator,
 * dedupe pm:reply (broadcast + reconnect history), state GO.
 */

const agentTurn = (over: Partial<ChatTurnPayload> = {}): ChatTurnPayload => ({
  conversationId: 'c1',
  channel: 'briefing',
  role: 'agent',
  agentId: 'pm_agent',
  message: 'Noted — siapa audience utamanya?',
  timestamp: '2026-01-01T00:00:01.000Z',
  ...over,
});

beforeEach(() => {
  useBriefing.getState().reset();
  useBriefing.getState().setConversationId('c1');
});

describe('briefingStore — thread chat Founder↔PM (Fase 8)', () => {
  it('pushHuman mencatat pesan founder (optimistic) + menyalakan typing', () => {
    const turn = useBriefing.getState().pushHuman('bangun invoice generator');
    const s = useBriefing.getState();

    expect(turn.role).toBe('human');
    expect(turn.conversationId).toBe('c1');
    expect(turn.channel).toBe('briefing');
    expect(s.turns).toHaveLength(1);
    expect(s.typing).toBe(true);
    expect(s.lastError).toBeNull();
  });

  it('applyReply menambahkan balasan PM + mematikan typing; duplikat diabaikan', () => {
    useBriefing.getState().pushHuman('halo PM');
    const reply = agentTurn();

    useBriefing.getState().applyReply(reply);
    let s = useBriefing.getState();
    expect(s.turns).toHaveLength(2);
    expect(s.typing).toBe(false);
    expect(s.turns[1]?.agentId).toBe('pm_agent');

    // Event ganda (reconnect / broadcast ulang) tidak menduplikasi bubble.
    useBriefing.getState().applyReply(reply);
    s = useBriefing.getState();
    expect(s.turns).toHaveLength(2);
  });

  it('applyReply percakapan lain diabaikan (typing tak berubah)', () => {
    useBriefing.getState().pushHuman('pesan thread ini');
    useBriefing.getState().applyReply(agentTurn({ conversationId: 'lain' }));
    const s = useBriefing.getState();
    expect(s.turns).toHaveLength(1);
    expect(s.typing).toBe(true);
  });

  it('hydrate menggabungkan riwayat durable — dedupe + urut timestamp', () => {
    const human: ChatTurnPayload = {
      conversationId: 'c1',
      channel: 'briefing',
      role: 'human',
      message: 'pesan lama',
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    useBriefing.getState().hydrate([agentTurn(), human]);
    let s = useBriefing.getState();
    expect(s.turns.map((t) => t.role)).toEqual(['human', 'agent']);

    // Hydrate ulang (reconnect) tidak menggandakan.
    useBriefing.getState().hydrate([human, agentTurn()]);
    s = useBriefing.getState();
    expect(s.turns).toHaveLength(2);
  });

  it('state GO: compile → brief → runStart; reset membersihkan', () => {
    const s = useBriefing.getState();
    s.setCompiling(true);
    expect(useBriefing.getState().compiling).toBe(true);

    s.setBrief({
      conversationId: 'c1',
      projectName: 'Invoice Engine',
      audience: 'freelancers',
      features: ['invoice'],
      preset: 'saas-fullstack',
      pricing: '$19/mo',
      summary: 'ringkasan',
      directive: 'bangun…',
      timestamp: '2026-01-01T00:00:05.000Z',
    });
    s.setCompiling(false);
    s.setRunStart({ ok: true });
    expect(useBriefing.getState().brief?.projectName).toBe('Invoice Engine');
    expect(useBriefing.getState().runStart?.ok).toBe(true);

    useBriefing.getState().reset();
    const after = useBriefing.getState();
    expect(after.turns).toHaveLength(0);
    expect(after.brief).toBeNull();
    expect(after.runStart).toBeNull();
    expect(after.compiling).toBe(false);
  });

  it('newConversationId unik antar pemanggilan', () => {
    const ids = new Set([newConversationId(), newConversationId(), newConversationId()]);
    expect(ids.size).toBe(3);
  });
});
