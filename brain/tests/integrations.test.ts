import { describe, expect, it } from 'vitest';

import { composeLaunchThread } from '../src/integrations';
import { LocalGitHub } from '../src/integrations/github';
import { StubEmail } from '../src/integrations/email';
import { OfflineHealthProbe } from '../src/integrations/health';
import { StubSocial } from '../src/integrations/social';
import { LocalVercel } from '../src/integrations/vercel';

describe('GitHub Repository Provisioning (PRD §3.3)', () => {
  it('provisionRepo sukses & retry backoff saat gagal awal', async () => {
    const flaky = new LocalGitHub('autooffice3d', { failTimes: 2 });
    const res = await flaky.provisionRepo('my-saas');
    expect(res.ok).toBe(true);
    expect(res.retries).toBe(2);
    expect(res.repoUrl).toBe('https://github.com/autooffice3d/my-saas');
  });

  it('commitFiles menghitung artefak & branch main', async () => {
    const gh = new LocalGitHub();
    const res = await gh.commitFiles('https://github.com/autooffice3d/x', {
      'specs/PRD.md': '# prd',
      'src/routes/invoices.ts': 'export {};',
    });
    expect(res.committed).toBe(2);
    expect(res.branch).toBe('main');
    expect(res.sha).toMatch(/^[0-9a-f]{7}$/);
  });
});

describe('Vercel Edge Deployment (PRD §3.3)', () => {
  it('deploy memancarkan build steps lalu READY + live_url', async () => {
    const vercel = new LocalVercel();
    const seen: string[] = [];
    const result = await vercel.deploy({
      slug: 'invoiceai-gen',
      files: { 'src/app.ts': 'x' },
      onStep: (_steps, status) => seen.push(status),
    });
    expect(result.status).toBe('ready');
    expect(result.liveUrl).toBe('invoiceai-gen.vercel.app');
    expect(result.buildSteps.every((s) => s.status === 'done')).toBe(true);
    expect(result.buildSteps.map((s) => s.label)).toContain('Compiled successfully');
    expect(result.buildSteps.map((s) => s.label)).toContain('Deployed to Edge Cache');
    expect(seen.at(-1)).toBe('ready');
  });
});

describe('Health Check Probe (PRD §3.3)', () => {
  it('probe offline melaporkan 200 OK + TTFB', async () => {
    const report = await new OfflineHealthProbe(24).probe('https://x.vercel.app');
    expect(report.rootOk).toBe(true);
    expect(report.apiOk).toBe(true);
    expect(report.sslValid).toBe(true);
    expect(report.ttfbMs).toBe(24);
  });
});

/* Stripe/Midtrans/Stub Payment Provider → pindah ke tests/payments.test.ts (Fase 9). */

describe('Social Campaign Dispatcher (PRD §3.4)', () => {
  it('dispatch menghasilkan post X (published) + Threads (scheduled)', async () => {
    const social = new StubSocial();
    const posts = await social.dispatch({
      runId: 'run_x',
      thread: ['hook', 'line1'],
      hook: 'shipped autonomously',
    });
    expect(posts).toHaveLength(2);
    expect(posts.find((p) => p.platform === 'x')?.status).toBe('published');
    expect(posts.find((p) => p.platform === 'threads')?.status).toBe('scheduled');
    for (const p of posts) expect(p.queueId).toMatch(/^q_/);
  });

  it('composeLaunchThread menyusun hook + thread build-in-public', () => {
    const { thread, hook } = composeLaunchThread({
      projectName: 'InvoiceAI',
      founderPrompt: 'Build an AI invoice generator',
      liveUrl: 'invoiceai.vercel.app',
    });
    expect(hook).toContain('InvoiceAI');
    expect(thread.join(' ')).toContain('invoiceai.vercel.app');
  });
});

describe('Welcome email stub (PRD §3.4)', () => {
  it('mencatat email terkirim', async () => {
    const email = new StubEmail();
    const res = await email.send({ to: 'a***@x.io', subject: 'Welcome', body: 'hi' });
    expect(res.sent).toBe(true);
    expect(email.sent).toHaveLength(1);
  });
});
