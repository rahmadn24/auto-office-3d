import { resolve } from 'node:path';

import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4800),
  SOCKET_PATH: z.string().default('/brain-server'),

  // Durability (PRD v3.0 §2.1) — satu folder untuk seluruh state durable.
  DATA_DIR: z.string().default('data'),

  // LLM
  LLM_DRIVER: z.enum(['auto', 'stub', 'anthropic']).default('auto'),
  ANTHROPIC_API_KEY: z.string().optional(),
  /** Override endpoint Anthropic-compatible — mis. gateway lokal 9router (http://localhost:20128/v1). */
  ANTHROPIC_BASE_URL: z.string().optional(),
  MODEL: z.string().default('claude-3-5-sonnet-latest'),

  // Memory
  MEMORY_DRIVER: z.enum(['auto', 'memory', 'lancedb', 'pinecone']).default('auto'),
  OPENAI_API_KEY: z.string().optional(),
  /** Override endpoint embeddings (default https://api.openai.com/v1). */
  OPENAI_BASE_URL: z.string().optional(),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  PINECONE_API_KEY: z.string().optional(),
  PINECONE_HOST: z.string().optional(),

  // Sandbox
  SANDBOX_DRIVER: z.enum(['auto', 'local', 'e2b']).default('auto'),
  SANDBOX_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  E2B_API_KEY: z.string().optional(),

  // Integrations (PRD §3.3 & §3.4) — driver offline default, live env-gated
  DEPLOY_DRIVER: z.enum(['auto', 'local', 'vercel', 'docker']).default('auto'),
  /**
   * Interface host untuk publish port demo container (`-p host:port:container`).
   * Compose office stack memakai `0.0.0.0` supaya probe dari dalam Brain bisa
   * menjangkau instance demo lewat `DEPLOY_PROBE_HOST=host.docker.internal`.
   */
  DEPLOY_PUBLISH_HOST: z.string().default('127.0.0.1'),
  /** Host untuk URL health probe demo (Fase 10 — driver docker). */
  DEPLOY_PROBE_HOST: z.string().default('127.0.0.1'),
  GITHUB_TOKEN: z.string().optional(),
  VERCEL_TOKEN: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  PAYMENT_DRIVER: z.enum(['auto', 'stub', 'stripe', 'midtrans', 'xendit']).default('auto'),
  MIDTRANS_SERVER_KEY: z.string().optional(),
  MIDTRANS_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  XENDIT_SECRET_KEY: z.string().optional(),
  EMAIL_DRIVER: z.enum(['auto', 'stub', 'resend']).default('auto'),
  RESEND_API_KEY: z.string().optional(),
  SOCIAL_DRIVER: z.enum(['auto', 'stub', 'live']).default('auto'),
  X_BEARER_TOKEN: z.string().optional(),
  THREADS_ACCESS_TOKEN: z.string().optional(),

  // Fase 11 — CS Agent (PRD §3.5): omnichannel inbox + follow-up + closing.
  WHATSAPP_DRIVER: z.enum(['auto', 'stub', 'live']).default('auto'),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().optional(),
  /** Template HSM di luar jendela 24 jam (default template uji Meta). */
  WHATSAPP_TEMPLATE_NAME: z.string().default('hello_world'),
  /** Secret webhook email inbound (header `x-cs-inbound-secret`); kosong = demo. */
  EMAIL_INBOUND_SECRET: z.string().optional(),
  /** Interval scheduler sapu follow-up (ms). */
  CS_FOLLOWUP_MS: z.coerce.number().int().nonnegative().default(60_000),
  /** Jeda follow-up pertama setelah kontak/follow-up terakhir (ms). */
  CS_FOLLOWUP_DELAY_MS: z.coerce.number().int().positive().default(600_000),
  /** Batas follow-up otomatis sebelum lead ditandai lost. */
  CS_MAX_FOLLOWUPS: z.coerce.number().int().positive().default(3),
  /** Basis URL publik Brain untuk tautan kontrak (default http://localhost:PORT). */
  CS_PUBLIC_BASE_URL: z.string().optional(),
  /** Basis URL widget untuk halaman produk yang di-deploy (default = publik Brain). */
  CS_WIDGET_URL: z.string().optional(),

  // Guardrails (PRD §3.2 & §6.4)
  MAX_ITERATIONS: z.coerce.number().int().positive().default(5),
  TOKEN_BUDGET: z.coerce.number().int().positive().default(250_000),
});

export type RawEnv = z.input<typeof EnvSchema>;

export interface Config {
  port: number;
  socketPath: string;
  /** Folder state durable (absolut) — lancedb/ + office.db. */
  dataDir: string;
  llmDriver: 'stub' | 'anthropic';
  anthropicApiKey?: string;
  anthropicBaseUrl?: string;
  model: string;
  memoryDriver: 'memory' | 'lancedb' | 'pinecone';
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  embeddingModel: string;
  pineconeApiKey?: string;
  pineconeHost?: string;
  sandboxDriver: 'local' | 'e2b';
  sandboxTimeoutMs: number;
  e2bApiKey?: string;
  deployDriver: 'local' | 'vercel' | 'docker';
  deployPublishHost: string;
  deployProbeHost: string;
  githubToken?: string;
  vercelToken?: string;
  stripeWebhookSecret?: string;
  stripeSecretKey?: string;
  paymentDriver: 'stub' | 'stripe' | 'midtrans' | 'xendit';
  midtransServerKey?: string;
  midtransEnv: 'sandbox' | 'production';
  xenditSecretKey?: string;
  emailDriver: 'stub' | 'resend';
  resendApiKey?: string;
  socialDriver: 'stub' | 'live';
  xBearerToken?: string;
  threadsAccessToken?: string;
  whatsappDriver: 'stub' | 'live';
  whatsappAccessToken?: string;
  whatsappPhoneNumberId?: string;
  whatsappVerifyToken?: string;
  whatsappTemplateName: string;
  emailInboundSecret?: string;
  csFollowupMs: number;
  csFollowupDelayMs: number;
  csMaxFollowups: number;
  csPublicBaseUrl: string;
  csWidgetUrl: string;
  maxIterations: number;
  tokenBudget: number;
}

/**
 * Resolusi driver: `auto` memilih driver produksi hanya jika kredensial tersedia,
 * selain itu jatuh ke driver offline — sehingga sistem selalu bisa dijalankan
 * tanpa API key (mode demo/staging) tanpa kode perubahan.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  const e = parsed.data;

  const llmDriver =
    e.LLM_DRIVER === 'auto' ? (e.ANTHROPIC_API_KEY ? 'anthropic' : 'stub') : e.LLM_DRIVER;
  const memoryDriver =
    e.MEMORY_DRIVER === 'auto'
      ? e.PINECONE_API_KEY && e.PINECONE_HOST
        ? 'pinecone'
        : 'lancedb'
      : e.MEMORY_DRIVER;
  const sandboxDriver =
    e.SANDBOX_DRIVER === 'auto' ? (e.E2B_API_KEY ? 'e2b' : 'local') : e.SANDBOX_DRIVER;
  // `auto` tidak pernah memilih `docker` (butuh daemon lokal) — driver demo
  // container hanya aktif bila DEPLOY_DRIVER=docker eksplisit (Fase 10).
  const deployDriver =
    e.DEPLOY_DRIVER === 'auto' ? (e.VERCEL_TOKEN ? 'vercel' : 'local') : e.DEPLOY_DRIVER;
  // Payment Sentinel multi-provider (PRD §3.4 Fase 9): auto → gateway live
  // sesuai kredensial; default aman = driver `stub` (demo lokal tanpa akun).
  const paymentDriver =
    e.PAYMENT_DRIVER === 'auto'
      ? e.MIDTRANS_SERVER_KEY
        ? 'midtrans'
        : e.STRIPE_WEBHOOK_SECRET
          ? 'stripe'
          : 'stub'
      : e.PAYMENT_DRIVER;
  const emailDriver =
    e.EMAIL_DRIVER === 'auto' ? (e.RESEND_API_KEY ? 'resend' : 'stub') : e.EMAIL_DRIVER;
  // Threads belum diimplementasikan (integrations/social.ts) — jangan flip ke
  // `live` hanya karena token Threads ada; `live` = benar-benar posting ke X.
  const socialDriver =
    e.SOCIAL_DRIVER === 'auto' ? (e.X_BEARER_TOKEN ? 'live' : 'stub') : e.SOCIAL_DRIVER;
  // CS Agent (Fase 11): WhatsApp Cloud API live hanya bila ketiga kredensial ada.
  const whatsappDriver =
    e.WHATSAPP_DRIVER === 'auto'
      ? e.WHATSAPP_ACCESS_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID && e.WHATSAPP_VERIFY_TOKEN
        ? 'live'
        : 'stub'
      : e.WHATSAPP_DRIVER;
  const csPublicBaseUrl = (e.CS_PUBLIC_BASE_URL ?? `http://localhost:${e.PORT}`).replace(
    /\/+$/,
    '',
  );

  // Fail-fast: driver produksi dipaksa eksplisit tapi kredensial kurang = salah
  // konfigurasi, bukan fallback diam-diam. Pesan menyebut env yang harus diisi.
  const problems: string[] = [];
  if (llmDriver === 'anthropic' && !e.ANTHROPIC_API_KEY) {
    problems.push('LLM_DRIVER=anthropic butuh ANTHROPIC_API_KEY');
  }
  if (memoryDriver === 'pinecone' && !(e.PINECONE_API_KEY && e.PINECONE_HOST)) {
    problems.push('MEMORY_DRIVER=pinecone butuh PINECONE_API_KEY + PINECONE_HOST');
  }
  if (sandboxDriver === 'e2b' && !e.E2B_API_KEY) {
    problems.push('SANDBOX_DRIVER=e2b butuh E2B_API_KEY');
  }
  if (deployDriver === 'vercel' && !e.VERCEL_TOKEN) {
    problems.push('DEPLOY_DRIVER=vercel butuh VERCEL_TOKEN');
  }
  if (emailDriver === 'resend' && !e.RESEND_API_KEY) {
    problems.push('EMAIL_DRIVER=resend butuh RESEND_API_KEY');
  }
  if (paymentDriver === 'stripe' && !e.STRIPE_WEBHOOK_SECRET) {
    problems.push('PAYMENT_DRIVER=stripe butuh STRIPE_WEBHOOK_SECRET');
  }
  if (paymentDriver === 'midtrans' && !e.MIDTRANS_SERVER_KEY) {
    problems.push('PAYMENT_DRIVER=midtrans butuh MIDTRANS_SERVER_KEY');
  }
  if (paymentDriver === 'xendit' && !e.XENDIT_SECRET_KEY) {
    problems.push('PAYMENT_DRIVER=xendit butuh XENDIT_SECRET_KEY');
  }
  if (socialDriver === 'live' && !e.X_BEARER_TOKEN) {
    problems.push('SOCIAL_DRIVER=live butuh X_BEARER_TOKEN (integrasi Threads belum tersedia)');
  }
  if (
    whatsappDriver === 'live' &&
    !(e.WHATSAPP_ACCESS_TOKEN && e.WHATSAPP_PHONE_NUMBER_ID && e.WHATSAPP_VERIFY_TOKEN)
  ) {
    problems.push(
      'WHATSAPP_DRIVER=live butuh WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID + WHATSAPP_VERIFY_TOKEN',
    );
  }
  if (problems.length > 0) {
    throw new Error(`Invalid environment configuration — ${problems.join('; ')}`);
  }

  return {
    port: e.PORT,
    socketPath: e.SOCKET_PATH,
    dataDir: resolve(e.DATA_DIR),
    llmDriver,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    anthropicBaseUrl: e.ANTHROPIC_BASE_URL,
    model: e.MODEL,
    memoryDriver,
    openaiApiKey: e.OPENAI_API_KEY,
    openaiBaseUrl: e.OPENAI_BASE_URL,
    embeddingModel: e.EMBEDDING_MODEL,
    pineconeApiKey: e.PINECONE_API_KEY,
    pineconeHost: e.PINECONE_HOST,
    sandboxDriver,
    sandboxTimeoutMs: e.SANDBOX_TIMEOUT_MS,
    e2bApiKey: e.E2B_API_KEY,
    deployDriver,
    deployPublishHost: e.DEPLOY_PUBLISH_HOST,
    deployProbeHost: e.DEPLOY_PROBE_HOST,
    githubToken: e.GITHUB_TOKEN,
    vercelToken: e.VERCEL_TOKEN,
    stripeWebhookSecret: e.STRIPE_WEBHOOK_SECRET,
    stripeSecretKey: e.STRIPE_SECRET_KEY,
    paymentDriver,
    midtransServerKey: e.MIDTRANS_SERVER_KEY,
    midtransEnv: e.MIDTRANS_ENV,
    xenditSecretKey: e.XENDIT_SECRET_KEY,
    emailDriver,
    resendApiKey: e.RESEND_API_KEY,
    socialDriver,
    xBearerToken: e.X_BEARER_TOKEN,
    threadsAccessToken: e.THREADS_ACCESS_TOKEN,
    whatsappDriver,
    whatsappAccessToken: e.WHATSAPP_ACCESS_TOKEN,
    whatsappPhoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID,
    whatsappVerifyToken: e.WHATSAPP_VERIFY_TOKEN,
    whatsappTemplateName: e.WHATSAPP_TEMPLATE_NAME,
    emailInboundSecret: e.EMAIL_INBOUND_SECRET,
    csFollowupMs: e.CS_FOLLOWUP_MS,
    csFollowupDelayMs: e.CS_FOLLOWUP_DELAY_MS,
    csMaxFollowups: e.CS_MAX_FOLLOWUPS,
    csPublicBaseUrl,
    csWidgetUrl: (e.CS_WIDGET_URL ?? csPublicBaseUrl).replace(/\/+$/, ''),
    maxIterations: e.MAX_ITERATIONS,
    tokenBudget: e.TOKEN_BUDGET,
  };
}
