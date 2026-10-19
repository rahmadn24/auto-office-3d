import { describe, expect, it } from 'vitest';

import { loadConfig } from '../src/config';

describe('config & driver resolution', () => {
  it('mode offline: tanpa API key → stub LLM, LanceDB durable, sandbox lokal', () => {
    const config = loadConfig({});
    expect(config.llmDriver).toBe('stub');
    expect(config.memoryDriver).toBe('lancedb');
    expect(config.sandboxDriver).toBe('local');
    expect(config.maxIterations).toBe(5);
    expect(config.tokenBudget).toBe(250_000);
    expect(config.sandboxTimeoutMs).toBe(60_000);
  });

  it('DATA_DIR default absolut; override dihormati (kontrak durability §2.1)', () => {
    const dflt = loadConfig({});
    expect(dflt.dataDir.endsWith('/data')).toBe(true);
    expect(dflt.dataDir.startsWith('/')).toBe(true);
    const custom = loadConfig({ DATA_DIR: '/var/ao3d' });
    expect(custom.dataDir).toBe('/var/ao3d');
  });

  it('auto: kredensial lengkap → driver produksi', () => {
    const config = loadConfig({
      ANTHROPIC_API_KEY: 'sk-ant-x',
      PINECONE_API_KEY: 'pc-x',
      PINECONE_HOST: 'https://idx.svc.pinecone.io',
      E2B_API_KEY: 'e2b-x',
    });
    expect(config.llmDriver).toBe('anthropic');
    expect(config.memoryDriver).toBe('pinecone');
    expect(config.sandboxDriver).toBe('e2b');
  });

  it('auto: sebagian kredensial → jatuh ke driver aman', () => {
    const config = loadConfig({ ANTHROPIC_API_KEY: 'sk-ant-x' });
    expect(config.llmDriver).toBe('anthropic');
    expect(config.memoryDriver).toBe('lancedb');
    expect(config.sandboxDriver).toBe('local');
  });

  it('driver eksplisit menang atas auto', () => {
    const config = loadConfig({ LLM_DRIVER: 'stub', ANTHROPIC_API_KEY: 'sk-ant-x' });
    expect(config.llmDriver).toBe('stub');
  });

  it('base URL override (9router / gateway lokal) diteruskan apa adanya', () => {
    const config = loadConfig({
      ANTHROPIC_BASE_URL: 'http://localhost:20128/v1',
      OPENAI_BASE_URL: 'http://localhost:20128/v1',
    });
    expect(config.anthropicBaseUrl).toBe('http://localhost:20128/v1');
    expect(config.openaiBaseUrl).toBe('http://localhost:20128/v1');
  });

  it('driver live dipaksa eksplisit tanpa kredensial → error jelas saat boot (fail fast)', () => {
    expect(() => loadConfig({ LLM_DRIVER: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => loadConfig({ MEMORY_DRIVER: 'pinecone' })).toThrow(/PINECONE_API_KEY/);
    expect(() => loadConfig({ SANDBOX_DRIVER: 'e2b' })).toThrow(/E2B_API_KEY/);
    expect(() => loadConfig({ DEPLOY_DRIVER: 'vercel' })).toThrow(/VERCEL_TOKEN/);
    expect(() => loadConfig({ EMAIL_DRIVER: 'resend' })).toThrow(/RESEND_API_KEY/);
    expect(() => loadConfig({ SOCIAL_DRIVER: 'live' })).toThrow(/X_BEARER_TOKEN/);
  });

  it('driver live dipaksa eksplisit dengan kredensial lengkap → lolos', () => {
    const config = loadConfig({
      LLM_DRIVER: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-ant-x',
      MEMORY_DRIVER: 'pinecone',
      PINECONE_API_KEY: 'pc-x',
      PINECONE_HOST: 'https://idx.svc.pinecone.io',
      SANDBOX_DRIVER: 'e2b',
      E2B_API_KEY: 'e2b-x',
      DEPLOY_DRIVER: 'vercel',
      VERCEL_TOKEN: 'v-x',
      EMAIL_DRIVER: 'resend',
      RESEND_API_KEY: 're-x',
      SOCIAL_DRIVER: 'live',
      X_BEARER_TOKEN: 'x-x',
    });
    expect(config.llmDriver).toBe('anthropic');
    expect(config.memoryDriver).toBe('pinecone');
    expect(config.sandboxDriver).toBe('e2b');
    expect(config.deployDriver).toBe('vercel');
    expect(config.emailDriver).toBe('resend');
    expect(config.socialDriver).toBe('live');
  });

  it('auto social: token Threads saja → tetap stub (integrasi Threads belum ada)', () => {
    expect(loadConfig({ THREADS_ACCESS_TOKEN: 'th-x' }).socialDriver).toBe('stub');
    expect(loadConfig({ X_BEARER_TOKEN: 'x-x' }).socialDriver).toBe('live');
  });

  it('auto WhatsApp: live hanya bila 3 kredensial Cloud API lengkap (Fase 11)', () => {
    expect(loadConfig({}).whatsappDriver).toBe('stub');
    expect(loadConfig({ WHATSAPP_ACCESS_TOKEN: 'wa-x' }).whatsappDriver).toBe('stub');
    const live = loadConfig({
      WHATSAPP_ACCESS_TOKEN: 'wa-x',
      WHATSAPP_PHONE_NUMBER_ID: '1234567890',
      WHATSAPP_VERIFY_TOKEN: 'vt',
    });
    expect(live.whatsappDriver).toBe('live');
    expect(live.whatsappTemplateName).toBe('hello_world');
  });

  it('WHATSAPP_DRIVER=live tanpa kredensial → fail fast saat boot', () => {
    expect(() => loadConfig({ WHATSAPP_DRIVER: 'live' })).toThrow(/WHATSAPP_ACCESS_TOKEN/);
  });

  it('default CS Agent: follow-up 60s, maks 3, URL publik/kontrak dari PORT', () => {
    const config = loadConfig({ PORT: '5555' });
    expect(config.csFollowupMs).toBe(60_000);
    expect(config.csFollowupDelayMs).toBe(600_000);
    expect(config.csMaxFollowups).toBe(3);
    expect(config.csPublicBaseUrl).toBe('http://localhost:5555');
    expect(config.csWidgetUrl).toBe('http://localhost:5555');
  });

  it('Fase 12 — notifikasi: auto pilih Telegram/Discord bila kredensial ada, default stub', () => {
    expect(loadConfig({}).notifyDriver).toBe('stub');

    const telegram = loadConfig({ TELEGRAM_BOT_TOKEN: 'tg-x', TELEGRAM_CHAT_ID: '99' });
    expect(telegram.notifyDriver).toBe('telegram');
    expect(telegram.telegramBotToken).toBe('tg-x');
    expect(telegram.telegramChatId).toBe('99');

    const discord = loadConfig({ DISCORD_WEBHOOK_URL: 'https://discord.com/api/webhooks/x/y' });
    expect(discord.notifyDriver).toBe('discord');

    // Token Telegram tanpa chat id belum lengkap → tetap stub (bukan live separuh).
    expect(loadConfig({ TELEGRAM_BOT_TOKEN: 'tg-x' }).notifyDriver).toBe('stub');
  });

  it('Fase 12 — NOTIFY_DRIVER live tanpa kredensial → fail fast saat boot', () => {
    expect(() => loadConfig({ NOTIFY_DRIVER: 'telegram' })).toThrow(/TELEGRAM_BOT_TOKEN/);
    expect(() => loadConfig({ NOTIFY_DRIVER: 'discord' })).toThrow(/DISCORD_WEBHOOK_URL/);
    const ok = loadConfig({
      NOTIFY_DRIVER: 'telegram',
      TELEGRAM_BOT_TOKEN: 't',
      TELEGRAM_CHAT_ID: 'c',
    });
    expect(ok.notifyDriver).toBe('telegram');
  });

  it('Fase 12 — LOG_LEVEL & BRAIN_AUTH_TOKEN diteruskan (fallback aman)', () => {
    expect(loadConfig({}).logLevel).toBe('info');
    expect(loadConfig({ LOG_LEVEL: 'debug' }).logLevel).toBe('debug');
    expect(loadConfig({ LOG_LEVEL: 'verbose' }).logLevel).toBe('info');
    expect(loadConfig({}).authToken).toBeUndefined();
    expect(loadConfig({ BRAIN_AUTH_TOKEN: 'rahasia' }).authToken).toBe('rahasia');
    expect(loadConfig({}).demoBaseDomain).toBeUndefined();
    expect(loadConfig({ DEMO_BASE_DOMAIN: '.demo.example.com.' }).demoBaseDomain).toBe(
      'demo.example.com',
    );
  });
});
