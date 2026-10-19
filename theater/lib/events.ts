import { z } from 'zod';

/**
 * Kontrak realtime PRD §5.1/§5.2 — DUPLIKASI terkontrol dari
 * `brain/src/server/contract.ts`. Sengaja tanpa import silang (PRD §2: dua
 * aplikasi terpisah). Skema & type wajib identik; test di `tests/events.test.ts`
 * memastikan fixture yang sama diterima kedua sisi.
 */

export const AGENT_IDS = [
  'founder_agent',
  'pm_agent',
  'dev_agent',
  'qa_agent',
  'devops_agent',
  'marketing_agent',
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export const DIVISIONS = ['Product', 'Engineering', 'QA', 'DevOps', 'Growth'] as const;
export type Division = (typeof DIVISIONS)[number];

export const ACTIONS = [
  'idle',
  'walking',
  'discussing',
  'coding',
  'testing',
  'deploying',
  'marketing',
  'celebrating',
] as const;
export type CurrentAction = (typeof ACTIONS)[number];

export const ZONE_KEYS = [
  'founder_desk',
  'meeting_room',
  'dev_lab',
  'marketing_studio',
  'devops_hub',
  'central_bus',
] as const;
export type TargetZone = (typeof ZONE_KEYS)[number];

export const AgentStatusSchema = z.object({
  runId: z.string().min(1),
  agentId: z.enum(AGENT_IDS),
  division: z.enum(DIVISIONS),
  currentAction: z.enum(ACTIONS),
  targetZone: z.enum(ZONE_KEYS),
  coordinates: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
  logMessage: z.string(),
  iterationCycle: z
    .object({ current: z.number().int().nonnegative(), max: z.number().int().positive() })
    .optional(),
  telemetry: z.object({
    tokensUsed: z.number().nonnegative(),
    latencyMs: z.number().nonnegative(),
    model: z.string().min(1),
  }),
  timestamp: z.string().min(1),
});
export type AgentStatusPayload = z.infer<typeof AgentStatusSchema>;

export const FirstSaleSchema = z.object({
  runId: z.string().min(1),
  customer: z.object({
    city: z.string().min(1),
    country: z.string().min(1),
    maskedEmail: z.string().min(1),
  }),
  amount: z.number().positive(),
  currency: z.literal('USD'),
  stripeEventId: z.string().min(1),
  hasCustomers: z.literal(true),
  timestamp: z.string().min(1),
});
export type FirstSalePayload = z.infer<typeof FirstSaleSchema>;

export type ContractParse<T> = { ok: true; payload: T } | { ok: false; issues: string };

export function parseAgentStatus(raw: unknown): ContractParse<AgentStatusPayload> {
  const parsed = AgentStatusSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; '),
    };
  }
  return { ok: true, payload: parsed.data };
}

export function parseFirstSale(raw: unknown): ContractParse<FirstSalePayload> {
  const parsed = FirstSaleSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; '),
    };
  }
  return { ok: true, payload: parsed.data };
}

/* ───────── Fase 4 — Integrations & Revenue Loop (PRD §3.3, §3.4) ───────── */

export const DEPLOY_STATUSES = [
  'provisioning',
  'building',
  'deploying',
  'ready',
  'degraded',
] as const;
export type DeployStatus = (typeof DEPLOY_STATUSES)[number];

export const BUILD_STEP_STATUSES = ['pending', 'running', 'done'] as const;
export type BuildStepStatus = (typeof BUILD_STEP_STATUSES)[number];

export const BuildStepSchema = z.object({
  label: z.string().min(1),
  status: z.enum(BUILD_STEP_STATUSES),
});
export type BuildStep = z.infer<typeof BuildStepSchema>;

export const HealthReportSchema = z.object({
  rootOk: z.boolean(),
  apiOk: z.boolean(),
  sslValid: z.boolean(),
  ttfbMs: z.number().nonnegative(),
});
export type HealthReport = z.infer<typeof HealthReportSchema>;

export const DeployUpdateSchema = z.object({
  runId: z.string().min(1),
  repoName: z.string().min(1),
  repoUrl: z.string(),
  liveUrl: z.string(),
  status: z.enum(DEPLOY_STATUSES),
  buildSteps: z.array(BuildStepSchema),
  health: HealthReportSchema.nullable(),
  uptimeS: z.number().nonnegative().default(0),
  bandwidthMb: z.number().nonnegative().default(0),
  edgeCache: z.boolean().default(false),
  degradedReason: z.string().optional(),
  timestamp: z.string().min(1),
});
export type DeployUpdatePayload = z.infer<typeof DeployUpdateSchema>;

export const RevenueUpdateSchema = z.object({
  runId: z.string().min(1),
  activeVisitors: z.number().nonnegative(),
  checkoutSessions: z.number().nonnegative(),
  grossRevenueArr: z.number().nonnegative(),
  salesCount: z.number().nonnegative(),
  lastStripeEvent: z.string(),
  signatureVerified: z.boolean(),
  timestamp: z.string().min(1),
});
export type RevenueUpdatePayload = z.infer<typeof RevenueUpdateSchema>;

export const SOCIAL_PLATFORMS = ['x', 'threads'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export const SOCIAL_STATUSES = ['published', 'scheduled'] as const;
export type SocialStatus = (typeof SOCIAL_STATUSES)[number];

export const SocialPostSchema = z.object({
  runId: z.string().min(1),
  platform: z.enum(SOCIAL_PLATFORMS),
  status: z.enum(SOCIAL_STATUSES),
  queueId: z.string().min(1),
  thread: z.array(z.string()),
  hook: z.string(),
  metrics: z.object({
    impressions: z.number().nonnegative(),
    clicks: z.number().nonnegative(),
    retweets: z.number().nonnegative(),
  }),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  timestamp: z.string().min(1),
});
export type SocialPostPayload = z.infer<typeof SocialPostSchema>;

function issuesOf(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

export function parseDeployUpdate(raw: unknown): ContractParse<DeployUpdatePayload> {
  const parsed = DeployUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  return { ok: true, payload: parsed.data };
}

export function parseRevenueUpdate(raw: unknown): ContractParse<RevenueUpdatePayload> {
  const parsed = RevenueUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  return { ok: true, payload: parsed.data };
}

export function parseSocialPost(raw: unknown): ContractParse<SocialPostPayload> {
  const parsed = SocialPostSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  return { ok: true, payload: parsed.data };
}

/** `memory:retrieval` — stream ingatan semantik (skor cosine) untuk Vector DB inspector. */
export const MemoryRetrievalSchema = z.object({
  runId: z.string().min(1),
  namespace: z.string().min(1),
  query: z.string(),
  topId: z.string().nullable(),
  topScore: z.number().min(-1).max(1),
  hits: z.number().nonnegative(),
  timestamp: z.string().min(1),
});
export type MemoryRetrievalPayload = z.infer<typeof MemoryRetrievalSchema>;

export function parseMemoryRetrieval(raw: unknown): ContractParse<MemoryRetrievalPayload> {
  const parsed = MemoryRetrievalSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  return { ok: true, payload: parsed.data };
}

/* ───────── artifacts:ready — bundel hasil run untuk viewer Artifacts & PRD ───────── */

export const ArtifactFileDiffSchema = z.object({
  status: z.enum(['created', 'modified', 'deleted', 'unchanged']),
  added: z.number().nonnegative(),
  removed: z.number().nonnegative(),
});

export const ArtifactsSchema = z.object({
  runId: z.string().min(1),
  projectName: z.string(),
  prd: z.string(),
  files: z.array(
    z.object({ path: z.string().min(1), content: z.string(), diff: ArtifactFileDiffSchema }),
  ),
  qaSummary: z.string(),
  qaPassed: z.boolean(),
  cycles: z.number().nonnegative(),
  maxCycles: z.number().positive(),
  tokensUsed: z.number().nonnegative(),
  liveUrl: z.string(),
  repoUrl: z.string(),
  durationMs: z.number().nonnegative(),
  timestamp: z.string().min(1),
});
export type ArtifactsPayload = z.infer<typeof ArtifactsSchema>;

export function parseArtifacts(raw: unknown): ContractParse<ArtifactsPayload> {
  const parsed = ArtifactsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  return { ok: true, payload: parsed.data };
}

/* ───────── Fase 8 — Briefing Room (PRD §3.1, §5.3) ───────── */

export const CHAT_CHANNELS = ['briefing', 'cs_widget', 'cs_whatsapp', 'cs_email'] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];
export const CHAT_AGENT_IDS = ['pm_agent', 'cs_agent'] as const;
export type ChatAgentId = (typeof CHAT_AGENT_IDS)[number];
export const BRIEF_PRESETS = ['landing', 'saas-fullstack', 'custom-app'] as const;
export type BriefPreset = (typeof BRIEF_PRESETS)[number];

/** `founder:chat` → `pm:reply` — satu turn percakapan (PRD §5.3). */
export const ChatTurnSchema = z.object({
  conversationId: z.string().min(1),
  channel: z.enum(CHAT_CHANNELS),
  role: z.enum(['human', 'agent']),
  agentId: z.enum(CHAT_AGENT_IDS).optional(),
  message: z.string().min(1),
  citations: z.array(z.string()).optional(),
  timestamp: z.string().min(1),
});
export type ChatTurnPayload = z.infer<typeof ChatTurnSchema>;

/** Hasil `brief:compile` (tombol GO) — brief terstruktur dari thread briefing. */
export const BriefSchema = z.object({
  conversationId: z.string().min(1),
  projectName: z.string().min(1),
  audience: z.string().min(1),
  features: z.array(z.string().min(1)).min(1),
  preset: z.enum(BRIEF_PRESETS),
  pricing: z.string().min(1),
  summary: z.string().min(1),
  directive: z.string().min(1),
  timestamp: z.string().min(1),
});
export type BriefPayload = z.infer<typeof BriefSchema>;

export function parseChatTurn(raw: unknown): ContractParse<ChatTurnPayload> {
  const parsed = ChatTurnSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  return { ok: true, payload: parsed.data };
}

export function parseBrief(raw: unknown): ContractParse<BriefPayload> {
  const parsed = BriefSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: issuesOf(parsed.error) };
  return { ok: true, payload: parsed.data };
}
