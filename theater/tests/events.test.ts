import { describe, expect, it } from 'vitest';

import {
  parseAgentStatus,
  parseArtifacts,
  parseBrief,
  parseBudgetUpdate,
  parseChatTurn,
  parseDeployUpdate,
  parseFirstSale,
  parseLead,
  parseLeadUpdate,
  parseMemoryRetrieval,
  parsePaymentLink,
  parseReplayFrame,
  parseRevenueUpdate,
  parseRunRecord,
  parseSocialPost,
  type AgentStatusPayload,
  type FirstSalePayload,
} from '../lib/events';

// Fixture ini sengaja identik dengan brain/tests/contract.test.ts — paritas
// duplikasi terkontrol kedua sisi kontrak (PRD §2: tanpa import silang).
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
  paymentProvider: 'stripe',
  paymentEventId: 'evt_1',
  hasCustomers: true,
  timestamp: '2026-01-01T00:00:00.000Z',
};

describe('kontrak client (duplikasi lib/events.ts)', () => {
  it('payload valid diterima', () => {
    expect(parseAgentStatus(validStatus).ok).toBe(true);
    expect(parseFirstSale(validSale).ok).toBe(true);
  });

  it('agentId / currentAction / targetZone di luar daftar ditolak', () => {
    expect(parseAgentStatus({ ...validStatus, agentId: 'bot' }).ok).toBe(false);
    expect(parseAgentStatus({ ...validStatus, currentAction: 'dancing' }).ok).toBe(false);
    expect(parseAgentStatus({ ...validStatus, targetZone: 'void' }).ok).toBe(false);
  });

  it('payload tidak valid tidak throw (ditolak + issues)', () => {
    const r = parseAgentStatus({ garbage: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.length).toBeGreaterThan(0);
    expect(parseFirstSale(null).ok).toBe(false);
    expect(parseFirstSale({ ...validSale, currency: 'EUR' }).ok).toBe(false);
    expect(parseFirstSale({ ...validSale, hasCustomers: false }).ok).toBe(false);
  });

  it('telemetry wajib & non-negatif', () => {
    const { telemetry: _t, ...without } = validStatus;
    expect(parseAgentStatus(without).ok).toBe(false);
    expect(
      parseAgentStatus({ ...validStatus, telemetry: { ...validStatus.telemetry, tokensUsed: -1 } })
        .ok,
    ).toBe(false);
  });
});

/* ───────── Fase 4 — kontrak deploy/revenue/social (paritas dgn brain) ───────── */

const validDeploy = {
  runId: 'run_x',
  repoName: 'invoiceai',
  repoUrl: 'https://github.com/autooffice3d/invoiceai',
  liveUrl: 'invoiceai.vercel.app',
  status: 'ready' as const,
  buildSteps: [{ label: 'npm run build', status: 'done' as const }],
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
  currency: 'USD',
  lastEvent: 'checkout.session.completed · cus_1',
  signatureVerified: true,
  timestamp: '2026-01-01T00:00:00.000Z',
};

const validSocial = {
  runId: 'run_x',
  platform: 'x' as const,
  status: 'published' as const,
  queueId: 'q_x_1',
  thread: ['hook'],
  hook: 'shipped',
  metrics: { impressions: 100, clicks: 5, retweets: 2 },
  sentiment: 'positive' as const,
  timestamp: '2026-01-01T00:00:00.000Z',
};

describe('kontrak deploy:update (paritas brain)', () => {
  it('valid diterima', () => expect(parseDeployUpdate(validDeploy).ok).toBe(true));
  it('status tak valid ditolak', () =>
    expect(parseDeployUpdate({ ...validDeploy, status: 'nope' }).ok).toBe(false));
  it('uptime/bandwidth/edgeCache boleh default bila hilang', () => {
    const { uptimeS: _u, bandwidthMb: _b, edgeCache: _e, ...rest } = validDeploy;
    expect(parseDeployUpdate(rest).ok).toBe(true);
  });
});

describe('kontrak revenue:update (paritas brain)', () => {
  it('valid diterima', () => expect(parseRevenueUpdate(validRevenue).ok).toBe(true));
  it('signatureVerified non-boolean ditolak', () =>
    expect(parseRevenueUpdate({ ...validRevenue, signatureVerified: 'yes' }).ok).toBe(false));
});

describe('kontrak social:post (paritas brain)', () => {
  it('valid diterima', () => expect(parseSocialPost(validSocial).ok).toBe(true));
  it('platform di luar x/threads ditolak', () =>
    expect(parseSocialPost({ ...validSocial, platform: 'facebook' }).ok).toBe(false));
});

/* ───────── Fase 5 — memory:retrieval & artifacts:ready ───────── */

const validRetrieval = {
  runId: 'run_x',
  namespace: 'pm-memory',
  query: 'invoice export limit',
  topId: 'seed:prd-standard',
  topScore: 0.91,
  hits: 3,
  timestamp: '2026-01-01T00:00:00.000Z',
};

const validArtifacts = {
  runId: 'run_x',
  projectName: 'Invoice AI',
  prd: '# PRD\n## Executive Summary',
  files: [
    {
      path: 'src/index.ts',
      content: 'export {};',
      diff: { status: 'created' as const, added: 12, removed: 0 },
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

describe('kontrak memory:retrieval (paritas brain)', () => {
  it('valid diterima', () => expect(parseMemoryRetrieval(validRetrieval).ok).toBe(true));
  it('topScore di luar [-1,1] ditolak', () =>
    expect(parseMemoryRetrieval({ ...validRetrieval, topScore: 1.4 }).ok).toBe(false));
  it('topId null diperbolehkan', () =>
    expect(parseMemoryRetrieval({ ...validRetrieval, topId: null }).ok).toBe(true));
});

describe('kontrak artifacts:ready (paritas brain)', () => {
  it('valid diterima', () => expect(parseArtifacts(validArtifacts).ok).toBe(true));
  it('status diff di luar enum ditolak', () => {
    const bad = {
      ...validArtifacts,
      files: [{ ...validArtifacts.files[0], diff: { status: 'x', added: 1, removed: 0 } }],
    };
    expect(parseArtifacts(bad).ok).toBe(false);
  });
  it('maxCycles 0 ditolak', () =>
    expect(parseArtifacts({ ...validArtifacts, maxCycles: 0 }).ok).toBe(false));
});

/* ───────── Fase 8 — founder:chat / pm:reply & brief:compile (paritas brain) ───────── */

const validChatTurn = {
  conversationId: 'conv_1',
  channel: 'briefing' as const,
  role: 'agent' as const,
  agentId: 'pm_agent' as const,
  message: 'Noted — sebelum lanjut, siapa audience utamanya?',
  citations: ['pm-memory[seed:persona]: technical founders'],
  timestamp: '2026-01-01T00:00:00.000Z',
};

const validBrief = {
  conversationId: 'conv_1',
  projectName: 'Invoice Engine',
  audience: 'freelancers & small agencies',
  features: ['invoice generator', 'stripe checkout'],
  preset: 'saas-fullstack' as const,
  pricing: '$19/mo',
  summary: 'Brief dari diskusi Founder↔PM',
  directive: 'Bangun Invoice Engine end-to-end.',
  timestamp: '2026-01-01T00:00:00.000Z',
};

describe('kontrak founder:chat / pm:reply — ChatTurnPayload (paritas brain)', () => {
  it('valid diterima', () => expect(parseChatTurn(validChatTurn).ok).toBe(true));
  it('channel di luar daftar ditolak', () =>
    expect(parseChatTurn({ ...validChatTurn, channel: 'telegram' }).ok).toBe(false));
  it('agentId non-chat ditolak', () =>
    expect(parseChatTurn({ ...validChatTurn, agentId: 'dev_agent' }).ok).toBe(false));
  it('message kosong ditolak', () =>
    expect(parseChatTurn({ ...validChatTurn, message: '' }).ok).toBe(false));
  it('citations opsional', () => {
    const { citations: _c, ...rest } = validChatTurn;
    expect(parseChatTurn(rest).ok).toBe(true);
  });
});

describe('kontrak brief:compile — BriefPayload (paritas brain)', () => {
  it('valid diterima', () => expect(parseBrief(validBrief).ok).toBe(true));
  it('preset di luar enum ditolak', () =>
    expect(parseBrief({ ...validBrief, preset: 'monolith' }).ok).toBe(false));
  it('features kosong ditolak', () =>
    expect(parseBrief({ ...validBrief, features: [] }).ok).toBe(false));
  it('directive kosong ditolak', () =>
    expect(parseBrief({ ...validBrief, directive: '' }).ok).toBe(false));
});

/* ───── Fase 10 — fixture paritas Event Replay (identik brain/tests/contract.test.ts) ───── */

const validRunRecord = {
  runId: 'run_x',
  directive: 'Build a landing page',
  projectName: 'Landing Demo',
  status: 'completed' as const,
  stage: 'done',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:05:00.000Z',
  tokensUsed: 1200,
  liveUrl: 'http://127.0.0.1:4599',
  repoUrl: 'https://github.com/demo/landing',
};

const validReplayFrame = {
  phase: 'event' as const,
  runId: 'run_x',
  total: 3,
  index: 1,
  event: {
    seq: 1,
    id: 7,
    ts: '2026-01-01T00:00:00.000Z',
    kind: 'agent',
    agent: 'pm_agent',
    message: 'PRD written',
    payload: { preset: 'landing' },
  },
  timestamp: '2026-01-01T00:00:01.000Z',
};

describe('kontrak run record & replay frame (Fase 10 — paritas brain)', () => {
  it('run record valid diterima', () => expect(parseRunRecord(validRunRecord).ok).toBe(true));
  it('status di luar enum ditolak', () =>
    expect(parseRunRecord({ ...validRunRecord, status: 'zombie' }).ok).toBe(false));
  it('frame event valid diterima', () => expect(parseReplayFrame(validReplayFrame).ok).toBe(true));
  it('frame start/end tanpa event diterima', () => {
    const { event: _event, ...rest } = validReplayFrame;
    expect(parseReplayFrame({ ...rest, phase: 'start', index: 0 }).ok).toBe(true);
    expect(parseReplayFrame({ ...rest, phase: 'end', index: 3 }).ok).toBe(true);
  });
  it('phase di luar start/event/end ditolak', () =>
    expect(parseReplayFrame({ ...validReplayFrame, phase: 'pause' }).ok).toBe(false));
});

/* ───── Fase 11 — fixture paritas CS Agent: lead & payment link (identik brain/tests/contract.test.ts) ───── */

const validLead = {
  id: 'lead_run_x_1',
  source: 'widget' as const,
  contact: 'visitor-abc',
  name: 'Rina',
  interest: 'Kampanye: invoice generator',
  status: 'qualified' as const,
  conversationId: 'cs:widget:visitor-abc',
  nextFollowupAt: '2026-01-02T00:00:00.000Z',
  followupsSent: 1,
  quote: {
    amount: 29,
    currency: 'USD' as const,
    productName: 'Invoice Generator',
    checkoutUrl: 'https://brain.example/demo/checkout?order_id=stub_1',
    contractUrl: 'https://brain.example/cs/contracts/lead_run_x_1.pdf',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:05:00.000Z',
};

const validLeadUpdate = {
  lead: validLead,
  reason: 'quote' as const,
  timestamp: '2026-01-01T00:05:00.000Z',
};

const validPaymentLink = {
  leadId: 'lead_run_x_1',
  provider: 'stub' as const,
  checkoutUrl: 'https://brain.example/demo/checkout?order_id=stub_1',
  amount: 29,
  currency: 'USD' as const,
  contractUrl: 'https://brain.example/cs/contracts/lead_run_x_1.pdf',
  expiresAt: '2026-01-08T00:00:00.000Z',
  timestamp: '2026-01-01T00:05:00.000Z',
};

describe('kontrak lead:update & payment:link_created (Fase 11 — paritas brain)', () => {
  it('lead valid diterima; lead tanpa quote (null) juga valid', () => {
    expect(parseLead(validLead).ok).toBe(true);
    expect(parseLead({ ...validLead, quote: null, status: 'new' }).ok).toBe(true);
  });
  it('source/status di luar enum ditolak', () => {
    expect(parseLead({ ...validLead, source: 'telegram' }).ok).toBe(false);
    expect(parseLead({ ...validLead, status: 'spam' }).ok).toBe(false);
  });
  it('followupsSent negatif ditolak', () =>
    expect(parseLead({ ...validLead, followupsSent: -1 }).ok).toBe(false));
  it('lead:update valid diterima; reason tak dikenal ditolak', () => {
    expect(parseLeadUpdate(validLeadUpdate).ok).toBe(true);
    expect(parseLeadUpdate({ ...validLeadUpdate, reason: 'exploded' }).ok).toBe(false);
  });
  it('payment link valid diterima; amount nol / provider asing ditolak', () => {
    expect(parsePaymentLink(validPaymentLink).ok).toBe(true);
    expect(parsePaymentLink({ ...validPaymentLink, amount: 0 }).ok).toBe(false);
    expect(parsePaymentLink({ ...validPaymentLink, provider: 'paypal' }).ok).toBe(false);
  });
});

describe('kontrak budget:update (Fase 13 — paritas brain)', () => {
  const validBudget = {
    limit: 2_000_000,
    used: 125_000,
    remaining: 1_875_000,
    exhausted: false,
    enabled: true,
    resetsAt: '2026-01-02T00:00:00.000Z',
    timestamp: '2026-01-01T12:00:00.000Z',
  };

  it('payload valid diterima; angka negatif & timestamp kosong ditolak', () => {
    expect(parseBudgetUpdate(validBudget).ok).toBe(true);
    expect(parseBudgetUpdate({ ...validBudget, used: -1 }).ok).toBe(false);
    expect(parseBudgetUpdate({ ...validBudget, timestamp: '' }).ok).toBe(false);
  });
});
