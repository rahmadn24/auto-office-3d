import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Server } from 'socket.io';

import type { RunControl } from '../control';
import { EventBus } from '../events';
import { isDemoPayment, type PaymentProvider, type WebhookOutcome } from '../payments';
import { formatMoney, type Telemetry } from '../types';

/**
 * HTTP surface Brain (Fase 9 — hasil pemecahan `server/socket.ts`):
 *   GET  /health                — status daemon + payment sentinel
 *   POST /control/halt|resume   — Loop Controls (PRD §3.2)
 *   POST /webhook/<provider>    — webhook gateway aktif (stripe/midtrans/stub/xendit)
 *   GET  /demo/checkout         — halaman bayar stub (demo tanpa akun)
 *   POST /demo/pay              — simulasi bayar → webhook internal (driver stub)
 *
 * Handler dibuat sebagai factory agar io (broadcast) & payment provider
 * di-inject dari bootstrap socket — perilaku lama tidak berubah.
 */
export interface HttpHandlerOptions {
  bus: EventBus;
  control: RunControl;
  payment: PaymentProvider;
  controlTelemetry: Telemetry;
  /** io untuk `control:state` — getter agar aman dibuat sebelum io.listen(). */
  getIo: () => Server;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => (data += chunk.toString('utf8')));
    req.on('end', () => resolve(data));
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Halaman demo minimal (tema gelap Theater) untuk driver stub. */
function demoPage(bodyHtml: string, title = 'AutoOffice3D · Demo Checkout'): string {
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f19;color:#e6e9f0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .card{width:min(440px,92vw);border:1px solid #2a3550;border-radius:14px;padding:28px;background:#111726;box-shadow:0 24px 64px -32px #000}
  .tag{font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#6ee7b7}
  h1{font-size:18px;margin:10px 0 6px}
  p{font-size:13px;color:#9aa4bf;line-height:1.55}
  code{color:#c7d2fe}
  .amount{font-size:26px;margin:16px 0;color:#fff}
  button{width:100%;margin-top:12px;padding:12px;border-radius:10px;border:1px solid rgba(52,211,153,.55);background:rgba(52,211,153,.14);color:#6ee7b7;font:inherit;font-size:13px;letter-spacing:.08em;text-transform:uppercase;cursor:pointer}
  button:hover{background:rgba(52,211,153,.28)}
</style></head><body><main class="card">${bodyHtml}</main></body></html>`;
}

export function createHttpHandler(
  opts: HttpHandlerOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const { bus, control, payment, controlTelemetry, getIo } = opts;
  const webhookPath = `/webhook/${payment.id}`;
  const demo = isDemoPayment(payment) ? payment : null;

  function broadcastRevenue(runId: string): void {
    bus.revenue({ ...payment.metrics(), runId, timestamp: new Date().toISOString() });
  }

  return (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      const metrics = payment.metrics();
      json(res, 200, {
        ok: true,
        service: 'autooffice3d-brain',
        control: control.snapshot(),
        payment: {
          provider: payment.id,
          requiresSignature: payment.requiresSignature,
          salesCount: metrics.salesCount,
          lastEvent: metrics.lastEvent,
        },
      });
      return;
    }

    if (req.method === 'POST' && (req.url === '/control/halt' || req.url === '/control/resume')) {
      const path = req.url;
      void readBody(req).then((body) => {
        let runId: string | undefined;
        try {
          const parsed: unknown = body ? JSON.parse(body) : {};
          if (parsed && typeof parsed === 'object' && 'runId' in parsed) {
            const value = (parsed as { runId?: unknown }).runId;
            if (typeof value === 'string') runId = value;
          }
        } catch {
          runId = undefined;
        }
        if (path === '/control/halt') control.halt(runId);
        else control.resume(runId);
        getIo().emit('control:state', control.snapshot());
        bus.agent(
          EventBus.payload({
            runId: 'control',
            agentId: 'founder_agent',
            action: 'idle',
            zone: 'central_bus',
            logMessage: `LOOP CONTROLS · ${path === '/control/halt' ? 'HALT' : 'RESUME'} ${runId ?? 'ALL'} via HTTP`,
            telemetry: controlTelemetry,
          }),
        );
        json(res, 200, { ok: true, control: control.snapshot() });
      });
      return;
    }

    if (req.method === 'POST' && req.url === webhookPath) {
      void readBody(req).then((body) => {
        let outcome: WebhookOutcome;
        try {
          outcome = payment.receiveWebhook({ rawBody: body, headers: req.headers }, 'webhook');
        } catch (err) {
          // Driver yang belum diimplementasikan (mis. xendit stub) → 501.
          json(res, 501, {
            ok: false,
            provider: payment.id,
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        if (outcome.sale) bus.milestone(outcome.sale);
        broadcastRevenue(outcome.sale?.runId ?? 'webhook');
        const status = outcome.accepted
          ? 200
          : outcome.reason === 'invalid-signature'
            ? 401
            : outcome.reason === 'invalid-payload'
              ? 400
              : 200;
        json(res, status, {
          ok: outcome.accepted,
          received: true,
          provider: payment.id,
          eventId: outcome.eventId,
          status: outcome.status,
          signatureVerified: outcome.signatureVerified,
          firstSale: Boolean(outcome.sale),
          duplicate: outcome.duplicate ?? false,
          reason: outcome.reason,
          metrics: payment.metrics(),
        });
      });
      return;
    }

    if (demo) {
      // Halaman checkout demo (stub) — alur bayar tanpa akun gateway.
      if (req.method === 'GET' && req.url?.startsWith('/demo/checkout')) {
        const orderId = new URL(req.url, 'http://localhost').searchParams.get('order_id') ?? '';
        const link = demo.peekLink(orderId);
        if (!link) {
          res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
          res.end(
            demoPage(
              `<div class="tag">stub gateway</div><h1>Order tidak ditemukan</h1><p>Tautan demo sudah kedaluwarsa atau order_id salah.</p>`,
              'AutoOffice3D · Order tidak ditemukan',
            ),
          );
          return;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(
          demoPage(`
<div class="tag">AutoOffice3D · stub gateway</div>
<h1>Demo Checkout</h1>
<p>Order <code>${escapeHtml(orderId)}</code> · lead <code>${escapeHtml(link.leadId)}</code></p>
<div class="amount">${formatMoney(link.amount, link.currency)}</div>
<p>Mode stub — tidak ada uang sungguhan yang berpindah. Menekan tombol di bawah
memicu webhook internal dan memancarkan <code>milestone:first_sale</code> + <code>revenue:update</code> ke Theater (CELEBRATE).</p>
<form method="POST" action="/demo/pay">
  <input type="hidden" name="order_id" value="${escapeHtml(orderId)}">
  <button type="submit">Bayar sekarang →</button>
</form>`),
        );
        return;
      }

      // Simulasi bayar → webhook internal driver stub (PRD §7 Fase 9).
      if (req.method === 'POST' && req.url === '/demo/pay') {
        void readBody(req).then((body) => {
          const isJson = (req.headers['content-type'] ?? '').includes('application/json');
          let orderId = '';
          if (isJson) {
            try {
              orderId = (JSON.parse(body) as { order_id?: string }).order_id ?? '';
            } catch {
              orderId = '';
            }
          } else {
            orderId = new URLSearchParams(body).get('order_id') ?? '';
          }
          const notification = orderId ? demo.demoNotification(orderId) : null;
          if (!notification) {
            res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
            res.end(
              demoPage(
                `<div class="tag">stub gateway</div><h1>Order tidak ditemukan</h1><p>Pembayaran demo dibatalkan — order_id tidak dikenal.</p>`,
                'AutoOffice3D · Order tidak ditemukan',
              ),
            );
            return;
          }
          const outcome = payment.receiveWebhook(notification, 'demo');
          if (outcome.sale) bus.milestone(outcome.sale);
          broadcastRevenue(outcome.sale?.runId ?? 'demo');
          const link = demo.peekLink(orderId);
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(
            demoPage(`
<div class="tag">pembayaran demo berhasil</div>
<h1>${outcome.sale ? '✅ FIRST CUSTOMER ACQUIRED' : '✅ Pembayaran diterima'}</h1>
<p>${outcome.sale ? 'Milestone dipancarkan ke Theater — CELEBRATE.' : 'Order ini sudah pernah diproses (idempoten).'}</p>
<div class="amount">${link ? formatMoney(link.amount, link.currency) : ''}</div>
<p>Order <code>${escapeHtml(orderId)}</code> · provider <code>${payment.id}</code> · status <code>${outcome.status}</code></p>
<p>Kembali ke tab Theater untuk melihat selebrasi kantor.</p>`),
          );
        });
        return;
      }
    }

    res.writeHead(404).end();
  };
}
