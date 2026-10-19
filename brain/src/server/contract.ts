import { z } from 'zod';

import type { PaymentLinkPayload } from '../payments/provider';
import { PAYMENT_PROVIDERS } from '../types';
import type {
  AgentStatusPayload,
  ArtifactsPayload,
  BriefPayload,
  ChatTurnPayload,
  DeployUpdatePayload,
  FirstSalePayload,
  Lead,
  LeadUpdatePayload,
  MemoryRetrievalPayload,
  RevenueUpdatePayload,
  SocialPostPayload,
} from '../types';

/**
 * Validasi runtime kontrak realtime PRD §5.1/§5.2 (sisi server).
 * Duplikasi terkontrol: skema identik ada di `theater/lib/events.ts` —
 * sengaja tanpa import silang (PRD §2: dua aplikasi, kontrak disalin & dites dua kali).
 */

export const AGENT_IDS = [
  'founder_agent',
  'pm_agent',
  'dev_agent',
  'qa_agent',
  'devops_agent',
  'marketing_agent',
] as const;

export const DIVISIONS = ['Product', 'Engineering', 'QA', 'DevOps', 'Growth'] as const;

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

export const ZONES = [
  'founder_desk',
  'meeting_room',
  'dev_lab',
  'marketing_studio',
  'devops_hub',
  'central_bus',
] as const;

export const AgentStatusSchema = z.object({
  runId: z.string().min(1),
  agentId: z.enum(AGENT_IDS),
  division: z.enum(DIVISIONS),
  currentAction: z.enum(ACTIONS),
  targetZone: z.enum(ZONES),
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

export const FirstSaleSchema = z.object({
  runId: z.string().min(1),
  customer: z.object({
    city: z.string().min(1),
    country: z.string().min(1),
    maskedEmail: z.string().min(1),
  }),
  amount: z.number().positive(),
  currency: z.enum(['USD', 'IDR']),
  paymentProvider: z.enum(PAYMENT_PROVIDERS),
  paymentEventId: z.string().min(1),
  hasCustomers: z.literal(true),
  timestamp: z.string().min(1),
});

export type ContractParse<T> = { ok: true; payload: T } | { ok: false; issues: string };

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

export function parseAgentStatus(raw: unknown): ContractParse<AgentStatusPayload> {
  const parsed = AgentStatusSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) };
  return { ok: true, payload: parsed.data as AgentStatusPayload };
}

export function parseFirstSale(raw: unknown): ContractParse<FirstSalePayload> {
  const parsed = FirstSaleSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) };
  return { ok: true, payload: parsed.data as FirstSalePayload };
}

/* ───────── Fase 4 — Integrations & Revenue Loop (PRD §3.3, §3.4) ───────── */

export const DEPLOY_STATUSES = [
  'provisioning',
  'building',
  'deploying',
  'ready',
  'degraded',
] as const;

export const BUILD_STEP_STATUSES = ['pending', 'running', 'done'] as const;

export const BuildStepSchema = z.object({
  label: z.string().min(1),
  status: z.enum(BUILD_STEP_STATUSES),
});

export const HealthReportSchema = z.object({
  rootOk: z.boolean(),
  apiOk: z.boolean(),
  sslValid: z.boolean(),
  ttfbMs: z.number().nonnegative(),
});

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

export const RevenueUpdateSchema = z.object({
  runId: z.string().min(1),
  activeVisitors: z.number().nonnegative(),
  checkoutSessions: z.number().nonnegative(),
  grossRevenueArr: z.number().nonnegative(),
  salesCount: z.number().nonnegative(),
  currency: z.enum(['USD', 'IDR']),
  lastEvent: z.string(),
  signatureVerified: z.boolean(),
  timestamp: z.string().min(1),
});

export const SOCIAL_PLATFORMS = ['x', 'threads'] as const;
export const SOCIAL_STATUSES = ['published', 'scheduled'] as const;

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

export function parseDeployUpdate(raw: unknown): ContractParse<DeployUpdatePayload> {
  const parsed = DeployUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) };
  return { ok: true, payload: parsed.data as DeployUpdatePayload };
}

export function parseRevenueUpdate(raw: unknown): ContractParse<RevenueUpdatePayload> {
  const parsed = RevenueUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) };
  return { ok: true, payload: parsed.data as RevenueUpdatePayload };
}

export function parseSocialPost(raw: unknown): ContractParse<SocialPostPayload> {
  const parsed = SocialPostSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) };
  return { ok: true, payload: parsed.data as SocialPostPayload };
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

export function parseMemoryRetrieval(raw: unknown): ContractParse<MemoryRetrievalPayload> {
  const parsed = MemoryRetrievalSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) };
  return { ok: true, payload: parsed.data as MemoryRetrievalPayload };
}

/** `artifacts:ready` — bundel hasil run untuk viewer Artifacts & PRD (Fase 5). */
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

export function parseArtifacts(raw: unknown): ContractParse<ArtifactsPayload> {
  const parsed = ArtifactsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) };
  return { ok: true, payload: parsed.data as ArtifactsPayload };
}

/* ───────── Fase 8 — Briefing Room (PRD §3.1, §5.3) ───────── */

export const CHAT_CHANNELS = ['briefing', 'cs_widget', 'cs_whatsapp', 'cs_email'] as const;
export const CHAT_AGENT_IDS = ['pm_agent', 'cs_agent'] as const;
export const BRIEF_PRESETS = ['landing', 'saas-fullstack', 'custom-app'] as const;

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

export function parseChatTurn(raw: unknown): ContractParse<ChatTurnPayload> {
  const parsed = ChatTurnSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) };
  return { ok: true, payload: parsed.data as ChatTurnPayload };
}

export function parseBrief(raw: unknown): ContractParse<BriefPayload> {
  const parsed = BriefSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) };
  return { ok: true, payload: parsed.data as BriefPayload };
}

/* ───────── Fase 10 — Event Replay: run_events → socket run:replay (PRD §7) ───────── */

export const RUN_STATUSES = ['running', 'completed', 'halted', 'failed', 'interrupted'] as const;

/** Baris riwayat run (RunStore) — dikirim di snapshot & `run:list`. */
export const RunRecordSchema = z.object({
  runId: z.string().min(1),
  directive: z.string(),
  projectName: z.string(),
  status: z.enum(RUN_STATUSES),
  stage: z.string(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  tokensUsed: z.number().nonnegative(),
  liveUrl: z.string(),
  repoUrl: z.string(),
});

export const ReplayEventSchema = z.object({
  /** Posisi event dalam urutan replay (1..total). */
  seq: z.number().int().nonnegative(),
  /** id row run_events (urutan durable). */
  id: z.number().int().nonnegative(),
  ts: z.string().min(1),
  kind: z.string().min(1),
  agent: z.string().optional(),
  message: z.string().optional(),
  payload: z.unknown().optional(),
});

export const REPLAY_PHASES = ['start', 'event', 'end'] as const;

/** Satu frame playback `run:replay` (start → event* → end). */
export const ReplayFrameSchema = z.object({
  phase: z.enum(REPLAY_PHASES),
  runId: z.string().min(1),
  total: z.number().int().nonnegative(),
  /** Jumlah event yang sudah dikirim (start=0, end=total). */
  index: z.number().int().nonnegative(),
  event: ReplayEventSchema.optional(),
  timestamp: z.string().min(1),
});

export type RunRecordPayload = z.infer<typeof RunRecordSchema>;
export type ReplayEventPayload = z.infer<typeof ReplayEventSchema>;
export type ReplayFramePayload = z.infer<typeof ReplayFrameSchema>;

export function parseRunRecord(raw: unknown): ContractParse<RunRecordPayload> {
  const parsed = RunRecordSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) };
  return { ok: true, payload: parsed.data as RunRecordPayload };
}

export function parseReplayFrame(raw: unknown): ContractParse<ReplayFramePayload> {
  const parsed = ReplayFrameSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) };
  return { ok: true, payload: parsed.data as ReplayFramePayload };
}

/* ───────── Fase 11 — CS Agent: leads & closing (PRD §3.5/§5.4) ───────── */

export const LEAD_SOURCES = ['widget', 'whatsapp', 'email'] as const;
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'deal', 'lost'] as const;

export const LeadQuoteSchema = z.object({
  amount: z.number().positive(),
  currency: z.enum(['USD', 'IDR']),
  productName: z.string().min(1),
  checkoutUrl: z.string().min(1),
  contractUrl: z.string().min(1),
});

/** Lead store bersama (mini-CRM) — Marketer menulis, CS menindaklanjuti. */
export const LeadSchema = z.object({
  id: z.string().min(1),
  source: z.enum(LEAD_SOURCES),
  contact: z.string().min(1),
  name: z.string(),
  interest: z.string(),
  status: z.enum(LEAD_STATUSES),
  conversationId: z.string().min(1),
  nextFollowupAt: z.string().nullable(),
  followupsSent: z.number().int().nonnegative(),
  quote: LeadQuoteSchema.nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

/** `lead:update` — sinkronisasi CS Inbox (lead baru / perubahan status / follow-up). */
export const LeadUpdateSchema = z.object({
  lead: LeadSchema,
  reason: z.enum(['created', 'message', 'status', 'quote', 'followup', 'deal']),
  timestamp: z.string().min(1),
});

/** `payment:link_created` — payment link + kontrak PDF siap kirim (PRD §5.4). */
export const PaymentLinkSchema = z.object({
  leadId: z.string().min(1),
  provider: z.enum(PAYMENT_PROVIDERS),
  checkoutUrl: z.string().min(1),
  amount: z.number().positive(),
  currency: z.enum(['USD', 'IDR']),
  contractUrl: z.string().optional(),
  expiresAt: z.string().optional(),
  timestamp: z.string().min(1),
});

export function parseLead(raw: unknown): ContractParse<Lead> {
  const parsed = LeadSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) };
  return { ok: true, payload: parsed.data as Lead };
}

export function parseLeadUpdate(raw: unknown): ContractParse<LeadUpdatePayload> {
  const parsed = LeadUpdateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) };
  return { ok: true, payload: parsed.data as LeadUpdatePayload };
}

export function parsePaymentLink(raw: unknown): ContractParse<PaymentLinkPayload> {
  const parsed = PaymentLinkSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) };
  return { ok: true, payload: parsed.data as PaymentLinkPayload };
}
