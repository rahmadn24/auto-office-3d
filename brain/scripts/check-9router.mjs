#!/usr/bin/env node
/**
 * AutoOffice3D — verifikasi headless 9router (PRD §7 Fase 12, kartu 12.3).
 *
 * 9router (image resmi `decolua/9router`) adalah LLM gateway opsional:
 * Brain memakai `ANTHROPIC_BASE_URL=http://9router:20128/v1`. Script ini
 * membuktikan gateway hidup + endpoint /v1/models bisa diakses dengan API key
 * yang dibuat di dashboard — tanpa membuka browser (headless / CI / VPS).
 *
 * Pemakaian:
 *   node scripts/check-9router.mjs --url http://9router:20128 --key 9r_xxx
 *   docker compose exec brain node scripts/check-9router.mjs --url http://9router:20128 --key 9r_xxx
 *
 * Env fallback: NINE_ROUTER_URL, NINE_ROUTER_API_KEY.
 * Output satu baris JSON; exit 0 = siap dipakai Brain, 1 = belum.
 */
const args = process.argv.slice(2);

function arg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  const value = args[idx + 1];
  if (!value || value.startsWith('--')) throw new Error(`argumen --${name} butuh nilai`);
  return value;
}

const baseUrl = (arg('url', process.env.NINE_ROUTER_URL ?? 'http://localhost:20128') ?? '').replace(
  /\/+$/,
  '',
);
const apiKey = arg('key', process.env.NINE_ROUTER_API_KEY ?? '');
const model = arg('model', process.env.NINE_ROUTER_MODEL ?? '');
const timeoutMs = Number(arg('timeout', '8000'));

async function probe(path, init = {}) {
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    return { status: res.status, latencyMs: Date.now() - started, text };
  } catch (err) {
    return { status: 0, latencyMs: Date.now() - started, error: String(err?.message ?? err) };
  }
}

const dashboard = await probe('/');
const headers = apiKey ? { authorization: `Bearer ${apiKey}` } : {};
const models = await probe('/v1/models', { headers });

let modelIds = [];
if (models.status === 200) {
  try {
    const parsed = JSON.parse(models.text);
    modelIds = (parsed.data ?? []).map((m) => m.id).slice(0, 10);
  } catch {
    // body bukan JSON — biarkan count 0.
  }
}

// Smoke /v1/messages (Anthropic-compatible) — hanya bila model diminta, karena
// panggilan ini memakai kuota provider upstream.
let messages = null;
if (model && apiKey) {
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: 'user', content: 'ping (jawab satu kata)' }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let reply = '';
    try {
      const parsed = JSON.parse(text);
      reply =
        parsed.content?.find?.((part) => part.type === 'text')?.text ??
        parsed.choices?.[0]?.message?.content ??
        '';
    } catch {
      // bukan JSON — biarkan snippet mentah.
    }
    messages = {
      status: res.status,
      latencyMs: Date.now() - started,
      ok: res.ok,
      reply: String(reply).slice(0, 120),
    };
  } catch (err) {
    messages = {
      status: 0,
      latencyMs: Date.now() - started,
      ok: false,
      error: String(err?.message ?? err),
    };
  }
}

const ok =
  dashboard.status > 0 &&
  (models.status === 200 || models.status === 401) &&
  (messages === null || messages.ok);

const result = {
  ok,
  baseUrl,
  dashboard: { status: dashboard.status, latencyMs: dashboard.latencyMs },
  models: {
    status: models.status,
    latencyMs: models.latencyMs,
    count: modelIds.length,
    sample: modelIds.slice(0, 5),
  },
  ...(messages ? { messages } : {}),
  hint: ok
    ? models.status === 200
      ? '9router siap — set ANTHROPIC_BASE_URL ke <baseUrl>/v1'
      : '9router hidup; /v1/models butuh API key — set --key / NINE_ROUTER_API_KEY'
    : `9router belum terjangkau/siap di ${baseUrl} — cek container/profile compose`,
};

console.log(JSON.stringify(result));
process.exit(ok ? 0 : 1);
