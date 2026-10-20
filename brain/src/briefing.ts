import { heuristicBriefDraft, parseBriefDraft, type LLMProvider } from './llm/provider';
import type { MemoryProvider, MemoryRecord } from './memory/provider';
import { guessProjectName } from './run';
import type { BriefPayload, ChatAgentId, ChatChannel, ChatTurnPayload } from './types';

/**
 * BRIEFING ROOM (Fase 8 — PRD §3.1, §5.3).
 *
 * Kanal percakapan multi-turn Founder↔PM sebelum run otonom:
 *   1. setiap turn di-upsert ke namespace vector `briefing` (durable, LanceDB)
 *      → percakapan selamat dari restart daemon;
 *   2. PM membalas via LLM task `briefing` dengan recall briefing + pm-memory
 *      (citations ikut dikirim di `pm:reply`);
 *   3. saat GO, thread dikompilasi jadi brief terstruktur (task `brief`) dan
 *      brief ditulis ke `pm-memory` → ikut ter-recall di node PM run otonom.
 */

/** Batas panjang pesan (UI juga membatasi 500) — jaga konteks tetap ringkas. */
export const MAX_CHAT_MESSAGE = 500;
/** Berapa turn terakhir yang dikirim ke LLM sebagai konteks. */
const THREAD_CONTEXT_TURNS = 12;
/** Batas record thread yang dipulihkan dari vector memory. */
const THREAD_LIST_LIMIT = 500;

export interface BriefingServiceOptions {
  memory: MemoryProvider;
  llm: LLMProvider;
}

interface Thread {
  turns: ChatTurnPayload[];
  /** Seq terakhir yang dipakai (human: ganjil, agent: genap). */
  seq: number;
}

/** `chat:<conversationId>:<seq 6 digit>` — id record di namespace briefing. */
function turnId(conversationId: string, seq: number): string {
  return `chat:${conversationId}:${String(seq).padStart(6, '0')}`;
}

/** Rekonstruksi ChatTurnPayload dari record vector memory (sebaliknya dari persist). */
function turnFromRecord(record: MemoryRecord): ChatTurnPayload | null {
  const meta = record.metadata ?? {};
  const role = meta.role;
  if (role !== 'human' && role !== 'agent') return null;
  if (typeof meta.conversationId !== 'string' || typeof meta.timestamp !== 'string') return null;

  const channel: ChatChannel =
    meta.channel === 'cs_widget' || meta.channel === 'cs_whatsapp' || meta.channel === 'cs_email'
      ? meta.channel
      : 'briefing';
  const agentId: ChatAgentId | undefined =
    meta.agentId === 'pm_agent' || meta.agentId === 'cs_agent' ? meta.agentId : undefined;

  let citations: string[] | undefined;
  if (typeof meta.citations === 'string') {
    try {
      const parsed: unknown = JSON.parse(meta.citations);
      if (Array.isArray(parsed)) {
        citations = parsed.filter((c): c is string => typeof c === 'string');
      }
    } catch {
      citations = undefined;
    }
  }

  const turn: ChatTurnPayload = {
    conversationId: meta.conversationId,
    channel,
    role,
    message: record.text,
    timestamp: meta.timestamp,
  };
  if (agentId) turn.agentId = agentId;
  if (citations && citations.length > 0) turn.citations = citations;
  return turn;
}

/** Transkrip "Founder: … / PM: …" untuk konteks LLM. */
function formatTranscript(turns: ChatTurnPayload[], contextTurns = THREAD_CONTEXT_TURNS): string {
  return turns
    .slice(-contextTurns)
    .map((t) => `${t.role === 'human' ? 'Founder' : 'PM'}: ${t.message}`)
    .join('\n');
}

export class BriefingService {
  /** Cache in-process — akses cepat + fallback bila driver tak punya `list`. */
  private readonly threads = new Map<string, Thread>();

  constructor(private readonly options: BriefingServiceOptions) {}

  /**
   * Riwayat kronologis satu percakapan — dari cache, atau dipulihkan dari
   * vector memory (namespace `briefing`) sehingga selamat restart.
   */
  async history(conversationId: string): Promise<ChatTurnPayload[]> {
    const cached = this.threads.get(conversationId);
    if (cached) return [...cached.turns];

    const turns: ChatTurnPayload[] = [];
    let maxSeq = 0;
    const list = this.options.memory.list;
    if (list) {
      const records = await list
        .call(this.options.memory, 'briefing', {
          where: { conversationId },
          limit: THREAD_LIST_LIMIT,
        })
        .catch(() => [] as MemoryRecord[]);
      for (const record of records) {
        const turn = turnFromRecord(record);
        if (!turn) continue;
        const seq = typeof record.metadata?.seq === 'number' ? record.metadata.seq : 0;
        maxSeq = Math.max(maxSeq, seq);
        turns.push(turn);
      }
    }
    this.threads.set(conversationId, { turns, seq: maxSeq });
    return [...turns];
  }

  /** Satu turn founder: persist → recall briefing+pm-memory → balasan PM → persist. */
  async handleTurn(input: { conversationId: string; message: string }): Promise<ChatTurnPayload> {
    const conversationId = input.conversationId.trim();
    const message = input.message.trim().slice(0, MAX_CHAT_MESSAGE);
    if (!conversationId) throw new Error('conversationId required');
    if (!message) throw new Error('message required');

    const before = await this.history(conversationId);
    const humanSeq = this.nextSeq(conversationId);
    const human: ChatTurnPayload = {
      conversationId,
      channel: 'briefing',
      role: 'human',
      message,
      timestamp: new Date().toISOString(),
    };
    await this.persist(conversationId, humanSeq, human);

    // Recall dua namespace (PRD §3.1): transkrip briefing + ingatan lintas run pm-memory.
    const [briefHits, pmHits] = await Promise.all([
      this.options.memory.search('briefing', message, 4).catch(() => []),
      this.options.memory.search('pm-memory', message, 3).catch(() => []),
    ]);
    const citations = [...pmHits, ...briefHits]
      .filter((hit) => hit.id !== turnId(conversationId, humanSeq))
      .slice(0, 5)
      .map((hit) => `${hit.namespace}[${hit.id}]: ${hit.text.slice(0, 140)}`);

    const founderMessages = [...before, human]
      .filter((t) => t.role === 'human')
      .map((t) => t.message);
    const result = await this.options.llm.complete({
      task: 'briefing',
      prompt: message,
      context: {
        projectName: guessProjectName(founderMessages.join(' ') || message),
        retrieved: citations,
        thread: formatTranscript(before),
      },
    });

    const agentSeq = this.nextSeq(conversationId);
    const agent: ChatTurnPayload = {
      conversationId,
      channel: 'briefing',
      role: 'agent',
      agentId: 'pm_agent',
      message: result.text.trim(),
      timestamp: new Date().toISOString(),
    };
    if (citations.length > 0) agent.citations = citations;
    await this.persist(conversationId, agentSeq, agent);
    return agent;
  }

  /**
   * GO (kartu 8.4) — kompilasi thread jadi brief terstruktur (audience, fitur,
   * preset, harga), tulis ke `pm-memory`, dan kembalikan payload berisi
   * `directive` siap dikirim sebagai `founder:directive`.
   */
  async compile(conversationId: string): Promise<BriefPayload> {
    const turns = await this.history(conversationId);
    const humanMessages = turns.filter((t) => t.role === 'human').map((t) => t.message);
    if (humanMessages.length === 0) throw new Error('thread kosong — ajak PM berdiskusi dulu');

    const transcript = formatTranscript(turns);
    const projectName = guessProjectName(humanMessages.join(' '));
    const result = await this.options.llm.complete({
      task: 'brief',
      prompt: transcript,
      context: { projectName },
    });
    const draft = parseBriefDraft(result.text) ?? heuristicBriefDraft(transcript);

    const directive = [
      // Kalimat founder harus jadi leading context: PM node memakainya untuk
      // nama produk/PRD. Ringkasan boilerplate ("Brief dari diskusi …") ditaruh
      // di blok metadata di bawah agar tidak ikut menjadi projectName.
      humanMessages.join(' | ').slice(0, 600),
      '',
      '[Brief Ringkas — hasil Briefing Room]',
      `- Ringkasan: ${draft.summary}`,
      `- Audience: ${draft.audience}`,
      `- Fitur wajib: ${draft.features.join('; ')}`,
      `- Preset stack: ${draft.preset}`,
      `- Model harga: ${draft.pricing}`,
      '',
      `Konteks diskusi: ${humanMessages.join(' | ').slice(0, 400)}`,
      'Bangun produk ini end-to-end hingga siap menerima pembayaran pertama.',
    ].join('\n');

    const brief: BriefPayload = {
      conversationId,
      projectName,
      audience: draft.audience,
      features: draft.features,
      preset: draft.preset,
      pricing: draft.pricing,
      summary: draft.summary,
      directive,
      timestamp: new Date().toISOString(),
    };

    // Briefing menjadi bagian dari pm-memory (PRD §3.1) → ikut ter-recall di node PM.
    await this.options.memory.upsert('pm-memory', [
      {
        id: `brief:${conversationId}`,
        text: `Brief ${projectName}: audience=${draft.audience}; features=${draft.features.join(', ')}; preset=${draft.preset}; pricing=${draft.pricing}. ${draft.summary}`,
        metadata: { kind: 'brief', conversationId, preset: draft.preset },
      },
    ]);

    return brief;
  }

  private nextSeq(conversationId: string): number {
    return (this.threads.get(conversationId)?.seq ?? 0) + 1;
  }

  private async persist(conversationId: string, seq: number, turn: ChatTurnPayload): Promise<void> {
    const thread = this.threads.get(conversationId) ?? { turns: [], seq: 0 };
    thread.turns.push(turn);
    thread.seq = Math.max(thread.seq, seq);
    this.threads.set(conversationId, thread);

    const metadata: Record<string, string | number | boolean> = {
      conversationId,
      channel: turn.channel,
      role: turn.role,
      seq,
      timestamp: turn.timestamp,
    };
    if (turn.agentId) metadata.agentId = turn.agentId;
    if (turn.citations && turn.citations.length > 0) {
      metadata.citations = JSON.stringify(turn.citations);
    }
    await this.options.memory.upsert('briefing', [
      { id: turnId(conversationId, seq), text: turn.message, metadata },
    ]);
  }
}
