import { describe, expect, it } from 'vitest';

import {
  EmailChannelAdapter,
  extractEmailAddress,
  WhatsAppAdapter,
  whatsappWindowOpen,
  type NormalizedInbound,
} from '../src/cs/channels';
import type { EmailDriver } from '../src/integrations/types';

/**
 * Channel adapters (Fase 11): normalisasi inbound lintas channel ke satu format
 * + aturan outbound (WhatsApp 24 jam → template HSM, email via EmailDriver).
 */

function waPayload(text = 'Halo, berapa harganya?'): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba_1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '628111', phone_number_id: '123' },
              contacts: [{ profile: { name: 'Rina' }, wa_id: '628123456789' }],
              messages: [
                {
                  from: '628123456789',
                  id: 'wamid.HBgM123',
                  timestamp: '1767225600',
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

class RecordingEmail implements EmailDriver {
  readonly driver = 'stub';
  readonly sent: Array<{ to: string; subject: string; body: string }> = [];
  async send(input: { to: string; subject: string; body: string }): Promise<{
    sent: boolean;
    id: string;
  }> {
    this.sent.push(input);
    return { sent: true, id: `rec_${this.sent.length}` };
  }
}

describe('WhatsAppAdapter — Cloud API inbound/outbound (Fase 11)', () => {
  it('parseInbound menormalkan pesan teks + nama + timestamp', () => {
    const adapter = new WhatsAppAdapter({ driver: 'stub', verifyToken: 'vt' });
    const inbound = adapter.parseInbound(waPayload());
    expect(inbound).toEqual({
      channel: 'whatsapp',
      contact: '628123456789',
      name: 'Rina',
      text: 'Halo, berapa harganya?',
      providerMessageId: 'wamid.HBgM123',
      timestamp: '2026-01-01T00:00:00.000Z',
    });
  });

  it('mengabaikan callback status (delivered/read) dan pesan non-teks', () => {
    const adapter = new WhatsAppAdapter({ driver: 'stub', verifyToken: 'vt' });
    expect(
      adapter.parseInbound({
        entry: [{ changes: [{ value: { statuses: [{ status: 'delivered' }] } }] }],
      }),
    ).toBeNull();
    const media = waPayload();
    const message = (
      media as {
        entry: Array<{ changes: Array<{ value: { messages: Array<Record<string, unknown>> } }> }>;
      }
    ).entry[0]?.changes[0]?.value.messages[0];
    if (message) {
      message.type = 'image';
      delete message.text;
    }
    expect(adapter.parseInbound(media)).toBeNull();
  });

  it('verifyChallenge hanya lolos untuk mode subscribe + token cocok', () => {
    const adapter = new WhatsAppAdapter({ driver: 'stub', verifyToken: 'rahasia' });
    expect(adapter.verifyChallenge({ mode: 'subscribe', token: 'rahasia' })).toBe(true);
    expect(adapter.verifyChallenge({ mode: 'subscribe', token: 'salah' })).toBe(false);
    expect(adapter.verifyChallenge({ mode: 'unsubscribe', token: 'rahasia' })).toBe(false);
    const tanpaToken = new WhatsAppAdapter({ driver: 'stub' });
    expect(tanpaToken.verifyChallenge({ mode: 'subscribe', token: 'apa-saja' })).toBe(false);
  });

  it('stub: dalam jendela 24 jam → balasan bebas, di luar → template HSM', async () => {
    const adapter = new WhatsAppAdapter({
      driver: 'stub',
      verifyToken: 'vt',
      templateName: 'followup_nudge',
    });
    const open = await adapter.send({
      contact: '628123',
      text: 'Halo!',
      windowOpen: true,
    });
    expect(open.mode).toBe('stub');
    expect(open.sent).toBe(true);

    const closed = await adapter.send({
      contact: '628123',
      text: 'Halo lagi!',
      windowOpen: false,
    });
    expect(closed.mode).toBe('template');
    expect(closed.note).toContain('followup_nudge');
  });

  it('live: POST teks di jendela terbuka, POST template saat jendela tertutup', async () => {
    const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
        headers: init?.headers as Record<string, string>,
      });
      return new Response(JSON.stringify({ messages: [{ id: 'wamid.SENT' }] }), { status: 200 });
    }) as unknown as typeof fetch;

    const adapter = new WhatsAppAdapter({
      driver: 'live',
      accessToken: 'EAAG-token',
      phoneNumberId: '555',
      verifyToken: 'vt',
      fetchImpl,
    });

    const direct = await adapter.send({ contact: '6281', text: 'Hai', windowOpen: true });
    expect(direct).toMatchObject({ sent: true, id: 'wamid.SENT', mode: 'direct' });
    expect(calls[0]?.url).toBe('https://graph.facebook.com/v21.0/555/messages');
    expect(calls[0]?.body).toMatchObject({ type: 'text', text: { body: 'Hai' } });
    expect(calls[0]?.headers.authorization).toBe('Bearer EAAG-token');

    await adapter.send({ contact: '6281', text: 'Follow-up', windowOpen: false });
    expect(calls[1]?.body).toMatchObject({
      type: 'template',
      template: { name: 'hello_world', language: { code: 'en_US' } },
    });
  });

  it('live: HTTP error → sent=false dengan catatan status (tidak melempar)', async () => {
    const adapter = new WhatsAppAdapter({
      driver: 'live',
      accessToken: 'x',
      phoneNumberId: '1',
      fetchImpl: (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch,
    });
    const result = await adapter.send({ contact: '6281', text: 'Hai', windowOpen: true });
    expect(result.sent).toBe(false);
    expect(result.note).toBe('HTTP 500');
  });

  it('whatsappWindowOpen: < 24 jam terbuka, lebih lama tertutup', () => {
    const now = new Date('2026-01-02T12:00:00.000Z');
    expect(whatsappWindowOpen('2026-01-02T00:00:00.000Z', now)).toBe(true);
    expect(whatsappWindowOpen('2026-01-01T00:00:00.000Z', now)).toBe(false);
    expect(whatsappWindowOpen(null, now)).toBe(false);
    expect(whatsappWindowOpen('bukan-tanggal', now)).toBe(false);
  });
});

describe('EmailChannelAdapter — inbound Mailgun/Postmark + outbound (Fase 11)', () => {
  it('parse form-urlencoded Mailgun (sender/subject/body-plain)', () => {
    const adapter = new EmailChannelAdapter({ email: new RecordingEmail() });
    const raw = new URLSearchParams({
      sender: 'Rina <rina@example.com>',
      subject: 'Tanya harga',
      'body-plain': 'Halo, apakah ada paket tahunan?',
      'Message-Id': '<abc@mailgun>',
    }).toString();
    const inbound = adapter.parseInbound(raw, 'application/x-www-form-urlencoded');
    expect(inbound?.channel).toBe('email');
    expect(inbound?.contact).toBe('rina@example.com');
    expect(inbound?.name).toBe('Rina');
    expect(inbound?.text).toBe('[Tanya harga]\nHalo, apakah ada paket tahunan?');
    expect(inbound?.providerMessageId).toBe('<abc@mailgun>');
  });

  it('parse JSON Postmark (From/Subject/TextBody)', () => {
    const adapter = new EmailChannelAdapter({ email: new RecordingEmail() });
    const inbound = adapter.parseInbound(
      JSON.stringify({
        From: 'Hans <hans@example.de>',
        Subject: 'Demo',
        TextBody: 'Bisa kirim demo?',
        MessageID: 'pm_1',
      }),
      'application/json',
    );
    expect(inbound).toMatchObject({
      channel: 'email',
      contact: 'hans@example.de',
      name: 'Hans',
      providerMessageId: 'pm_1',
    });
    expect(inbound?.text).toContain('Bisa kirim demo?');
  });

  it('payload rusak → null (webhook membalas 400)', () => {
    const adapter = new EmailChannelAdapter({ email: new RecordingEmail() });
    expect(adapter.parseInbound('{bukan json', 'application/json')).toBeNull();
    expect(adapter.parseInbound('from=&text=', 'application/x-www-form-urlencoded')).toBeNull();
  });

  it('secret inbound: kosong = demo, terpasang = header wajib cocok', () => {
    const demo = new EmailChannelAdapter({ email: new RecordingEmail() });
    expect(demo.verifySecret({})).toBe(true);

    const guarded = new EmailChannelAdapter({
      email: new RecordingEmail(),
      inboundSecret: 's3cret',
    });
    expect(guarded.verifySecret({ 'x-cs-inbound-secret': 's3cret' })).toBe(true);
    expect(guarded.verifySecret({ 'x-cs-inbound-secret': ['s3cret'] })).toBe(true);
    expect(guarded.verifySecret({ 'x-cs-inbound-secret': 'salah' })).toBe(false);
    expect(guarded.verifySecret({})).toBe(false);
  });

  it('outbound memakai EmailDriver dan menandai mode stub/direct', async () => {
    const email = new RecordingEmail();
    const adapter = new EmailChannelAdapter({ email });
    const result = await adapter.send({
      contact: 'rina@example.com',
      text: 'Terima kasih!',
      subject: 'Balasan CS',
    });
    expect(result).toMatchObject({ sent: true, mode: 'stub' });
    expect(email.sent[0]).toEqual({
      to: 'rina@example.com',
      subject: 'Balasan CS',
      body: 'Terima kasih!',
    });
  });

  it('extractEmailAddress menerima format nama <email> dan polos', () => {
    expect(extractEmailAddress('Rina <Rina@Example.com>')).toBe('rina@example.com');
    expect(extractEmailAddress('hans@example.de')).toBe('hans@example.de');
    expect(extractEmailAddress('  <a@b.co>  ')).toBe('a@b.co');
  });
});

// Type-level guard: adapter menormalkan ke bentuk yang sama untuk semua channel.
const _normalized: NormalizedInbound = {
  channel: 'widget',
  contact: 'visitor',
  text: 'hi',
};
void _normalized;
