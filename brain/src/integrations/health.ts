import type { HealthReport } from '../types';
import type { HealthProbe } from './types';

/**
 * Health Check Probe (PRD §3.3): GET root & API harus 200 OK, SSL valid,
 * TTFB dicatat. Ini driver nyata (fetch) — bekerja terhadap URL deployment
 * sungguhan maupun server lokal (http://localhost:4800/health untuk self-test).
 */
export class HttpHealthProbe implements HealthProbe {
  constructor(
    private readonly apiUrlPath = '/health',
    private readonly timeoutMs = 8000,
  ) {}

  private async hit(url: string): Promise<{ ok: boolean; ttfbMs: number; error: boolean }> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
      // TTFB = waktu sampai header respons pertama (stream dibaca sebagian).
      const ttfbMs = Date.now() - started;
      return { ok: res.status === 200, ttfbMs, error: false };
    } catch {
      return { ok: false, ttfbMs: Date.now() - started, error: true };
    } finally {
      clearTimeout(timer);
    }
  }

  async probe(liveUrl: string): Promise<HealthReport> {
    const base = liveUrl.startsWith('http') ? liveUrl : `https://${liveUrl}`;
    const root = await this.hit(`${base}/`);
    const api = await this.hit(`${base}${this.apiUrlPath}`);
    return {
      rootOk: root.ok,
      apiOk: api.ok,
      // https + fetch berhasil = SSL benar-benar terverifikasi; fetch gagal
      // (mis. cert invalid) → konservatif false, bukan cuma cek prefix URL.
      sslValid: base.startsWith('https://') && !root.error && !api.error,
      ttfbMs: Math.max(root.ttfbMs, api.ttfbMs),
    };
  }
}

/** Health probe dummy untuk driver offline (tanpa jaringan) — selalu 200 OK. */
export class OfflineHealthProbe implements HealthProbe {
  constructor(private readonly ttfbMs = 24) {}

  async probe(_liveUrl?: string): Promise<HealthReport> {
    return { rootOk: true, apiOk: true, sslValid: true, ttfbMs: this.ttfbMs };
  }
}

export type { HealthProbe } from './types';
