/**
 * Uji Fase 5 (kartu 🧪): inject live directive DI TENGAH run.
 * Kirim directive A → 300ms kemudian directive B → harap ack B = {queued:true}
 * lalu kedua run tetap jalan berurutan (2 milestone dengan runId berbeda).
 *
 * node scripts/inject-test.mjs
 */
import { io } from 'socket.io-client';

const BRAIN = process.env.BRAIN_URL ?? 'http://localhost:4800';
const PATH = process.env.BRAIN_PATH ?? '/brain-server';

const socket = io(BRAIN, {
  path: PATH,
  transports: ['websocket', 'polling'],
  reconnection: false,
  timeout: 8000,
});

const acks = [];
const milestones = [];

socket.on('connect', () => {
  console.log('[inject] connected', socket.id);
  socket.emit(
    'founder:directive',
    'Build a donation tracker for open-source maintainers',
    (ack) => {
      acks.push({ which: 'A', ack });
      console.log('[inject] ack A:', JSON.stringify(ack));
    },
  );
  setTimeout(() => {
    socket.emit('founder:directive', 'Build an uptime monitor with Slack alerts', (ack) => {
      acks.push({ which: 'B', ack });
      console.log('[inject] ack B (mid-run):', JSON.stringify(ack));
    });
  }, 300);
});

socket.on('connect_error', (err) => {
  console.error('[inject] connect_error:', err.message);
  process.exit(1);
});

socket.on('agent:status_update', (p) => {
  console.log(
    `[inject] ${p.runId.slice(0, 12)} ${p.agentId} ${p.currentAction} :: ${p.logMessage.slice(0, 55)}`,
  );
});

socket.on('milestone:first_sale', (p) => {
  milestones.push(p.runId);
  console.log('[inject] milestone →', p.runId.slice(0, 12), p.customer.city, '$' + p.amount);
});

setTimeout(() => {
  const queued = acks.some((a) => a.ack && a.ack.queued === true);
  console.log('--- hasil ---');
  console.log('acks:', JSON.stringify(acks));
  console.log('mid-run queued ack terdeteksi:', queued);
  console.log('milestones:', milestones.length, 'runId unik:', new Set(milestones).size);
  const ok = queued && milestones.length >= 2;
  console.log(ok ? '[inject] PASS — inject di tengah run berfungsi' : '[inject] FAIL');
  socket.disconnect();
  process.exit(ok ? 0 : 1);
}, 60_000);
