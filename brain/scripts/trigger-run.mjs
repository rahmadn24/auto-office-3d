/**
 * Trigger E2E Fase 3: sambung ke Brain (Socket.io) lalu kirim founder:directive
 * → menjalankan run autonomous (stub LLM) yang memancarkan agent:status_update
 * & milestone:first_sale ke semua klien (theater). Bukan bagian produksi —
 * hanya alat verifikasi manual.
 *
 * node scripts/trigger-run.mjs [prompt]
 */
import { io } from 'socket.io-client';

const BRAIN = process.env.BRAIN_URL ?? 'http://localhost:4800';
const PATH = process.env.BRAIN_PATH ?? '/brain-server';
const prompt =
  process.argv[2] ??
  'Build an AI invoice generator for freelancers with Stripe billing and a landing page.';

const socket = io(BRAIN, {
  path: PATH,
  transports: ['websocket', 'polling'],
  reconnection: false,
  timeout: 8000,
});

let received = 0;

socket.on('connect', () => {
  console.log('[trigger] connected to brain', socket.id);
  socket.emit('founder:directive', prompt, (ack) => {
    console.log('[trigger] ack founder:directive:', JSON.stringify(ack));
  });
});

socket.on('connect_error', (err) => {
  console.error('[trigger] connect_error:', err.message);
  process.exit(1);
});

socket.on('system:hello', (h) => {
  console.log('[trigger] brain hello v' + (h && h.version));
});

socket.on('agent:status_update', (p) => {
  received += 1;
  console.log(
    `[trigger] ${received} agent:status_update → ${p.agentId} ${p.currentAction}@${p.targetZone} :: ${p.logMessage.slice(0, 60)}`,
  );
});

socket.on('milestone:first_sale', (p) => {
  console.log('[trigger] milestone:first_sale →', p.customer.city, '$' + p.amount);
});

// Cukup pantau sampai milestone atau timeout 90s.
const done = setTimeout(() => {
  console.log('[trigger] selesai (timeout). total status events =', received);
  socket.disconnect();
  process.exit(0);
}, 90_000);

socket.on('milestone:first_sale', () => {
  setTimeout(() => {
    console.log('[trigger] milestone tercapai. total status events =', received);
    clearTimeout(done);
    socket.disconnect();
    process.exit(0);
  }, 2000);
});
