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

/** PRD §5.2 — gateway pembayaran ternormalisasi (Fase 9: Payment Abstraction). */
export const PAYMENT_PROVIDERS = ['stripe', 'midtrans', 'xendit', 'stub'] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number];

/** PRD §5.2 */
export interface FirstSalePayload {
  runId: string;
  customer: { city: string; country: string; maskedEmail: string };
  amount: number;
  currency: 'USD' | 'IDR';
  paymentProvider: PaymentProviderId;
  paymentEventId: string;
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

/** `revenue:update` — metrik Payment Sentinel (PRD §3.4). */
export interface RevenueUpdatePayload {
  runId: string;
  activeVisitors: number;
  checkoutSessions: number;
  grossRevenueArr: number;
  salesCount: number;
  /** Mata uang akumulasi `grossRevenueArr` (satu driver pembayaran per deployment). */
  currency: 'USD' | 'IDR';
  /** Event webhook terakhir dari provider pembayaran aktif. */
  lastEvent: string;
  signatureVerified: boolean;
  timestamp: string;
}

export const SOCIAL_PLATFORMS = ['x', 'threads'] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export const SOCIAL_STATUSES = ['published', 'scheduled'] as const;
export type SocialStatus = (typeof SOCIAL_STATUSES)[number];

/** `memory:retrieval` — stream ingatan semantik untuk inspector Vector DB (PRD §2.1, Milestone #3). */
export interface MemoryRetrievalPayload {
  runId: string;
  namespace: string;
  query: string;
  topId: string | null;
  topScore: number;
  hits: number;
  timestamp: string;
}

export interface ArtifactFileDiff {
  status: 'created' | 'modified' | 'deleted' | 'unchanged';
  added: number;
  removed: number;
}

/** `artifacts:ready` — bundel hasil run (PRD + berkas + diff + QA) untuk viewer (Fase 5). */
export interface ArtifactsPayload {
  runId: string;
  projectName: string;
  prd: string;
  files: Array<{ path: string; content: string; diff: ArtifactFileDiff }>;
  qaSummary: string;
  qaPassed: boolean;
  /** true bila QA gagal 5 siklus dan graph memakai safe-build fallback. */
  fallback?: boolean;
  cycles: number;
  maxCycles: number;
  tokensUsed: number;
  /** Estimasi biaya run (USD) dari tabel harga benchmark — Fase 13. */
  costUsd?: number;
  liveUrl: string;
  repoUrl: string;
  durationMs: number;
  timestamp: string;
}

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

/* ───────── Fase 8 — Briefing Room (PRD §3.1, §5.3) ───────── */

export const CHAT_CHANNELS = ['briefing', 'cs_widget', 'cs_whatsapp', 'cs_email'] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];

export const CHAT_AGENT_IDS = ['pm_agent', 'cs_agent'] as const;
export type ChatAgentId = (typeof CHAT_AGENT_IDS)[number];

/** Satu turn percakapan `founder:chat` → `pm:reply` (PRD §5.3, ChatTurnPayload). */
export interface ChatTurnPayload {
  conversationId: string;
  channel: ChatChannel;
  role: 'human' | 'agent';
  agentId?: ChatAgentId;
  message: string;
  /** Recall dari vector memory (briefing + pm-memory). */
  citations?: string[];
  timestamp: string;
}

export const BRIEF_PRESETS = ['landing', 'saas-fullstack', 'custom-app'] as const;
export type BriefPreset = (typeof BRIEF_PRESETS)[number];

/** Hasil `brief:compile` (tombol GO) — brief terstruktur dari thread briefing (Fase 8). */
export interface BriefPayload {
  conversationId: string;
  projectName: string;
  audience: string;
  features: string[];
  preset: BriefPreset;
  pricing: string;
  summary: string;
  /** Prompt final untuk `founder:directive` (brief + konteks diskusi). */
  directive: string;
  timestamp: string;
}

/* ───────── Fase 11 — CS Agent: Omnichannel + Closing (PRD §3.5) ───────── */

export const LEAD_SOURCES = ['widget', 'whatsapp', 'email'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'deal', 'lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Quote yang diajukan CS (dibuat saat closing flow berjalan). */
export interface LeadQuote {
  amount: number;
  currency: 'USD' | 'IDR';
  productName: string;
  checkoutUrl: string;
  contractUrl: string;
}

/**
 * Lead store bersama (mini-CRM, PRD §3.5): ditulis Marketer saat peminat
 * terdeteksi, dibaca & ditindaklanjuti CS Agent. Durable di SQLite `office.db`.
 */
export interface Lead {
  id: string;
  source: LeadSource;
  /** Identitas channel: visitor id (widget), nomor WA, atau email. */
  contact: string;
  name: string;
  interest: string;
  status: LeadStatus;
  conversationId: string;
  nextFollowupAt: string | null;
  /** Berapa kali follow-up otomatis sudah dikirim (3x tanpa balasan → lost). */
  followupsSent: number;
  quote: LeadQuote | null;
  createdAt: string;
  updatedAt: string;
}

/** `lead:update` — siaran perubahan lead ke CS Inbox Theater (Fase 11). */
export interface LeadUpdatePayload {
  lead: Lead;
  reason: 'created' | 'message' | 'status' | 'quote' | 'followup' | 'deal';
  timestamp: string;
}

/** Ringkasan satu percakapan CS untuk daftar inbox. */
export interface InboxEntry {
  lead: Lead;
  lastMessage: ChatTurnPayload | null;
  messageCount: number;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Format nominal lintas mata uang (USD `$29.00`, IDR `Rp 290.000`). */
export function formatMoney(amount: number, currency: string): string {
  return currency === 'IDR'
    ? `Rp ${Math.round(amount).toLocaleString('id-ID')}`
    : `$${amount.toFixed(2)}`;
}

export function timestampMs(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
