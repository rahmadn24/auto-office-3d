import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4800),
  SOCKET_PATH: z.string().default('/brain-server'),

  // LLM
  LLM_DRIVER: z.enum(['auto', 'stub', 'anthropic']).default('auto'),
  ANTHROPIC_API_KEY: z.string().optional(),
  MODEL: z.string().default('claude-3-5-sonnet-latest'),

  // Memory
  MEMORY_DRIVER: z.enum(['auto', 'memory', 'pinecone']).default('auto'),
  OPENAI_API_KEY: z.string().optional(),
  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  PINECONE_API_KEY: z.string().optional(),
  PINECONE_HOST: z.string().optional(),

  // Sandbox
  SANDBOX_DRIVER: z.enum(['auto', 'local', 'e2b']).default('auto'),
  SANDBOX_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  E2B_API_KEY: z.string().optional(),

  // Integrations (PRD §3.3 & §3.4) — driver offline default, live env-gated
  DEPLOY_DRIVER: z.enum(['auto', 'local', 'vercel']).default('auto'),
  GITHUB_TOKEN: z.string().optional(),
  VERCEL_TOKEN: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  EMAIL_DRIVER: z.enum(['auto', 'stub', 'resend']).default('auto'),
  RESEND_API_KEY: z.string().optional(),
  SOCIAL_DRIVER: z.enum(['auto', 'stub', 'live']).default('auto'),
  X_BEARER_TOKEN: z.string().optional(),
  THREADS_ACCESS_TOKEN: z.string().optional(),

  // Guardrails (PRD §3.2 & §6.4)
  MAX_ITERATIONS: z.coerce.number().int().positive().default(5),
  TOKEN_BUDGET: z.coerce.number().int().positive().default(250_000),
});

export type RawEnv = z.input<typeof EnvSchema>;

export interface Config {
  port: number;
  socketPath: string;
  llmDriver: 'stub' | 'anthropic';
  anthropicApiKey?: string;
  model: string;
  memoryDriver: 'memory' | 'pinecone';
  openaiApiKey?: string;
  embeddingModel: string;
  pineconeApiKey?: string;
  pineconeHost?: string;
  sandboxDriver: 'local' | 'e2b';
  sandboxTimeoutMs: number;
  e2bApiKey?: string;
  deployDriver: 'local' | 'vercel';
  githubToken?: string;
  vercelToken?: string;
  stripeWebhookSecret?: string;
  emailDriver: 'stub' | 'resend';
  resendApiKey?: string;
  socialDriver: 'stub' | 'live';
  xBearerToken?: string;
  threadsAccessToken?: string;
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
        : 'memory'
      : e.MEMORY_DRIVER;
  const sandboxDriver =
    e.SANDBOX_DRIVER === 'auto' ? (e.E2B_API_KEY ? 'e2b' : 'local') : e.SANDBOX_DRIVER;
  const deployDriver =
    e.DEPLOY_DRIVER === 'auto' ? (e.VERCEL_TOKEN ? 'vercel' : 'local') : e.DEPLOY_DRIVER;
  const emailDriver =
    e.EMAIL_DRIVER === 'auto' ? (e.RESEND_API_KEY ? 'resend' : 'stub') : e.EMAIL_DRIVER;
  const socialDriver =
    e.SOCIAL_DRIVER === 'auto'
      ? e.X_BEARER_TOKEN || e.THREADS_ACCESS_TOKEN
        ? 'live'
        : 'stub'
      : e.SOCIAL_DRIVER;

  return {
    port: e.PORT,
    socketPath: e.SOCKET_PATH,
    llmDriver,
    anthropicApiKey: e.ANTHROPIC_API_KEY,
    model: e.MODEL,
    memoryDriver,
    openaiApiKey: e.OPENAI_API_KEY,
    embeddingModel: e.EMBEDDING_MODEL,
    pineconeApiKey: e.PINECONE_API_KEY,
    pineconeHost: e.PINECONE_HOST,
    sandboxDriver,
    sandboxTimeoutMs: e.SANDBOX_TIMEOUT_MS,
    e2bApiKey: e.E2B_API_KEY,
    deployDriver,
    githubToken: e.GITHUB_TOKEN,
    vercelToken: e.VERCEL_TOKEN,
    stripeWebhookSecret: e.STRIPE_WEBHOOK_SECRET,
    emailDriver,
    resendApiKey: e.RESEND_API_KEY,
    socialDriver,
    xBearerToken: e.X_BEARER_TOKEN,
    threadsAccessToken: e.THREADS_ACCESS_TOKEN,
    maxIterations: e.MAX_ITERATIONS,
    tokenBudget: e.TOKEN_BUDGET,
  };
}
