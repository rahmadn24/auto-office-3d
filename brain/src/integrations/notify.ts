import type { Config } from '../config';
import { logger } from '../logger';
import { formatMoney, type DeployUpdatePayload, type FirstSalePayload } from '../types';

/**
 * Notifikasi founder (PRD §7 Fase 12) — soak berhari-hari tidak perlu ditunggui:
 * milestone penjualan pertama, deploy live, run gagal, dan circuit breaker
 * dikirim keluar (Telegram / Discord) oleh driver ini.
 *
 * Driver `stub` default (tanpa kredensial) hanya mencatat; `auto` memilih
 * Telegram/Discord begitu kredensialnya ada; driver live dipaksa eksplisit
 * tanpa kredensial = gagal saat boot (lihat `config.ts` fail-fast).
 */

export type NotifyKind = 'sale' | 'deploy' | 'run_failed' | 'circuit_breaker';
export type NotifyLevel = 'info' | 'warn' | 'error';

export interface NotifyMessage {
  kind: NotifyKind;
  title: string;
  text: string;
  level?: NotifyLevel;
  url?: string;
  at?: string;
}

export interface NotifyResult {
  sent: boolean;
  driver: string;
  mode: 'stub' | 'live';
  id?: string;
  error?: string;
}

export interface NotifyDriver {
  readonly id: string;
  readonly mode: 'stub' | 'live';
  send(message: NotifyMessage): Promise<NotifyResult>;
}

export type FetchLike = typeof fetch;

const ICONS: Record<NotifyLevel, string> = { info: 'ℹ️', warn: '⚠️', error: '🚨' };

/** Satu baris teks siap kirim (dipakai Telegram/Discord & assert test). */
export function formatNotification(message: NotifyMessage): string {
  const icon = ICONS[message.level ?? 'info'];
  const lines = [`${icon} ${message.title}`, message.text];
  if (message.url) lines.push(message.url);
  return lines.join('\n');
}

function truncate(value: string, max = 500): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/* ───────── Helper pesan — dipakai titik wiring (index/socket/nodes) ───────── */

export function saleMessage(payload: FirstSalePayload): NotifyMessage {
  return {
    kind: 'sale',
    level: 'info',
    title: 'Milestone: penjualan pertama 🎉',
    text: `${formatMoney(payload.amount, payload.currency)} via ${payload.paymentProvider} · run ${payload.runId}`,
    at: payload.timestamp,
  };
}

export function deployMessage(payload: DeployUpdatePayload): NotifyMessage {
  return {
    kind: 'deploy',
    level: payload.status === 'degraded' ? 'warn' : 'info',
    title: `Deploy ${payload.status} · ${payload.repoName}`,
    text: payload.degradedReason
      ? `Degraded: ${payload.degradedReason}`
      : `Live URL siap (uptime ${payload.uptimeS}s)`,
    ...(payload.liveUrl ? { url: payload.liveUrl } : {}),
    at: payload.timestamp,
  };
}

export function runFailedMessage(runId: string, err: unknown): NotifyMessage {
  const detail = err instanceof Error ? err.message : String(err);
  return {
    kind: 'run_failed',
    level: 'error',
    title: `Run gagal · ${runId}`,
    text: truncate(`Error: ${detail}`),
    at: new Date().toISOString(),
  };
}

export function breakerMessage(runId: string, detail: string): NotifyMessage {
  return {
    kind: 'circuit_breaker',
    level: 'warn',
    title: `Circuit breaker tripped · ${runId}`,
    text: truncate(detail),
    at: new Date().toISOString(),
  };
}

/* ───────── Driver: stub (default) ───────── */

export class StubNotifier implements NotifyDriver {
  readonly id = 'stub';
  readonly mode = 'stub' as const;
  /** Riwayat pesan terakhir (dipakai test & debugging lokal). */
  readonly sent: NotifyMessage[] = [];

  async send(message: NotifyMessage): Promise<NotifyResult> {
    this.sent.push(message);
    logger.debug({ kind: message.kind, title: message.title }, 'notify (stub)');
    return { sent: true, driver: this.id, mode: this.mode };
  }
}

/* ───────── Driver: Telegram Bot API ───────── */

export interface TelegramNotifierOptions {
  token: string;
  chatId: string;
  fetchImpl?: FetchLike;
}

export class TelegramNotifier implements NotifyDriver {
  readonly id = 'telegram';
  readonly mode = 'live' as const;
  private readonly token: string;
  private readonly chatId: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: TelegramNotifierOptions) {
    this.token = opts.token;
    this.chatId = opts.chatId;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async send(message: NotifyMessage): Promise<NotifyResult> {
    try {
      const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: formatNotification(message),
          disable_web_page_preview: true,
        }),
      });
      if (!res.ok) {
        return {
          sent: false,
          driver: this.id,
          mode: this.mode,
          error: `HTTP ${res.status}`,
        };
      }
      const data = (await res.json().catch(() => ({}))) as { result?: { message_id?: number } };
      const id = data.result?.message_id;
      return {
        sent: true,
        driver: this.id,
        mode: this.mode,
        ...(id !== undefined ? { id: String(id) } : {}),
      };
    } catch (err) {
      return {
        sent: false,
        driver: this.id,
        mode: this.mode,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

/* ───────── Driver: Discord webhook ───────── */

export interface DiscordNotifierOptions {
  webhookUrl: string;
  fetchImpl?: FetchLike;
}

export class DiscordNotifier implements NotifyDriver {
  readonly id = 'discord';
  readonly mode = 'live' as const;
  private readonly webhookUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(opts: DiscordNotifierOptions) {
    this.webhookUrl = opts.webhookUrl;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async send(message: NotifyMessage): Promise<NotifyResult> {
    try {
      const res = await this.fetchImpl(this.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: formatNotification(message) }),
      });
      if (!res.ok) {
        return {
          sent: false,
          driver: this.id,
          mode: this.mode,
          error: `HTTP ${res.status}`,
        };
      }
      return { sent: true, driver: this.id, mode: this.mode };
    } catch (err) {
      return {
        sent: false,
        driver: this.id,
        mode: this.mode,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

export type NotifierConfig = Pick<
  Config,
  'notifyDriver' | 'telegramBotToken' | 'telegramChatId' | 'discordWebhookUrl'
>;

/**
 * Factory driver dari config (fail-fast kredensial sudah di `config.ts`).
 * Asumsi id live selalu punya kredensial — jaga-jaga: fallback ke stub bila
 * ternyata kosong (tanpa melempar, agar boot tidak tergantung urutan validasi).
 */
export function createNotifier(config: NotifierConfig): NotifyDriver {
  switch (config.notifyDriver) {
    case 'telegram':
      if (config.telegramBotToken && config.telegramChatId) {
        return new TelegramNotifier({
          token: config.telegramBotToken,
          chatId: config.telegramChatId,
        });
      }
      return new StubNotifier();
    case 'discord':
      if (config.discordWebhookUrl) {
        return new DiscordNotifier({ webhookUrl: config.discordWebhookUrl });
      }
      return new StubNotifier();
    default:
      return new StubNotifier();
  }
}
