import { z } from 'zod';

import type {
  AgentStatusPayload,
  DeployUpdatePayload,
  FirstSalePayload,
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
  currency: z.literal('USD'),
  stripeEventId: z.string().min(1),
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
  lastStripeEvent: z.string(),
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
