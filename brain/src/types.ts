/**
 * Kontrak payload realtime AutoOffice3D — Single Source of Truth: PRD §5.
 * File ini sengaja tidak meng-import apa pun agar bisa di-duplikasi aman
 * ke repo frontend (theater) tanpa dependency silang (PRD §2 — non-monorepo).
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

export const ZONES = [
  'founder_desk',
  'meeting_room',
  'dev_lab',
  'marketing_studio',
  'devops_hub',
  'central_bus',
] as const;
export type TargetZone = (typeof ZONES)[number];

export interface Telemetry {
  tokensUsed: number;
  latencyMs: number;
  model: string;
}

/** PRD §5.1 */
export interface AgentStatusPayload {
  runId: string;
  agentId: AgentId;
  division: Division;
  currentAction: CurrentAction;
  targetZone: TargetZone;
  coordinates?: { x: number; y: number; z: number };
  logMessage: string;
  iterationCycle?: { current: number; max: number };
  telemetry: Telemetry;
  timestamp: string;
}

/** PRD §5.2 */
export interface FirstSalePayload {
  runId: string;
  customer: { city: string; country: string; maskedEmail: string };
  amount: number;
  currency: 'USD';
  stripeEventId: string;
  hasCustomers: true;
  timestamp: string;
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

export interface BuildStep {
  label: string;
  status: BuildStepStatus;
}

export interface HealthReport {
  rootOk: boolean;
  apiOk: boolean;
  sslValid: boolean;
  ttfbMs: number;
}

/** `deploy:update` — pipeline GitHub → Vercel → Health Check (PRD §3.3). */
export interface DeployUpdatePayload {
  runId: string;
  repoName: string;
  repoUrl: string;
  liveUrl: string;
  status: DeployStatus;
  buildSteps: BuildStep[];
  health: HealthReport | null;
  uptimeS: number;
  bandwidthMb: number;
  edgeCache: boolean;
  degradedReason?: string;
  timestamp: string;
}

/** `revenue:update` — metrik Stripe Webhook Sentinel (PRD §3.4). */
export interface RevenueUpdatePayload {
  runId: string;
  activeVisitors: number;
  checkoutSessions: number;
  grossRevenueArr: number;
  salesCount: number;
  lastStripeEvent: string;
  signatureVerified: boolean;
  timestamp: string;
}

export const SOCIAL_PLATFORMS = ['x', 'threads'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_STATUSES = ['published', 'scheduled'] as const;
export type SocialStatus = (typeof SOCIAL_STATUSES)[number];

/** `social:post` — hasil Social Campaign Dispatcher (PRD §3.4). */
export interface SocialPostPayload {
  runId: string;
  platform: SocialPlatform;
  status: SocialStatus;
  queueId: string;
  thread: string[];
  hook: string;
  metrics: { impressions: number; clicks: number; retweets: number };
  sentiment: 'positive' | 'neutral' | 'negative';
  timestamp: string;
}

/** PRD §4.1 — Zone Coordinates Matrix (origin di pusat Neural Bus). */
export const ZONE_COORDINATES: Record<TargetZone, { x: number; y: number; z: number }> = {
  founder_desk: { x: -14, y: 0.4, z: 14 },
  meeting_room: { x: -13, y: 0.4, z: -13 },
  dev_lab: { x: 14, y: 0.4, z: -12 },
  marketing_studio: { x: 14, y: 0.4, z: 12 },
  devops_hub: { x: 0, y: 0.4, z: 16 },
  central_bus: { x: 0, y: 0.4, z: 0 },
};

export const ZONE_LABEL: Record<TargetZone, string> = {
  founder_desk: 'ZONE 01 // FOUNDER DESK',
  meeting_room: 'ZONE 02 // STRATEGY ROOM',
  dev_lab: 'ZONE 03 // CORE DEV & QA LAB',
  marketing_studio: 'ZONE 04 // CREATIVE & MARKETING STUDIO',
  devops_hub: 'ZONE 05 // DEVOPS & CLOUD HUB',
  central_bus: 'HUB 00 // CENTRAL NEURAL BUS',
};

export const AGENT_DIVISION: Record<AgentId, Division> = {
  founder_agent: 'Product',
  pm_agent: 'Product',
  dev_agent: 'Engineering',
  qa_agent: 'QA',
  devops_agent: 'DevOps',
  marketing_agent: 'Growth',
};

export const AGENT_HOME_ZONE: Record<AgentId, TargetZone> = {
  founder_agent: 'founder_desk',
  pm_agent: 'meeting_room',
  dev_agent: 'dev_lab',
  qa_agent: 'dev_lab',
  devops_agent: 'devops_hub',
  marketing_agent: 'marketing_studio',
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function timestampMs(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
