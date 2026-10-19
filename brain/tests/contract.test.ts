import { describe, expect, it } from 'vitest';

import { EventBus } from '../src/events';
import {
  parseAgentStatus,
  parseArtifacts,
  parseBrief,
  parseChatTurn,
  parseDeployUpdate,
  parseFirstSale,
  parseMemoryRetrieval,
  parseRevenueUpdate,
  parseSocialPost,
} from '../src/server/contract';
import type {
  AgentStatusPayload,
  ArtifactsPayload,
  BriefPayload,
  ChatTurnPayload,
  FirstSalePayload,
} from '../src/types';

const validStatus: AgentStatusPayload = {
  runId: 'run_x',
  agentId: 'dev_agent',
  division: 'Engineering',
  currentAction: 'coding',
  targetZone: 'dev_lab',
  coordinates: { x: 14, y: 0.4, z: -12 },
  logMessage: 'Emitting routes',
  iterationCycle: { current: 1, max: 5 },
  telemetry: { tokensUsed: 1200, latencyMs: 240, model: 'stub' },
  timestamp: '12:00:00.000',
};

const validSale: FirstSalePayload = {
  runId: 'run_x',
  customer: { city: 'San Francisco', country: 'US', maskedEmail: 'a***@x.io' },
  amount: 29,
  currency: 'USD',
  stripeEventId: 'evt_1',
  hasCustomers: true,
  timestamp: '2026-01-01T00:00:00.000Z',
};

describe('kontrak agent:status_update (PRD §5.1)', () => {
  it('payload valid lolos validasi Zod', () => {
    const r = parseAgentStatus(validStatus);
    expect(r.ok).toBe(true);
  });

  it('agentId di luar daftar ditolak', () => {
    const r = parseAgentStatus({ ...validStatus, agentId: 'hacker_agent' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues).toMatch(/agentId/);
  });

  it('currentAction di luar daftar ditolak', () => {
    const r = parseAgentStatus({ ...validStatus, currentAction: 'dancing' });
    expect(r.ok).toBe(false);
  });

  it('telemetry hilang / negatif ditolak', () => {
    const { telemetry: _t, ...without } = validStatus;
    expect(parseAgentStatus(without).ok).toBe(false);
    expect(
      parseAgentStatus({ ...validStatus, telemetry: { ...validStatus.telemetry, latencyMs: -1 } })
        .ok,
    ).toBe(false);
  });

  it('bukan objek (null/string) ditolak tanpa throw', () => {
    expect(parseAgentStatus(null).ok).toBe(false);
    expect(parseAgentStatus('boom').ok).toBe(false);
  });
});

describe('kontrak milestone:first_sale (PRD §5.2)', () => {
  it('payload valid lolos', () => {
    expect(parseFirstSale(validSale).ok).toBe(true);
  });

  it('currency bukan USD ditolak', () => {
    expect(parseFirstSale({ ...validSale, currency: 'EUR' }).ok).toBe(false);
  });

  it('hasCustomers bukan literal true ditolak', () => {
    expect(parseFirstSale({ ...validSale, hasCustomers: false }).ok).toBe(false);
  });

  it('amount nol/negatif ditolak', () => {
    expect(parseFirstSale({ ...validSale, amount: 0 }).ok).toBe(false);
    expect(parseFirstSale({ ...validSale, amount: -5 }).ok).toBe(false);
  });
});

describe('EventBus menyimpan history untuk snapshot', () => {
  it('agent & milestone tercatat', () => {
    const bus = new EventBus();
    bus.agent(validStatus);
    bus.milestone(validSale);
    expect(bus.history).toHaveLength(1);
    expect(bus.milestones).toHaveLength(1);
  });
});

/* ───────── Fase 4 — kontrak deploy/revenue/social (PRD §3.3, §3.4) ───────── */

const validDeploy = {
  runId: 'run_x',
  repoName: 'invoiceai',
  repoUrl: 'https://github.com/autooffice3d/invoiceai',
  liveUrl: 'invoiceai.vercel.app',
  status: 'ready' as const,
  buildSteps: [
    { label: 'npm run build', status: 'done' as const },
    { label: 'Compiled successfully', status: 'done' as const },
  ],
  health: { rootOk: true, apiOk: true, sslValid: true, ttfbMs: 24 },
  uptimeS: 0,
  bandwidthMb: 0.12,
  edgeCache: true,
  timestamp: '2026-01-01T00:00:00.000Z',
};

const validRevenue = {
  runId: 'run_x',
  activeVisitors: 12,
  checkoutSessions: 3,
  grossRevenueArr: 29,
  salesCount: 1,
  lastStripeEvent: 'checkout.session.completed · cus_1',
  signatureVerified: true,
  timestamp: '2026-01-01T00:00:00.000Z',
};

const validSocial = {
  runId: 'run_x',
  platform: 'x' as const,
  status: 'published' as const,
  queueId: 'q_x_1',
  thread: ['hook', 'line'],
  hook: 'shipped',
  metrics: { impressions: 100, clicks: 5, retweets: 2 },
  sentiment: 'positive' as const,
  timestamp: '2026-01-01T00:00:00.000Z',
};

describe('kontrak deploy:update (PRD §3.3)', () => {
  it('payload valid diterima', () => {
    expect(parseDeployUpdate(validDeploy).ok).toBe(true);
  });
  it('status di luar daftar ditolak', () => {
    expect(parseDeployUpdate({ ...validDeploy, status: 'nope' }).ok).toBe(false);
  });
  it('health null diperbolehkan (saat building)', () => {
    expect(parseDeployUpdate({ ...validDeploy, health: null }).ok).toBe(true);
  });
  it('build step status tak valid ditolak', () => {
    expect(
      parseDeployUpdate({
        ...validDeploy,
        buildSteps: [{ label: 'x', status: 'weird' }],
      }).ok,
    ).toBe(false);
  });
});

describe('kontrak revenue:update (PRD §3.4)', () => {
  it('payload valid diterima', () => {
    expect(parseRevenueUpdate(validRevenue).ok).toBe(true);
  });
  it('signatureVerified bukan boolean ditolak', () => {
    expect(parseRevenueUpdate({ ...validRevenue, signatureVerified: 'yes' }).ok).toBe(false);
  });
  it('negatif ditolak', () => {
    expect(parseRevenueUpdate({ ...validRevenue, grossRevenueArr: -1 }).ok).toBe(false);
  });
});

describe('kontrak social:post (PRD §3.4)', () => {
  it('payload valid diterima', () => {
    expect(parseSocialPost(validSocial).ok).toBe(true);
  });
  it('platform di luar x/threads ditolak', () => {
    expect(parseSocialPost({ ...validSocial, platform: 'facebook' }).ok).toBe(false);
  });
  it('sentiment di luar daftar ditolak', () => {
    expect(parseSocialPost({ ...validSocial, sentiment: 'angry' }).ok).toBe(false);
  });
});

describe('EventBus Fase 4 menyimpan deploy/revenue/social', () => {
  it('tercatat untuk snapshot', () => {
    const bus = new EventBus();
    bus.deploy(validDeploy);
    bus.revenue(validRevenue);
    bus.social(validSocial);
    expect(bus.deployments).toHaveLength(1);
    expect(bus.revenues).toHaveLength(1);
    expect(bus.socialPosts).toHaveLength(1);
  });
});

/* ───────── Fase 5 — kontrak memory:retrieval (Vector DB inspector) ───────── */

const validRetrieval = {
  runId: 'run_x',
  namespace: 'pm-memory',
  query: 'invoice export limit',
  topId: 'seed:prd-standard',
  topScore: 0.91,
  hits: 3,
  timestamp: '2026-01-01T00:00:00.000Z',
};

describe('kontrak memory:retrieval (PRD §2.1, Milestone #3)', () => {
  it('payload valid diterima', () => {
    expect(parseMemoryRetrieval(validRetrieval).ok).toBe(true);
  });
  it('topScore di luar [-1,1] ditolak', () => {
    expect(parseMemoryRetrieval({ ...validRetrieval, topScore: 1.5 }).ok).toBe(false);
  });
  it('topId null diperbolehkan (tak ada hasil)', () => {
    expect(parseMemoryRetrieval({ ...validRetrieval, topId: null }).ok).toBe(true);
  });
  it('hits negatif ditolak', () => {
    expect(parseMemoryRetrieval({ ...validRetrieval, hits: -1 }).ok).toBe(false);
  });
  it('EventBus menyimpan retrievals', () => {
    const bus = new EventBus();
    bus.retrieval(validRetrieval);
    expect(bus.retrievals).toHaveLength(1);
  });
});

/* ───────── Fase 5 — kontrak artifacts:ready (viewer Artifacts & PRD) ───────── */

const validArtifacts: ArtifactsPayload = {
  runId: 'run_x',
  projectName: 'Invoice AI',
  prd: '# PRD\n## Executive Summary',
  files: [
    {
      path: 'src/index.ts',
      content: 'export {};',
      diff: { status: 'created', added: 12, removed: 0 },
    },
  ],
  qaSummary: 'Passed 18/18 tests · stmts 100%',
  qaPassed: true,
  cycles: 1,
  maxCycles: 5,
  tokensUsed: 4200,
  liveUrl: 'invoiceai.vercel.app',
  repoUrl: 'https://github.com/x/invoiceai',
  durationMs: 180_000,
  timestamp: '2026-01-01T00:00:00.000Z',
};

describe('kontrak artifacts:ready (Fase 5 viewer)', () => {
  it('payload valid diterima', () => {
    expect(parseArtifacts(validArtifacts).ok).toBe(true);
  });
  it('status diff di luar enum ditolak', () => {
    const bad = {
      ...validArtifacts,
      files: [{ ...validArtifacts.files[0], diff: { status: 'x', added: 1, removed: 0 } }],
    };
    expect(parseArtifacts(bad).ok).toBe(false);
  });
  it('cycles negatif ditolak', () => {
    expect(parseArtifacts({ ...validArtifacts, cycles: -1 }).ok).toBe(false);
  });
  it('EventBus menyiarkan artifacts', () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.onArtifacts((p) => seen.push(p.runId));
    bus.artifacts(validArtifacts);
    expect(seen).toEqual(['run_x']);
  });
});

/* ───────── Fase 8 — kontrak founder:chat / pm:reply & brief:compile (PRD §5.3) ───────── */

const validChatTurn: ChatTurnPayload = {
  conversationId: 'conv_1',
  channel: 'briefing',
  role: 'agent',
  agentId: 'pm_agent',
  message: 'Noted — sebelum lanjut, siapa audience utamanya?',
  citations: ['pm-memory[seed:persona]: technical founders'],
  timestamp: '2026-01-01T00:00:00.000Z',
};

const validBrief: BriefPayload = {
  conversationId: 'conv_1',
  projectName: 'Invoice Engine',
  audience: 'freelancers & small agencies',
  features: ['invoice generator', 'stripe checkout'],
  preset: 'saas-fullstack',
  pricing: '$19/mo',
  summary: 'Brief dari diskusi Founder↔PM',
  directive: 'Bangun Invoice Engine end-to-end.',
  timestamp: '2026-01-01T00:00:00.000Z',
};

describe('kontrak founder:chat / pm:reply — ChatTurnPayload (PRD §5.3)', () => {
  it('payload valid diterima', () => {
    expect(parseChatTurn(validChatTurn).ok).toBe(true);
  });
  it('channel di luar daftar ditolak', () => {
    expect(parseChatTurn({ ...validChatTurn, channel: 'telegram' }).ok).toBe(false);
  });
  it('agentId di luar pm_agent/cs_agent ditolak', () => {
    expect(parseChatTurn({ ...validChatTurn, agentId: 'dev_agent' }).ok).toBe(false);
  });
  it('message kosong ditolak', () => {
    expect(parseChatTurn({ ...validChatTurn, message: '' }).ok).toBe(false);
  });
  it('citations opsional', () => {
    const { citations: _citations, ...rest } = validChatTurn;
    expect(parseChatTurn(rest).ok).toBe(true);
  });
});

describe('kontrak brief:compile — BriefPayload (Fase 8 GO)', () => {
  it('payload valid diterima', () => {
    expect(parseBrief(validBrief).ok).toBe(true);
  });
  it('preset di luar enum ditolak', () => {
    expect(parseBrief({ ...validBrief, preset: 'monolith' }).ok).toBe(false);
  });
  it('features kosong ditolak (brief harus punya isi)', () => {
    expect(parseBrief({ ...validBrief, features: [] }).ok).toBe(false);
  });
  it('directive kosong ditolak', () => {
    expect(parseBrief({ ...validBrief, directive: '' }).ok).toBe(false);
  });
});
