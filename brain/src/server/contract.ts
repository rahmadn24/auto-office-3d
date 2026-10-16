import { z } from 'zod';

import type { AgentStatusPayload, FirstSalePayload } from '../types';

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
