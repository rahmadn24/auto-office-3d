import { describe, expect, it } from 'vitest';

import {
  parseAgentStatus,
  parseArtifacts,
  parseDeployUpdate,
  parseFirstSale,
  parseMemoryRetrieval,
  parseRevenueUpdate,
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
  stripeEventId: 'evt_1',
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
  lastStripeEvent: 'checkout.session.completed · cus_1',
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
