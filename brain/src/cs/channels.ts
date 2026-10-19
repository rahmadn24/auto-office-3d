import { timingSafeEqual } from 'node:crypto';

import type { EmailDriver } from '../integrations/types';
import type { LeadSource } from '../types';

/**
 * CHANNEL ADAPTERS — omnichannel inbox (PRD §3.5, Fase 11).
 *
 * Semua channel menormalkan pesan masuk ke `NormalizedInbound` yang sama dan
 * mengekspos satu operasi outbound (`send`) — CS Agent tidak peduli asal pesan.
 *   • widget   — pesan dari halaman demo (socket), balasan di-broadcast brain.
 *   • whatsapp — WhatsApp Business Cloud API; outbound di luar jendela 24 jam
 *     otomatis memakai template HSM (constraint PRD §3.5).
 *   • email    — inbound webhook (Mailgun/Postmark) + outbound Resend/stub.
 */

export interface NormalizedInbound {
  channel: LeadSource;
  /** Identitas channel: visitor id / nomor WA / alamat email. */
  contact: string;
  name?: string;
  text: string;
  /** Id pesan dari provider — dipakai dedupe (retry webhook tidak dobel-balas). */
  providerMessageId?: string;
  timestamp?: string;
}

export interface OutboundMessage {
  contact: string;
  text: string;
  subject?: string;
  /**
   * Khusus WhatsApp: apakah jendela 24 jam layanan pelanggan masih terbuka.
   * Di luar jendela → balasan bebas dilarang Meta, wajib template HSM.
   */
  windowOpen?: boolean;
}

export interface OutboundResult {
  sent: boolean;
  id: string;
  mode: 'direct' | 'template' | 'stub';
  note?: string;
}

export interface ChannelAdapter {
  readonly channel: LeadSource;
  send(input: OutboundMessage): Promise<OutboundResult>;
}

/** Batas jendela layanan pelanggan WhatsApp Cloud API (24 jam, PRD §3.5). */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** true bila masih dalam 24 jam sejak pesan masuk terakhir dari client. */
export function whatsappWindowOpen(
  lastInboundAt: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!lastInboundAt) return false;
  const last = Date.parse(lastInboundAt);
  if (Number.isNaN(last)) return false;
  return now.getTime() - last < WHATSAPP_WINDOW_MS;
}

let widgetSeq = 0;
let waSeq = 0;

/** Adapter widget demo — outbound = broadcast `cs:message` (diurus server). */
export class WidgetAdapter implements ChannelAdapter {
  readonly channel = 'widget' as const;

  async send(_input: OutboundMessage): Promise<OutboundResult> {
    widgetSeq += 1;
    return {
      sent: true,
      id: `widget_${widgetSeq}`,
      mode: 'direct',
    };
  }
}

export interface WhatsAppOptions {
  /** `stub` = offline (log saja); `live` = Cloud API sungguhan (butuh kredensial). */
  driver: 'stub' | 'live';
  accessToken?: string;
  phoneNumberId?: string;
  verifyToken?: string;
  /** Template HSM di luar jendela 24 jam (default hello_world — template uji Meta). */
  templateName?: string;
  templateLang?: string;
  graphBaseUrl?: string;
  fetchImpl?: typeof fetch;
}

/** WhatsApp Business Cloud API (PRD §3.5) — inbound webhook + outbound + guard 24h. */
export class WhatsAppAdapter implements ChannelAdapter {
  readonly channel = 'whatsapp' as const;
  private readonly opts: WhatsAppOptions;

  constructor(opts: WhatsAppOptions) {
    this.opts = {
      graphBaseUrl: 'https://graph.facebook.com/v21.0',
      templateName: 'hello_world',
      templateLang: 'en_US',
      fetchImpl: fetch,
      ...opts,
    };
  }

  /** Verifikasi GET webhook (`hub.mode=subscribe` + token cocok). */
  verifyChallenge(query: { mode?: string | null; token?: string | null }): boolean {
    if (!this.opts.verifyToken) return false;
    return query.mode === 'subscribe' && query.token === this.opts.verifyToken;
  }

  /** Normalisasi payload webhook Cloud API → pesan masuk pertama yang berupa teks. */
  parseInbound(body: unknown): NormalizedInbound | null {
    const entries = (body as { entry?: unknown[] } | null)?.entry;
    if (!Array.isArray(entries)) return null;
    for (const entry of entries) {
      const changes = (entry as { changes?: unknown[] } | null)?.changes;
      if (!Array.isArray(changes)) continue;
      for (const change of changes) {
        const value = (change as { value?: Record<string, unknown> } | null)?.value;
        if (!value) continue;
        const messages = value.messages as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(messages) || messages.length === 0) continue;
        const message = messages[0];
        if (message?.type !== 'text') continue;
        const text = (message.text as { body?: unknown } | null)?.body;
        const from = message.from;
        if (typeof text !== 'string' || typeof from !== 'string') continue;
        const contacts = value.contacts as Array<Record<string, unknown>> | undefined;
        const profile = contacts?.[0]?.profile as { name?: unknown } | undefined;
        const tsRaw = message.timestamp;
        const parsed: NormalizedInbound = {
          channel: 'whatsapp',
          contact: from,
          text,
        };
        if (typeof profile?.name === 'string') parsed.name = profile.name;
        if (typeof message.id === 'string') parsed.providerMessageId = message.id;
        if (typeof tsRaw === 'string' && /^\d+$/.test(tsRaw)) {
          parsed.timestamp = new Date(Number(tsRaw) * 1000).toISOString();
        }
        return parsed;
      }
    }
    return null;
  }

  async send(input: OutboundMessage): Promise<OutboundResult> {
    const windowOpen = input.windowOpen !== false;
    const mode: OutboundResult['mode'] = windowOpen ? 'direct' : 'template';
    if (this.opts.driver === 'stub') {
      waSeq += 1;
      return {
        sent: true,
        id: `wa_stub_${waSeq}`,
        mode: windowOpen ? 'stub' : 'template',
        note: windowOpen
          ? 'stub: balasan bebas (dalam jendela 24 jam)'
          : `stub: template HSM "${this.opts.templateName}" (di luar jendela 24 jam)`,
      };
    }

    const url = `${this.opts.graphBaseUrl}/${this.opts.phoneNumberId}/messages`;
    const requestBody = windowOpen
      ? {
          messaging_product: 'whatsapp',
          to: input.contact,
          type: 'text',
          text: { preview_url: false, body: input.text },
        }
      : {
          messaging_product: 'whatsapp',
          to: input.contact,
          type: 'template',
          template: {
            name: this.opts.templateName,
            language: { code: this.opts.templateLang },
          },
        };

    try {
      const res = await (this.opts.fetchImpl as typeof fetch)(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.opts.accessToken ?? ''}`,
          'content-type': 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
        body: JSON.stringify(requestBody),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.warn(`[cs:whatsapp] HTTP ${res.status}: ${detail.slice(0, 200)}`);
        return { sent: false, id: '', mode, note: `HTTP ${res.status}` };
      }
      const data = (await res.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>;
      };
      return { sent: true, id: data.messages?.[0]?.id ?? '', mode };
    } catch (err) {
      console.warn(`[cs:whatsapp] network error: ${(err as Error).message}`);
      return { sent: false, id: '', mode, note: (err as Error).message };
    }
  }
}

export interface EmailChannelOptions {
  email: EmailDriver;
  /** Secret webhook inbound (header `x-cs-inbound-secret`); kosong = mode demo. */
  inboundSecret?: string;
}

/** Alamat email dari bentuk ``Nama <a@b.c>`` maupun polos. */
export function extractEmailAddress(input: string): string {
  const match = /<([^<>@\s]+@[^<>\s]+)>/.exec(input);
  const grouped = match?.[1];
  if (grouped) return grouped.toLowerCase();
  const plain = /[^\s<>"]+@[^\s<>"]+/.exec(input);
  return (plain?.[0] ?? input).trim().toLowerCase();
}

/** Adapter email inbound (Mailgun/Postmark) + outbound via EmailDriver. */
export class EmailChannelAdapter implements ChannelAdapter {
  readonly channel = 'email' as const;

  constructor(private readonly opts: EmailChannelOptions) {}

  /** Secret terpasang → header wajib cocok (constant-time). Kosong = mode demo. */
  verifySecret(headers?: Record<string, string | string[] | undefined>): boolean {
    const secret = this.opts.inboundSecret;
    if (!secret) return true;
    const raw = headers?.['x-cs-inbound-secret'];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    if (typeof provided !== 'string') return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(secret);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Normalisasi webhook inbound (Mailgun form-urlencoded / Postmark JSON). */
  parseInbound(rawBody: string, contentType = ''): NormalizedInbound | null {
    if (contentType.includes('application/json')) {
      let parsed: { From?: unknown; Subject?: unknown; TextBody?: unknown; MessageID?: unknown };
      try {
        parsed = JSON.parse(rawBody) as typeof parsed;
      } catch {
        return null;
      }
      if (typeof parsed.From !== 'string' || typeof parsed.TextBody !== 'string') return null;
      const inbound: NormalizedInbound = {
        channel: 'email',
        contact: extractEmailAddress(parsed.From),
        text: parsed.TextBody.trim().slice(0, 4000),
      };
      const name = /^([^<]+)</.exec(parsed.From)?.[1]?.trim();
      if (name) inbound.name = name;
      const subject = typeof parsed.Subject === 'string' ? parsed.Subject : '';
      if (subject) inbound.text = `[${subject}]\n${inbound.text}`;
      if (typeof parsed.MessageID === 'string') inbound.providerMessageId = parsed.MessageID;
      return inbound;
    }

    const form = new URLSearchParams(rawBody);
    const from = form.get('sender') ?? form.get('from');
    const text = form.get('body-plain') ?? form.get('stripped-text') ?? form.get('text');
    if (!from || !text) return null;
    const inbound: NormalizedInbound = {
      channel: 'email',
      contact: extractEmailAddress(from),
      text: text.trim().slice(0, 4000),
    };
    const name = /^([^<]+)</.exec(from)?.[1]?.trim();
    if (name) inbound.name = name;
    const subject = form.get('subject');
    if (subject) inbound.text = `[${subject}]\n${inbound.text}`;
    const messageId = form.get('Message-Id');
    if (messageId) inbound.providerMessageId = messageId;
    return inbound;
  }

  async send(input: OutboundMessage): Promise<OutboundResult> {
    const result = await this.opts.email.send({
      to: input.contact,
      subject: input.subject ?? 'Balasan CS · AutoOffice3D',
      body: input.text,
    });
    return {
      sent: result.sent,
      id: result.id,
      mode: this.opts.email.driver === 'stub' ? 'stub' : 'direct',
      note:
        this.opts.email.driver === 'stub'
          ? 'stub: email tercatat, tidak terkirim nyata'
          : undefined,
    };
  }
}
