import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { EmailDriver } from '../integrations/types';
import type { LLMProvider } from '../llm/provider';
import type { MemoryProvider } from '../memory/provider';
import type { PaymentProvider } from '../payments';
import type { PaymentLinkPayload } from '../payments/provider';
import {
  formatMoney,
  nowIso,
  type ChatTurnPayload,
  type InboxEntry,
  type Lead,
  type LeadQuote,
  type LeadSource,
  type LeadUpdatePayload,
} from '../types';
import {
  whatsappWindowOpen,
  type EmailChannelAdapter,
  type NormalizedInbound,
  type OutboundMessage,
  type OutboundResult,
  type WhatsAppAdapter,
  type WidgetAdapter,
} from './channels';
import { contractFileName, renderContractPdf } from './contract';
import { conversationIdFor, messageToTurn, type CsMessageRecord, type LeadsStore } from './leads';

/**
 * CS AGENT SERVICE (Fase 11 — PRD §3.5).
 *
 * Satu pintu untuk omnichannel customer success:
 *   • `handleInbound` — semua adapter menormalkan pesan masuk ke sini; lead
 *     dibuat/ditemukan, transkrip durable (SQLite + vector `briefing`/`leads`),
 *     balasan disusun LLM task `cs` dengan recall → dikirim lewat channel asal;
 *   • `quote` — closing flow: payment link (PaymentProvider) + kontrak PDF
 *     terisi otomatis → dikirim via channel yang sama;
 *   • `sweep` — follow-up engine: lead dengan `next_followup_at` terlewat
 *     ditindaklanjuti (template per status; WhatsApp di luar jendela 24 jam
 *     otomatis memakai template HSM);
 *   • `markDeal` — settlement terverifikasi → status deal + ringkasan ke pm-memory.
 */

export interface CsAdapters {
  widget: WidgetAdapter;
  whatsapp: WhatsAppAdapter;
  email: EmailChannelAdapter;
}

export interface CsServiceOptions {
  store: LeadsStore;
  memory: MemoryProvider;
  llm: LLMProvider;
  payment: PaymentProvider;
  email: EmailDriver;
  adapters: CsAdapters;
  /** Broadcast satu event socket ke seluruh Theater (io.emit). */
  broadcast: (event: string, payload: unknown) => void;
  /** Folder PDF kontrak (DATA_DIR/contracts). */
  contractsDir: string;
  /** Basis URL publik Brain untuk tautan kontrak (mis. http://localhost:4800). */
  publicBaseUrl: string;
  /** Jeda follow-up pertama setelah pesan terakhir (default 10 menit). */
  followupDelayMs?: number;
  /** Batas follow-up otomatis sebelum lead ditandai lost (default 3). */
  maxFollowups?: number;
  /** Nama produk default saat quote & follow-up. */
  defaultProductName?: string;
}

interface ResolvedOptions extends CsServiceOptions {
  followupDelayMs: number;
  maxFollowups: number;
  defaultProductName: string;
}

export interface CsSweepResult {
  checked: number;
  sent: number;
  templates: number;
  lost: number;
}

export interface QuoteInput {
  amount?: number;
  currency?: 'USD' | 'IDR';
  productName?: string;
}

export type QuoteResult =
  | { ok: true; lead: Lead; link: PaymentLinkPayload; contractUrl: string }
  | { ok: false; error: string };

/** Niat membeli → quote otomatis diajukan (deterministik, lintas bahasa umum). */
const BUYING_INTENT_RE = /(harga|price|berapa|biaya|invoice|bayar|checkout|beli|deal|langganan)/i;
/** Follow-up lanjutan menjauh 24 jam (quote & non-quote). */
const FOLLOWUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const THREAD_CONTEXT_TURNS = 12;

function updatePayload(lead: Lead, reason: LeadUpdatePayload['reason']): LeadUpdatePayload {
  return { lead, reason, timestamp: nowIso() };
}

export class CsService {
  private readonly opts: ResolvedOptions;
  /** Dedupe id pesan provider (retry webhook tidak dobel-balas). */
  private readonly seenInbound = new Map<string, true>();

  constructor(options: CsServiceOptions) {
    this.opts = {
      ...options,
      followupDelayMs: options.followupDelayMs ?? 10 * 60 * 1000,
      maxFollowups: options.maxFollowups ?? 3,
      defaultProductName: options.defaultProductName ?? 'AutoOffice3D Product',
    };
    mkdirSync(this.opts.contractsDir, { recursive: true });
  }

  private broadcast(event: string, payload: unknown): void {
    this.opts.broadcast(event, payload);
  }

  /* ───────────────────────── Inbox & riwayat ───────────────────────── */

  inbox(limit = 50): InboxEntry[] {
    return this.opts.store.listLeads(limit).map((lead) => {
      const messages = this.opts.store.listMessages(lead.conversationId, 1);
      const last = messages.at(-1);
      return {
        lead,
        lastMessage: last ? messageToTurn(last) : null,
        messageCount: this.opts.store.messageCount(lead.conversationId),
      };
    });
  }

  history(conversationId: string, limit = 200): ChatTurnPayload[] {
    return this.opts.store.listMessages(conversationId, limit).map(messageToTurn);
  }

  /** Lead yang baru terdeteksi menarik minat — ditulis Marketer (handoff PRD §3.4). */
  registerLead(input: {
    id?: string;
    source: LeadSource;
    contact: string;
    name?: string;
    interest?: string;
  }): Lead {
    const previous =
      (input.id ? this.opts.store.getLead(input.id) : null) ??
      this.opts.store.getLeadByConversation(conversationIdFor(input.source, input.contact));
    const lead = this.opts.store.createLead({
      id: input.id,
      source: input.source,
      contact: input.contact,
      name: input.name,
      interest: input.interest,
      nextFollowupAt: new Date(Date.now() + this.opts.followupDelayMs).toISOString(),
    });
    this.broadcast('lead:update', updatePayload(lead, previous ? 'message' : 'created'));
    return lead;
  }

  /* ──────────────────────── Pesan masuk (omnichannel) ──────────────────────── */

  /** Titik masuk semua adapter — normalisasi sudah dilakukan di channel layer. */
  async handleInbound(
    inbound: NormalizedInbound,
  ): Promise<{ lead: Lead; reply: ChatTurnPayload } | null> {
    const text = inbound.text.trim();
    if (!text) return null;
    if (inbound.providerMessageId) {
      if (this.seenInbound.has(inbound.providerMessageId)) return null;
      this.seenInbound.set(inbound.providerMessageId, true);
      if (this.seenInbound.size > 2000) {
        const first = this.seenInbound.keys().next().value;
        if (first) this.seenInbound.delete(first);
      }
    }

    const conversationId = conversationIdFor(inbound.channel, inbound.contact);
    const previous = this.opts.store.getLeadByConversation(conversationId);
    const lead = this.opts.store.createLead({
      source: inbound.channel,
      contact: inbound.contact,
      name: inbound.name,
      interest: text.slice(0, 120),
      nextFollowupAt: new Date(Date.now() + this.opts.followupDelayMs).toISOString(),
    });
    if (!previous) this.broadcast('lead:update', updatePayload(lead, 'created'));

    const channel = this.threadChannel(lead.source);
    const humanRecord = this.appendTurn({
      lead,
      channel,
      role: 'human',
      message: text,
      ts: inbound.timestamp,
    });

    // Recall lintas namespace: transkrip channel + ingatan produk + lead lain.
    const [briefHits, pmHits, leadHits] = await Promise.all([
      this.opts.memory.search('briefing', text, 4).catch(() => []),
      this.opts.memory.search('pm-memory', text, 3).catch(() => []),
      this.opts.memory.search('leads', text, 3).catch(() => []),
    ]);
    const citations = [...pmHits, ...leadHits, ...briefHits]
      .filter((hit) => hit.id !== `cs:${humanRecord.id}`)
      .slice(0, 5)
      .map((hit) => `${hit.namespace}[${hit.id}]: ${hit.text.slice(0, 140)}`);

    const thread = this.formatThread(lead.conversationId);
    const result = await this.opts.llm.complete({
      task: 'cs',
      prompt: text,
      context: {
        projectName: this.opts.defaultProductName,
        retrieved: citations,
        thread,
      },
    });
    let replyText = result.text.trim();

    // Niat beli → ajukan quote otomatis (payment link + kontrak PDF, satu pesan).
    let quoted: { link: PaymentLinkPayload; contractUrl: string } | null = null;
    if (!lead.quote && BUYING_INTENT_RE.test(text)) {
      const quote = await this.createQuote(lead, { amount: 29, currency: 'USD' });
      if (quote.ok) {
        quoted = { link: quote.link, contractUrl: quote.contractUrl };
        replyText = [
          replyText,
          '',
          `Quote resmi: ${formatMoney(quote.link.amount, quote.link.currency)} — bayar di ${quote.link.checkoutUrl}`,
          `Kontrak PDF: ${quote.contractUrl}`,
        ].join('\n');
      }
    }

    // Kirim lewat channel asal dulu (guard 24 jam WA) → transkrip menyimpan mode.
    const current = this.opts.store.getLead(lead.id) ?? lead;
    const outbound = await this.sendOutbound(current, replyText, {
      subject: `Balasan CS · ${this.opts.defaultProductName}`,
    });
    const agentRecord = this.appendTurn({
      lead: current,
      channel,
      role: 'agent',
      message: replyText,
      meta: {
        citations,
        model: result.model,
        outboundId: outbound.id,
        mode: outbound.mode,
        ...(quoted
          ? { kind: 'quote', checkoutUrl: quoted.link.checkoutUrl, contractUrl: quoted.contractUrl }
          : {}),
      },
    });

    // Status & jadwal follow-up.
    const status = current.status === 'new' ? 'contacted' : current.status;
    const updated = this.opts.store.updateLead(lead.id, {
      status,
      nextFollowupAt: new Date(Date.now() + this.opts.followupDelayMs).toISOString(),
    });
    if (updated) this.broadcast('lead:update', updatePayload(updated, 'message'));

    const reply = messageToTurn(agentRecord);
    this.broadcast('cs:message', reply);
    return { lead: updated ?? current, reply };
  }

  /** Pesan dari web widget halaman demo (socket `cs:widget_message`). */
  async handleWidgetMessage(input: {
    visitorId: string;
    name?: string;
    message: string;
  }): Promise<{ lead: Lead; reply: ChatTurnPayload } | null> {
    const inbound: NormalizedInbound = {
      channel: 'widget',
      contact: input.visitorId,
      text: input.message,
    };
    if (input.name) inbound.name = input.name;
    return this.handleInbound(inbound);
  }

  /** Webhook WhatsApp Cloud API (POST /webhook/whatsapp). */
  async handleWhatsAppInbound(body: unknown): Promise<{ handled: boolean; leadId?: string }> {
    const inbound = this.opts.adapters.whatsapp.parseInbound(body);
    if (!inbound) return { handled: false };
    const result = await this.handleInbound(inbound);
    return result ? { handled: true, leadId: result.lead.id } : { handled: false };
  }

  /** Verifikasi GET webhook WhatsApp (`hub.mode=subscribe` + token cocok). */
  verifyWhatsAppChallenge(query: { mode?: string | null; token?: string | null }): boolean {
    return this.opts.adapters.whatsapp.verifyChallenge(query);
  }

  /** Webhook email inbound (Mailgun/Postmark). */
  async handleEmailInbound(input: {
    rawBody: string;
    headers?: Record<string, string | string[] | undefined>;
    contentType?: string;
  }): Promise<
    | { ok: true; handled: boolean; leadId?: string }
    | { ok: false; error: 'invalid-secret' | 'invalid-payload' }
  > {
    if (!this.opts.adapters.email.verifySecret(input.headers)) {
      return { ok: false, error: 'invalid-secret' };
    }
    const inbound = this.opts.adapters.email.parseInbound(input.rawBody, input.contentType);
    if (!inbound) return { ok: false, error: 'invalid-payload' };
    const result = await this.handleInbound(inbound);
    return result
      ? { ok: true, handled: true, leadId: result.lead.id }
      : { ok: true, handled: false };
  }

  /* ───────────────────────────── Closing flow ───────────────────────────── */

  /** Quote → payment link (PaymentProvider) → kontrak PDF → kirim via channel. */
  async quote(leadId: string, input: QuoteInput = {}): Promise<QuoteResult> {
    const lead = this.opts.store.getLead(leadId);
    if (!lead) return { ok: false, error: `lead ${leadId} tidak ditemukan` };
    if (lead.status === 'deal') return { ok: false, error: 'lead sudah deal' };
    if (lead.status === 'lost') return { ok: false, error: 'lead sudah lost' };

    const created = await this.createQuote(lead, input);
    if (!created.ok) return created;

    const text = [
      `Quote untuk ${created.lead.quote?.productName ?? 'produk'}: ${formatMoney(created.link.amount, created.link.currency)}`,
      `Bayar (hosted, aman): ${created.link.checkoutUrl}`,
      `Kontrak PDF terisi otomatis: ${created.contractUrl}`,
    ].join('\n');
    const outbound = await this.sendOutbound(created.lead, text, {
      subject: `Kontrak & tautan pembayaran — ${created.lead.quote?.productName ?? 'AutoOffice3D'}`,
    });
    const agentRecord = this.appendTurn({
      lead: created.lead,
      channel: this.threadChannel(created.lead.source),
      role: 'agent',
      message: text,
      meta: {
        kind: 'quote',
        checkoutUrl: created.link.checkoutUrl,
        contractUrl: created.contractUrl,
        provider: created.link.provider,
        outboundId: outbound.id,
        mode: outbound.mode,
      },
    });
    this.broadcast('cs:message', messageToTurn(agentRecord));

    return {
      ok: true,
      lead: this.currentLead(leadId),
      link: created.link,
      contractUrl: created.contractUrl,
    };
  }

  /**
   * Artefak quote (link + kontrak + status qualified) tanpa mengirim pesan —
   * dipakai `quote()` (aksi inbox: kirim sendiri) dan auto-quote di balasan CS
   * supaya client hanya menerima SATU pesan.
   */
  private async createQuote(
    lead: Lead,
    input: QuoteInput,
  ): Promise<
    | { ok: true; lead: Lead; link: PaymentLinkPayload; contractUrl: string }
    | { ok: false; error: string }
  > {
    const amount = input.amount ?? lead.quote?.amount ?? 29;
    const currency = input.currency ?? lead.quote?.currency ?? 'USD';
    const productName =
      input.productName ??
      (lead.interest.trim().length > 0
        ? `Deal ${lead.interest.trim().slice(0, 48)}`
        : this.opts.defaultProductName);

    let link: PaymentLinkPayload;
    try {
      link = await this.opts.payment.createPaymentLink({
        leadId: lead.id,
        amount,
        currency,
        productName,
        customerEmail: lead.source === 'email' ? lead.contact : undefined,
        expiresInS: 7 * 24 * 60 * 60,
      });
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    const contractUrl = `${this.opts.publicBaseUrl}/cs/contracts/${contractFileName(lead.id)}`;
    const quote: LeadQuote = {
      amount,
      currency,
      productName,
      checkoutUrl: link.checkoutUrl,
      contractUrl,
    };
    const pdf = renderContractPdf({
      lead: { id: lead.id, name: lead.name, contact: lead.contact, source: lead.source },
      productName,
      quote,
      date: nowIso(),
    });
    writeFileSync(join(this.opts.contractsDir, contractFileName(lead.id)), pdf);

    const updated =
      this.opts.store.updateLead(lead.id, {
        status: 'qualified',
        quote,
        nextFollowupAt: new Date(Date.now() + FOLLOWUP_INTERVAL_MS).toISOString(),
      }) ?? lead;
    this.broadcast('lead:update', updatePayload(updated, 'quote'));

    const linkPayload: PaymentLinkPayload = { ...link, contractUrl };
    this.broadcast('payment:link_created', linkPayload);
    return { ok: true, lead: updated, link: linkPayload, contractUrl };
  }

  /** Settlement terverifikasi (webhook) → deal + ucapan terima kasih + pm-memory. */
  async markDeal(
    leadId: string,
    sale: { amount: number; currency: string; provider: string },
  ): Promise<void> {
    const lead = this.opts.store.getLead(leadId);
    if (!lead || lead.status === 'deal') return;
    const updated = this.opts.store.updateLead(leadId, { status: 'deal', nextFollowupAt: null });
    if (!updated) return;
    this.broadcast('lead:update', updatePayload(updated, 'deal'));

    const text =
      `Pembayaran diterima — terima kasih! ${formatMoney(sale.amount, sale.currency)} via ${sale.provider}. ` +
      'Akses produk aktif di tautan yang sama; kontrak berlaku efektif sekarang.';
    const outbound = await this.sendOutbound(updated, text, {
      subject: `Pembayaran diterima — selamat datang, ${updated.name || updated.contact}!`,
    });
    const agentRecord = this.appendTurn({
      lead: updated,
      role: 'agent',
      channel: this.threadChannel(updated.source),
      message: text,
      meta: { kind: 'deal', provider: sale.provider, outboundId: outbound.id, mode: outbound.mode },
    });
    this.broadcast('cs:message', messageToTurn(agentRecord));

    // Ringkasan deal → pm-memory (PRD §3.5: run berikutnya tahu konteks client).
    await this.opts.memory
      .upsert('pm-memory', [
        {
          id: `deal:${leadId}`,
          text: `Deal ${updated.name || updated.contact} (${updated.source}) — ${formatMoney(sale.amount, sale.currency)} via ${sale.provider}; quote "${updated.quote?.productName ?? updated.interest.slice(0, 60)}".`,
          metadata: { kind: 'deal', leadId, source: updated.source },
        },
      ])
      .catch(() => undefined);
  }

  /* ─────────────────────── Follow-up engine (scheduler) ─────────────────────── */

  /**
   * Sapu lead yang `next_followup_at` terlewat → susun pesan sesuai status →
   * kirim via channel (WA di luar jendela 24 jam → template HSM). `force: true`
   * memakai semua lead terbuka (demo/e2e) — default hanya yang jatuh tempo.
   */
  async sweep(
    options: { force?: boolean; limit?: number; now?: Date } = {},
  ): Promise<CsSweepResult> {
    const now = options.now ?? new Date();
    const limit = options.limit ?? 20;
    const leads = options.force
      ? this.opts.store.openLeads(limit)
      : this.opts.store.dueFollowups(now.toISOString(), limit);

    let sent = 0;
    let templates = 0;
    let lost = 0;

    for (const lead of leads) {
      if (lead.followupsSent >= this.opts.maxFollowups) {
        const updated = this.opts.store.updateLead(lead.id, {
          status: 'lost',
          nextFollowupAt: null,
        });
        if (updated) {
          this.broadcast('lead:update', updatePayload(updated, 'status'));
          lost += 1;
        }
        continue;
      }
      const text = this.followupText(lead);
      const outbound = await this.sendOutbound(lead, text, {
        subject: `Menindaklanjuti ${this.opts.defaultProductName}`,
      });
      if (outbound.mode === 'template') templates += 1;
      const status = lead.status === 'new' ? 'contacted' : lead.status;
      const updated = this.opts.store.updateLead(lead.id, {
        status,
        followupsSent: lead.followupsSent + 1,
        nextFollowupAt: new Date(now.getTime() + FOLLOWUP_INTERVAL_MS).toISOString(),
      });
      const agentRecord = this.appendTurn({
        lead: updated ?? lead,
        role: 'agent',
        channel: this.threadChannel(lead.source),
        message: text,
        meta: { kind: 'followup', mode: outbound.mode, outboundId: outbound.id },
      });
      this.broadcast('cs:message', messageToTurn(agentRecord));
      if (updated) this.broadcast('lead:update', updatePayload(updated, 'followup'));
      sent += 1;
    }
    return { checked: leads.length, sent, templates, lost };
  }

  /* ────────────────────────────── Kontrak ────────────────────────────── */

  contractPath(leadId: string): string {
    return join(this.opts.contractsDir, contractFileName(leadId));
  }

  readContract(leadId: string): Buffer | null {
    const path = this.contractPath(leadId);
    if (!existsSync(path)) return null;
    try {
      return readFileSync(path);
    } catch {
      return null;
    }
  }

  /* ───────────────────────────── internal ───────────────────────────── */

  private currentLead(leadId: string): Lead {
    return this.opts.store.getLead(leadId) as Lead;
  }

  private threadChannel(source: LeadSource): ChatTurnPayload['channel'] {
    return source === 'whatsapp' ? 'cs_whatsapp' : source === 'email' ? 'cs_email' : 'cs_widget';
  }

  /** Persist satu turn (SQLite) + upsert vector `briefing`/`leads` (recall). */
  private appendTurn(input: {
    lead: Lead;
    channel: ChatTurnPayload['channel'];
    role: 'human' | 'agent';
    message: string;
    meta?: Record<string, unknown>;
    ts?: string;
  }): CsMessageRecord {
    const record = this.opts.store.appendMessage({
      conversationId: input.lead.conversationId,
      leadId: input.lead.id,
      channel: input.channel,
      role: input.role,
      agent: input.role === 'agent' ? 'cs_agent' : undefined,
      message: input.message,
      meta: input.meta,
      ts: input.ts,
    });
    void this.opts.memory
      .upsert('briefing', [
        {
          id: `cs:${record.id}`,
          text: input.message,
          metadata: {
            conversationId: input.lead.conversationId,
            channel: input.channel,
            role: input.role,
            seq: record.id,
            timestamp: record.ts,
            ...(input.role === 'agent' ? { agentId: 'cs_agent' } : {}),
          },
        },
      ])
      .catch(() => undefined);
    if (input.role === 'human') {
      void this.opts.memory
        .upsert('leads', [
          {
            id: `lead:${input.lead.id}:${record.id}`,
            text: input.message,
            metadata: {
              leadId: input.lead.id,
              source: input.lead.source,
              contact: input.lead.contact,
              kind: 'message',
            },
          },
        ])
        .catch(() => undefined);
    }
    return record;
  }

  /** Transkrip "Client: … / CS: …" untuk konteks LLM. */
  private formatThread(conversationId: string): string {
    return this.opts.store
      .listMessages(conversationId, THREAD_CONTEXT_TURNS)
      .map((m) => `${m.role === 'human' ? 'Client' : 'CS'}: ${m.message}`)
      .join('\n');
  }

  /** Kirim balasan lewat channel lead (guard jendela 24 jam WhatsApp). */
  private async sendOutbound(
    lead: Lead,
    text: string,
    extra: { subject?: string } = {},
  ): Promise<OutboundResult> {
    const adapter =
      lead.source === 'whatsapp'
        ? this.opts.adapters.whatsapp
        : lead.source === 'email'
          ? this.opts.adapters.email
          : this.opts.adapters.widget;
    const windowOpen =
      lead.source === 'whatsapp'
        ? whatsappWindowOpen(this.opts.store.lastHumanMessageAt(lead.conversationId))
        : true;
    const input: OutboundMessage = {
      contact: lead.contact,
      text,
      windowOpen,
    };
    if (extra.subject) input.subject = extra.subject;
    return adapter.send(input);
  }

  /** Pesan follow-up per status lead (template deterministik, offline-safe). */
  private followupText(lead: Lead): string {
    const client = lead.name || lead.contact;
    if (lead.status === 'qualified' && lead.quote) {
      return [
        `Halo ${client}! Reminder: quote ${formatMoney(lead.quote.amount, lead.quote.currency)} untuk ${lead.quote.productName} masih aktif.`,
        `Bayar: ${lead.quote.checkoutUrl}`,
        `Kontrak: ${lead.quote.contractUrl}`,
      ].join('\n');
    }
    return [
      `Halo ${client}! Masih tertarik dengan ${this.opts.defaultProductName}?`,
      `Saya bisa siapkan quote + kontrak, atau jawab pertanyaan soal ${lead.interest.slice(0, 80) || 'produk'}.`,
      'Balas pesan ini kapan saja — saya bantu sampai tuntas.',
    ].join('\n');
  }
}
