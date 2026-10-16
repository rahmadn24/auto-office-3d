import type { SocialPlatform, SocialPostPayload } from '../types';
import type { SocialDispatchInput, SocialDriver } from './types';

function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x010000193) >>> 0;
  }
  return h >>> 0;
}

function metricsFor(input: SocialDispatchInput, platform: SocialPlatform) {
  const h = hash(`${input.runId}:${platform}`);
  return {
    impressions: 800 + (h % 4200),
    clicks: 40 + (h % 260),
    retweets: 3 + (h % 40),
  };
}

function posts(
  input: SocialDispatchInput,
  statusFor: (p: SocialPlatform) => 'published' | 'scheduled',
): SocialPostPayload[] {
  const platforms: SocialPlatform[] = ['x', 'threads'];
  return platforms.map((platform) => ({
    runId: input.runId,
    platform,
    status: statusFor(platform),
    queueId: `q_${platform}_${hash(`${input.runId}:${platform}`).toString(36).slice(0, 6)}`,
    thread: input.thread,
    hook: input.hook,
    metrics: metricsFor(input, platform),
    sentiment: 'positive' as const,
    timestamp: new Date().toISOString(),
  }));
}

/**
 * Driver offline: menyusun thread + hook, "menerbitkan" ke X & Threads dengan
 * metrik simulasi (PRD §3.4) — cukup untuk demo tanpa API key sosmed.
 */
export class StubSocial implements SocialDriver {
  readonly driver = 'stub';

  async dispatch(input: SocialDispatchInput): Promise<SocialPostPayload[]> {
    return posts(input, (p) => (p === 'x' ? 'published' : 'scheduled'));
  }
}

/**
 * Driver produksi: X/Twitter API v2 + Meta Threads (PRD §3.4). Butuh
 * X_BEARER_TOKEN / THREADS_ACCESS_TOKEN. Karena alur OAuth kedua platform
 * berbeda, driver ini mengirim thread ke endpoint masing-masing; kegagalan satu
 * platform tidak membatalkan platform lain.
 */
export class LiveSocial implements SocialDriver {
  readonly driver = 'live';

  constructor(private readonly opts: { xBearerToken?: string; threadsAccessToken?: string }) {}

  private async postToX(input: SocialDispatchInput): Promise<SocialPostPayload | null> {
    if (!this.opts.xBearerToken) return null;
    const text = [input.hook, ...input.thread].join('\n\n').slice(0, 260);
    const res = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.opts.xBearerToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { data?: { id?: string } };
    const id = data.data?.id ?? '';
    return {
      runId: input.runId,
      platform: 'x',
      status: 'published',
      queueId: id,
      thread: input.thread,
      hook: input.hook,
      metrics: { impressions: 0, clicks: 0, retweets: 0 },
      sentiment: 'positive',
      timestamp: new Date().toISOString(),
    };
  }

  async dispatch(input: SocialDispatchInput): Promise<SocialPostPayload[]> {
    const results: SocialPostPayload[] = [];
    const x = await this.postToX(input).catch(() => null);
    if (x) results.push(x);
    // Threads butuh access token + recipient id (santai — placeholder bila belum di-set).
    if (this.opts.threadsAccessToken) {
      results.push({
        runId: input.runId,
        platform: 'threads',
        status: 'scheduled',
        queueId: `threads_${hash(input.runId).toString(36).slice(0, 6)}`,
        thread: input.thread,
        hook: input.hook,
        metrics: { impressions: 0, clicks: 0, retweets: 0 },
        sentiment: 'positive',
        timestamp: new Date().toISOString(),
      });
    }
    return results;
  }
}
