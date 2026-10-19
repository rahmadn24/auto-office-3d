import { describe, expect, it, vi } from 'vitest';

import {
  breakerMessage,
  createNotifier,
  deployMessage,
  DiscordNotifier,
  formatNotification,
  runFailedMessage,
  saleMessage,
  StubNotifier,
  TelegramNotifier,
} from '../src/integrations/notify';
import type { DeployUpdatePayload, FirstSalePayload } from '../src/types';

/**
 * Notifikasi founder (Fase 12 — kartu 12.7): driver stub default, Telegram &
 * Discord live dengan fetch yang di-mock, plus format pesan untuk wiring
 * milestone/deploy/run gagal/circuit breaker.
 */

const SALE: FirstSalePayload = {
  runId: 'run_n1',
  customer: { city: 'Jakarta', country: 'ID', maskedEmail: 'a***@mail.com' },
  amount: 149,
  currency: 'USD',
  paymentProvider: 'stub',
  paymentEventId: 'evt_1',
  hasCustomers: true,
  timestamp: '2026-10-20T03:00:00.000Z',
};

const DEPLOY: DeployUpdatePayload = {
  runId: 'run_n1',
  repoName: 'office-demo',
  repoUrl: 'https://github.com/x/office-demo',
  liveUrl: 'https://demo.example.com',
  status: 'ready',
  buildSteps: [],
  health: null,
  uptimeS: 12,
  bandwidthMb: 1.2,
  edgeCache: true,
  timestamp: '2026-10-20T03:05:00.000Z',
};

describe('notify: format + helper pesan', () => {
  it('formatNotification menyusun ikon/title/text/url', () => {
    const text = formatNotification({
      kind: 'sale',
      level: 'info',
      title: 'Milestone',
      text: 'Penjualan pertama',
      url: 'https://office.example.com',
    });
    expect(text).toBe('ℹ️ Milestone\nPenjualan pertama\nhttps://office.example.com');
    expect(formatNotification({ kind: 'sale', level: 'error', title: 'X', text: 'y' })).toContain(
      '🚨',
    );
  });

  it('saleMessage memuat nominal ter-format + provider + runId', () => {
    const msg = saleMessage(SALE);
    expect(msg.kind).toBe('sale');
    expect(msg.level).toBe('info');
    expect(msg.text).toContain('$149.00');
    expect(msg.text).toContain('stub');
    expect(msg.text).toContain('run_n1');
    expect(msg.at).toBe(SALE.timestamp);
  });

  it('deployMessage: ready = info dengan URL, degraded = warn dengan alasan', () => {
    const ok = deployMessage(DEPLOY);
    expect(ok.level).toBe('info');
    expect(ok.url).toBe('https://demo.example.com');
    expect(ok.title).toContain('ready');

    const bad = deployMessage({
      ...DEPLOY,
      status: 'degraded',
      degradedReason: 'daemon docker mati',
    });
    expect(bad.level).toBe('warn');
    expect(bad.text).toContain('daemon docker mati');
  });

  it('runFailedMessage & breakerMessage memuat detail (dipotong bila panjang)', () => {
    const failed = runFailedMessage('run_x', new Error('boom'));
    expect(failed.kind).toBe('run_failed');
    expect(failed.level).toBe('error');
    expect(failed.text).toContain('boom');

    const long = runFailedMessage('run_x', new Error('e'.repeat(900)));
    expect(long.text.length).toBeLessThanOrEqual(500);

    const breaker = breakerMessage('run_x', 'safe-build aktif setelah 5x QA');
    expect(breaker.kind).toBe('circuit_breaker');
    expect(breaker.level).toBe('warn');
    expect(breaker.text).toContain('5x QA');
  });
});

describe('notify: driver stub', () => {
  it('mencatat pesan + mode stub tanpa network', async () => {
    const stub = new StubNotifier();
    const result = await stub.send(saleMessage(SALE));
    expect(result).toEqual({ sent: true, driver: 'stub', mode: 'stub' });
    expect(stub.sent).toHaveLength(1);
    expect(stub.sent[0]?.kind).toBe('sale');
  });
});

describe('notify: driver Telegram', () => {
  it('POST sendMessage dengan chat_id + text, mengembalikan message_id', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, result: { message_id: 42 } }),
      } as unknown as Response),
    ) as unknown as typeof fetch;

    const tg = new TelegramNotifier({ token: 'tok123', chatId: '777', fetchImpl });
    const result = await tg.send(saleMessage(SALE));

    expect(result).toEqual({ sent: true, driver: 'telegram', mode: 'live', id: '42' });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.telegram.org/bottok123/sendMessage');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body)) as { chat_id: string; text: string };
    expect(body.chat_id).toBe('777');
    expect(body.text).toContain('$149.00');
  });

  it('HTTP error / network error → sent:false + error, tidak melempar', async () => {
    const failing = vi.fn(async () =>
      Promise.resolve({ ok: false, status: 502 } as unknown as Response),
    ) as unknown as typeof fetch;
    const denied = await new TelegramNotifier({ token: 't', chatId: 'c', fetchImpl: failing }).send(
      breakerMessage('run_x', 'trip'),
    );
    expect(denied.sent).toBe(false);
    expect(denied.error).toBe('HTTP 502');

    const throwing = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const down = await new TelegramNotifier({ token: 't', chatId: 'c', fetchImpl: throwing }).send(
      breakerMessage('run_x', 'trip'),
    );
    expect(down.sent).toBe(false);
    expect(down.error).toContain('ECONNREFUSED');
  });
});

describe('notify: driver Discord', () => {
  it('POST webhook dengan content, sukses → sent:true', async () => {
    const fetchImpl = vi.fn(async () =>
      Promise.resolve({ ok: true, status: 204 } as unknown as Response),
    ) as unknown as typeof fetch;

    const discord = new DiscordNotifier({
      webhookUrl: 'https://discord.com/api/webhooks/x/y',
      fetchImpl,
    });
    const result = await discord.send(deployMessage(DEPLOY));
    expect(result).toEqual({ sent: true, driver: 'discord', mode: 'live' });

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain('discord.com/api/webhooks');
    expect(JSON.parse(String(init.body))).toMatchObject({
      content: expect.stringContaining('ready'),
    });
  });
});

describe('notify: factory createNotifier', () => {
  const base = {
    notifyDriver: 'auto' as const,
    telegramBotToken: undefined,
    telegramChatId: undefined,
    discordWebhookUrl: undefined,
  };

  it('tanpa kredensial → stub', () => {
    expect(createNotifier({ ...base, notifyDriver: 'stub' }).id).toBe('stub');
  });

  it('telegram terpilih + kredensial → TelegramNotifier', () => {
    const driver = createNotifier({
      ...base,
      notifyDriver: 'telegram',
      telegramBotToken: 't',
      telegramChatId: 'c',
    });
    expect(driver.id).toBe('telegram');
    expect(driver.mode).toBe('live');
  });

  it('discord terpilih + webhook → DiscordNotifier', () => {
    const driver = createNotifier({
      ...base,
      notifyDriver: 'discord',
      discordWebhookUrl: 'https://discord.com/api/webhooks/x/y',
    });
    expect(driver.id).toBe('discord');
  });

  it('driver live tanpa kredensial (defensif) → fallback stub, tidak melempar', () => {
    expect(createNotifier({ ...base, notifyDriver: 'telegram' }).id).toBe('stub');
    expect(createNotifier({ ...base, notifyDriver: 'discord' }).id).toBe('stub');
  });
});
