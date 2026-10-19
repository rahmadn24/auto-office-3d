import type { Database as SqliteDatabase } from 'better-sqlite3';

import type { ChatChannel, ChatTurnPayload, Lead, LeadSource, LeadStatus } from '../types';
import { nowIso } from '../types';

/**
 * LEADS STORE — mini-CRM durable (PRD §3.5, Fase 11).
 *
 * Satu tabel `leads` (skema Lead PRD) + satu tabel `cs_messages` (transkrip
 * percakapan client lintas channel) di `office.db` yang sama dengan run history.
 * Marketer menulis lead saat peminat terdeteksi; CS Agent membacanya untuk
 * follow-up & closing. Vector namespace `leads` diisi di service layer (recall).
 */

export interface CsMessageRecord {
  id: number;
  conversationId: string;
  leadId: string | null;
  channel: ChatChannel;
  role: 'human' | 'agent';
  agent: string | null;
  message: string;
  meta: Record<string, unknown> | null;
  ts: string;
}

interface LeadRow {
  lead_id: string;
  source: LeadSource;
  contact: string;
  name: string;
  interest: string;
  status: LeadStatus;
  conversation_id: string;
  next_followup_at: string | null;
  followups_sent: number;
  quote: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: number;
  conversation_id: string;
  lead_id: string | null;
  channel: string;
  role: string;
  agent: string | null;
  message: string;
  meta: string | null;
  ts: string;
}

/** `cs:<source>:<contact>` — satu percakapan per identitas channel. */
export function conversationIdFor(source: LeadSource, contact: string): string {
  const safe = contact
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@.+_-]/g, '-');
  return `cs:${source}:${safe}`;
}

function toLead(row: LeadRow): Lead {
  let quote: Lead['quote'] = null;
  if (row.quote) {
    try {
      quote = JSON.parse(row.quote) as Lead['quote'];
    } catch {
      quote = null;
    }
  }
  return {
    id: row.lead_id,
    source: row.source,
    contact: row.contact,
    name: row.name,
    interest: row.interest,
    status: row.status,
    conversationId: row.conversation_id,
    nextFollowupAt: row.next_followup_at,
    followupsSent: row.followups_sent,
    quote,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateLeadInput {
  /** Id deterministik (mis. dari Marketer) — idempoten saat diulang. */
  id?: string;
  source: LeadSource;
  contact: string;
  name?: string;
  interest?: string;
  status?: LeadStatus;
  nextFollowupAt?: string | null;
}

export interface AppendMessageInput {
  conversationId: string;
  leadId?: string | null;
  channel: ChatChannel;
  role: 'human' | 'agent';
  agent?: string;
  message: string;
  meta?: Record<string, unknown>;
  ts?: string;
}

export class LeadsStore {
  constructor(private readonly db: SqliteDatabase) {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS leads (
        lead_id          TEXT PRIMARY KEY,
        source           TEXT NOT NULL,
        contact          TEXT NOT NULL,
        name             TEXT NOT NULL DEFAULT '',
        interest         TEXT NOT NULL DEFAULT '',
        status           TEXT NOT NULL DEFAULT 'new',
        conversation_id  TEXT NOT NULL,
        next_followup_at TEXT,
        followups_sent   INTEGER NOT NULL DEFAULT 0,
        quote            TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_conversation ON leads (conversation_id);
      CREATE INDEX IF NOT EXISTS idx_leads_followup ON leads (next_followup_at);
      CREATE TABLE IF NOT EXISTS cs_messages (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id TEXT NOT NULL,
        lead_id         TEXT,
        channel         TEXT NOT NULL,
        role            TEXT NOT NULL,
        agent           TEXT,
        message         TEXT NOT NULL,
        meta            TEXT,
        ts              TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cs_messages_conversation ON cs_messages (conversation_id);
    `);
  }

  /**
   * Catat peminat (idempoten): bila lead dengan id atau conversation id sama
   * sudah ada, baris lama yang dikembalikan (hanya melengkapi name/interest kosong).
   */
  createLead(input: CreateLeadInput): Lead {
    const conversationId = conversationIdFor(input.source, input.contact);
    const existing =
      (input.id ? this.getLead(input.id) : null) ?? this.getLeadByConversation(conversationId);
    if (existing) {
      const name = existing.name || input.name || '';
      const interest = existing.interest || input.interest || '';
      if (name !== existing.name || interest !== existing.interest) {
        this.updateLead(existing.id, { name, interest });
        return this.getLead(existing.id) as Lead;
      }
      return existing;
    }

    const now = nowIso();
    const lead: Lead = {
      id: input.id ?? `lead_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      source: input.source,
      contact: input.contact,
      name: input.name ?? '',
      interest: input.interest ?? '',
      status: input.status ?? 'new',
      conversationId,
      nextFollowupAt: input.nextFollowupAt ?? null,
      followupsSent: 0,
      quote: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO leads (lead_id, source, contact, name, interest, status, conversation_id,
                            next_followup_at, followups_sent, quote, created_at, updated_at)
         VALUES (@id, @source, @contact, @name, @interest, @status, @conversationId,
                 @nextFollowupAt, 0, NULL, @createdAt, @updatedAt)`,
      )
      .run(lead);
    return lead;
  }

  getLead(leadId: string): Lead | null {
    const row = this.db.prepare('SELECT * FROM leads WHERE lead_id = ?').get(leadId) as
      LeadRow | undefined;
    return row ? toLead(row) : null;
  }

  getLeadByConversation(conversationId: string): Lead | null {
    const row = this.db
      .prepare('SELECT * FROM leads WHERE conversation_id = ?')
      .get(conversationId) as LeadRow | undefined;
    return row ? toLead(row) : null;
  }

  /** Lead terbaru dulu (perubahan terakhir) — dipakai CS Inbox. */
  listLeads(limit = 50): Lead[] {
    const rows = this.db
      .prepare('SELECT * FROM leads ORDER BY updated_at DESC LIMIT ?')
      .all(limit) as LeadRow[];
    return rows.map(toLead);
  }

  /** Lead yang masih hidup (belum deal/lost) — kandidat sweep follow-up. */
  openLeads(limit = 50): Lead[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM leads WHERE status IN ('new','contacted','qualified') ORDER BY updated_at ASC LIMIT ?",
      )
      .all(limit) as LeadRow[];
    return rows.map(toLead);
  }

  /** Lead dengan `next_followup_at` terlewat (scheduler sweep, PRD §3.5). */
  dueFollowups(nowIsoStr: string, limit = 20): Lead[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM leads
         WHERE status IN ('new','contacted','qualified')
           AND next_followup_at IS NOT NULL
           AND next_followup_at <= ?
         ORDER BY next_followup_at ASC LIMIT ?`,
      )
      .all(nowIsoStr, limit) as LeadRow[];
    return rows.map(toLead);
  }

  updateLead(
    leadId: string,
    patch: Partial<
      Pick<Lead, 'name' | 'interest' | 'status' | 'nextFollowupAt' | 'quote' | 'followupsSent'>
    >,
  ): Lead | null {
    const current = this.getLead(leadId);
    if (!current) return null;
    const next: Lead = {
      ...current,
      ...patch,
      quote: patch.quote !== undefined ? patch.quote : current.quote,
      updatedAt: nowIso(),
    };
    this.db
      .prepare(
        `UPDATE leads SET name = @name, interest = @interest, status = @status,
           next_followup_at = @nextFollowupAt, followups_sent = @followupsSent,
           quote = @quote, updated_at = @updatedAt
         WHERE lead_id = @id`,
      )
      .run({
        id: next.id,
        name: next.name,
        interest: next.interest,
        status: next.status,
        nextFollowupAt: next.nextFollowupAt,
        followupsSent: next.followupsSent,
        quote: next.quote ? JSON.stringify(next.quote) : null,
        updatedAt: next.updatedAt,
      });
    return next;
  }

  appendMessage(input: AppendMessageInput): CsMessageRecord {
    const ts = input.ts ?? nowIso();
    const info = this.db
      .prepare(
        `INSERT INTO cs_messages (conversation_id, lead_id, channel, role, agent, message, meta, ts)
         VALUES (@conversationId, @leadId, @channel, @role, @agent, @message, @meta, @ts)`,
      )
      .run({
        conversationId: input.conversationId,
        leadId: input.leadId ?? null,
        channel: input.channel,
        role: input.role,
        agent: input.agent ?? null,
        message: input.message,
        meta: input.meta ? JSON.stringify(input.meta) : null,
        ts,
      });
    return {
      id: Number(info.lastInsertRowid),
      conversationId: input.conversationId,
      leadId: input.leadId ?? null,
      channel: input.channel,
      role: input.role,
      agent: input.agent ?? null,
      message: input.message,
      meta: input.meta ?? null,
      ts,
    };
  }

  listMessages(conversationId: string, limit = 200): CsMessageRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM cs_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?')
      .all(conversationId, limit) as MessageRow[];
    return rows.reverse().map((row) => {
      let meta: Record<string, unknown> | null = null;
      if (row.meta) {
        try {
          meta = JSON.parse(row.meta) as Record<string, unknown>;
        } catch {
          meta = null;
        }
      }
      return {
        id: row.id,
        conversationId: row.conversation_id,
        leadId: row.lead_id,
        channel: row.channel as ChatChannel,
        role: row.role === 'agent' ? 'agent' : 'human',
        agent: row.agent,
        message: row.message,
        meta,
        ts: row.ts,
      };
    });
  }

  /** Waktu pesan masuk (human) terakhir — dasar guard jendela 24 jam WhatsApp. */
  lastHumanMessageAt(conversationId: string): string | null {
    const row = this.db
      .prepare(
        "SELECT ts FROM cs_messages WHERE conversation_id = ? AND role = 'human' ORDER BY id DESC LIMIT 1",
      )
      .get(conversationId) as { ts: string } | undefined;
    return row?.ts ?? null;
  }

  messageCount(conversationId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM cs_messages WHERE conversation_id = ?')
      .get(conversationId) as { n: number };
    return row.n;
  }
}

/** Konversi record SQLite → ChatTurnPayload (kontrak socket, Fase 8). */
export function messageToTurn(record: CsMessageRecord): ChatTurnPayload {
  const turn: ChatTurnPayload = {
    conversationId: record.conversationId,
    channel: record.channel,
    role: record.role,
    message: record.message,
    timestamp: record.ts,
  };
  if (record.role === 'agent') turn.agentId = record.agent === 'pm_agent' ? 'pm_agent' : 'cs_agent';
  if (record.meta && typeof record.meta.citations === 'object' && record.meta.citations) {
    const citations = (record.meta.citations as unknown[]).filter(
      (c): c is string => typeof c === 'string',
    );
    if (citations.length > 0) turn.citations = citations;
  }
  return turn;
}
