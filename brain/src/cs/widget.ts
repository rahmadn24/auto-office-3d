import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

/**
 * WIDGET CHANNEL — chat widget di halaman demo (Fase 11, PRD §3.5).
 *
 * Dua aset statis disajikan Brain sendiri (tanpa CDN, aman offline):
 *   GET /widget/socket.io.min.js  — client resmi (dari node_modules)
 *   GET /widget/widget.js         — widget vanilla: connect → `cs:widget_message`
 * Halaman demo (`GET /demo/widget`) dan preset stack yang di-deploy (Fase 10)
 * menyisipkan snippet yang sama lewat `widgetSnippet()`.
 */

const require = createRequire(import.meta.url);

/**
 * Path file socket.io client di node_modules (null bila tidak terpasang).
 * Package `exports` memblokir subpath `dist/*`, jadi dicari relatif terhadap
 * entry point yang di-resolve Node.
 */
export function socketIoClientFile(): string | null {
  try {
    const entry = require.resolve('socket.io-client');
    const marker = 'socket.io-client';
    const root = entry.slice(0, entry.lastIndexOf(marker) + marker.length);
    for (const candidate of ['dist/socket.io.min.js', 'dist/socket.io.js']) {
      const file = join(root, candidate);
      if (existsSync(file)) return file;
    }
    return null;
  } catch {
    return null;
  }
}

export const WIDGET_JS = String.raw`(function () {
  var cfg = window.AO3D_WIDGET || {};
  var url = cfg.url || '';
  var path = cfg.path || '/brain-server';
  if (!url || !window.io) { return; }
  var visitor = null;
  try { visitor = window.localStorage.getItem('ao3d_widget_visitor'); } catch (e) { visitor = null; }
  if (!visitor) {
    visitor = 'w_' + Math.random().toString(36).slice(2, 10);
    try { window.localStorage.setItem('ao3d_widget_visitor', visitor); } catch (e) {}
  }
  function conversationId() {
    return 'cs:widget:' + visitor.toLowerCase().replace(/[^a-z0-9@.+_-]/g, '-');
  }
  var socket = null;
  var opened = false;

  var root = document.createElement('div');
  root.setAttribute('data-ao3d-widget', '1');
  root.innerHTML =
    '<button id="ao3d-widget-toggle" style="position:fixed;right:18px;bottom:18px;z-index:2147483000;width:52px;height:52px;border-radius:50%;border:1px solid rgba(56,189,248,.6);background:rgba(15,23,42,.92);color:#38bdf8;font-size:22px;cursor:pointer;box-shadow:0 12px 32px -12px #000">💬</button>' +
    '<section id="ao3d-widget-panel" style="position:fixed;right:18px;bottom:82px;z-index:2147483000;display:none;width:min(320px,88vw);border:1px solid #2a3550;border-radius:14px;background:#0b0f19;color:#e6e9f0;font-family:ui-monospace,Menlo,monospace;box-shadow:0 24px 64px -24px #000;overflow:hidden">' +
    '  <header style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #1f2937;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#94a3b8">CS Agent · AutoOffice3D<button id="ao3d-widget-close" style="background:none;border:0;color:#94a3b8;cursor:pointer;font-size:14px">✕</button></header>' +
    '  <div id="ao3d-widget-log" style="max-height:240px;overflow-y:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px;font-size:12px"></div>' +
    '  <form id="ao3d-widget-form" style="display:flex;gap:6px;padding:10px;border-top:1px solid #1f2937">' +
    '    <input id="ao3d-widget-input" placeholder="Tulis pertanyaan…" style="flex:1;background:#111726;border:1px solid #2a3550;border-radius:8px;color:#e6e9f0;padding:8px;font:inherit;font-size:12px">' +
    '    <button id="ao3d-widget-send" type="submit" style="border:1px solid rgba(52,211,153,.55);background:rgba(52,211,153,.14);color:#6ee7b7;border-radius:8px;padding:8px 10px;font:inherit;font-size:12px;cursor:pointer">Kirim</button>' +
    '  </form>' +
    '</section>';
  document.body.appendChild(root);

  var log = root.querySelector('#ao3d-widget-log');
  var panel = root.querySelector('#ao3d-widget-panel');
  var input = root.querySelector('#ao3d-widget-input');
  var toggle = root.querySelector('#ao3d-widget-toggle');

  function bubble(text, role) {
    var div = document.createElement('div');
    div.className = 'ao3d-bubble ao3d-bubble-' + role;
    div.setAttribute('data-role', role);
    div.textContent = text;
    div.style.cssText =
      'max-width:85%;padding:8px 10px;border-radius:10px;line-height:1.45;white-space:pre-wrap;' +
      (role === 'human'
        ? 'align-self:flex-end;background:rgba(56,189,248,.16);border:1px solid rgba(56,189,248,.35);color:#e0f2fe'
        : 'align-self:flex-start;background:#111726;border:1px solid #2a3550;color:#cbd5e1');
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }
  bubble('Hai! Saya CS Agent AutoOffice3D — tanya apa saja soal produk ini.', 'agent');

  function connect() {
    if (socket) { return; }
    socket = window.io(url, { path: path, transports: ['websocket', 'polling'] });
    socket.on('cs:message', function (turn) {
      if (!turn || turn.role !== 'agent') { return; }
      if (turn.conversationId !== conversationId()) { return; }
      bubble(turn.message, 'agent');
    });
  }

  function openPanel() {
    opened = true;
    panel.style.display = 'block';
    toggle.textContent = '✕';
    connect();
    input.focus();
  }
  function closePanel() {
    opened = false;
    panel.style.display = 'none';
    toggle.textContent = '💬';
  }
  toggle.addEventListener('click', function () { opened ? closePanel() : openPanel(); });
  root.querySelector('#ao3d-widget-close').addEventListener('click', closePanel);

  function send(text) {
    var message = (text || '').trim();
    if (!message) { return false; }
    if (!opened) { openPanel(); }
    connect();
    bubble(message, 'human');
    socket.emit('cs:widget_message', { visitorId: visitor, message: message });
    return true;
  }
  root.querySelector('#ao3d-widget-form').addEventListener('submit', function (event) {
    event.preventDefault();
    if (send(input.value)) { input.value = ''; }
  });

  window.AO3DWidget = { open: openPanel, close: closePanel, send: send, conversationId: conversationId };
})();
`;

/** Snippet siap tempel untuk halaman produk (preset stack / halaman demo). */
export function widgetSnippet(baseUrl: string, socketPath = '/brain-server'): string {
  const base = baseUrl.replace(/\/+$/, '');
  return [
    `<script>window.AO3D_WIDGET = { url: ${JSON.stringify(base)}, path: ${JSON.stringify(socketPath)} };</script>`,
    `<script src="${base}/widget/socket.io.min.js" defer></script>`,
    `<script src="${base}/widget/widget.js" defer></script>`,
  ].join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Halaman demo mandiri (brain) — dipakai e2e & demo manual widget channel. */
export function widgetDemoPage(baseUrl: string, socketPath = '/brain-server'): string {
  const base = escapeHtml(baseUrl.replace(/\/+$/, ''));
  return `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AutoOffice3D · Demo Produk + Widget CS</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f19;color:#e6e9f0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .card{width:min(560px,92vw);border:1px solid #2a3550;border-radius:14px;padding:28px;background:#111726;box-shadow:0 24px 64px -32px #000}
  .tag{font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#6ee7b7}
  h1{font-size:18px;margin:10px 0 6px}
  p{font-size:13px;color:#9aa4bf;line-height:1.6}
  code{color:#c7d2fe}
</style></head><body>
<main class="card">
  <div class="tag">demo produk · widget channel</div>
  <h1>Produk demo sudah live 🚀</h1>
  <p>Halaman ini memakai <code>GET /widget/*</code> Brain. Klik tombol 💬 kanan bawah
  dan kirim pertanyaan — CS Agent menjawab lewat socket yang sama dengan yang
  menggerakkan kantor 3D. Balasan otomatis muncul di widget dan masuk ke
  <strong>CS Inbox</strong> Theater.</p>
  <p id="ao3d-demo-status">visitor: <code id="ao3d-widget-visitor">(belum connect)</code></p>
</main>
<script>window.AO3D_WIDGET = { url: ${JSON.stringify(base)}, path: ${JSON.stringify(socketPath)} };</script>
<script src="/widget/socket.io.min.js" defer></script>
<script src="/widget/widget.js" defer></script>
<script>
  window.addEventListener('load', function () {
    var el = document.getElementById('ao3d-widget-visitor');
    if (window.AO3DWidget && el) { el.textContent = window.AO3DWidget.conversationId(); }
  });
</script>
</body></html>`;
}
