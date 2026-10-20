#!/usr/bin/env node
/**
 * E2E smoke AutoOffice3D — dipakai lokal & CI.
 *
 * Alur:
 *   1. Nyalakan Brain (LLM stub, memori in-process, DATA_DIR temporer) :4899.
 *   2. Nyalakan Theater (`next dev`) :3101.
 *   3. Buka Chrome headless → tunggu badge "SOCKET.IO CONNECTED".
 *   4. Floating PM chat (Fase 8): chat Founder→PM dari UI → observer mendengar
 *      `pm:reply` → tombol GO mengompilasi brief dan mengirim
 *      `founder:directive` → pipeline otonom berjalan (agent:status_update).
 *   5. Payment (Fase 9): buka /terminal → tombol "Simulate Payment" →
 *      observer mendengar `milestone:first_sale` (provider stub) → banner
 *      CELEBRATE "FIRST CUSTOMER ACQUIRED" muncul di UI.
 *   6. Event Replay (Fase 10): playback run durable di tab /pipeline.
 *   7. CS Agent (Fase 11): widget di /demo/widget → `cs:message` + lead baru →
 *      CS Inbox /inbox → tombol quote → `payment:link_created` + kontrak PDF →
 *      bayar via /demo/pay → `lead:update` deal + badge DEAL di UI.
 *   8. Matikan semua proses anak + hapus data temporer. Exit code 0/1.
 *
 * Env: E2E_BRAIN_PORT (4899), E2E_THEATER_PORT (3101), E2E_TIMEOUT_MS (150000),
 *      E2E_VERBOSE=0 untuk senyapkan log service.
 * Prasyarat browser: `npx playwright install chromium` (sekali per mesin/CI).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';
import { io } from 'socket.io-client';

const theaterDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const brainDir = join(theaterDir, '..', 'brain');

const BRAIN_PORT = Number(process.env.E2E_BRAIN_PORT ?? 4899);
const THEATER_PORT = Number(process.env.E2E_THEATER_PORT ?? 3101);
const TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS ?? 150_000);
const VERBOSE = process.env.E2E_VERBOSE !== '0';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @type {import('node:child_process').ChildProcess[]} */
const spawned = [];
/** @type {Map<string, string[]>} */
const logs = new Map();

function spawnService(name, cwd, args, env) {
  const child = spawn('npm', args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true, // group leader → kill(-pid) mematikan seluruh process tree
  });
  spawned.push(child);

  const ring = [];
  logs.set(name, ring);
  for (const stream of [child.stdout, child.stderr]) {
    let buffered = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffered += chunk;
      let idx;
      while ((idx = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, idx);
        ring.push(line);
        if (ring.length > 60) ring.shift();
        if (VERBOSE) console.log(`[${name}] ${line}`);
        buffered = buffered.slice(idx + 1);
      }
    });
  }
  return child;
}

function killTree(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

async function waitForHttp(url, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = 'belum ada respons';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (res.ok) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await sleep(500);
  }
  throw new Error(`timeout menunggu ${label} (${url}) — terakhir: ${last}`);
}

async function main() {
  const dataDir = mkdtempSync(join(tmpdir(), 'ao3d-e2e-'));
  console.log(`E2E smoke — data temporer: ${dataDir}`);

  try {
    // ── Brain: stub penuh, tanpa state nyentuh folder repo ──────────────────
    spawnService('brain', brainDir, ['run', 'start'], {
      PORT: String(BRAIN_PORT),
      DATA_DIR: dataDir,
      MEMORY_DRIVER: 'memory',
      LLM_DRIVER: 'stub',
      SANDBOX_DRIVER: 'local',
      DEPLOY_DRIVER: 'local',
      EMAIL_DRIVER: 'stub',
      SOCIAL_DRIVER: 'stub',
    });
    await waitForHttp(`http://127.0.0.1:${BRAIN_PORT}/health`, 'brain /health', 30_000);
    console.log('✓ brain siap (stub)');

    // ── Theater: next dev ───────────────────────────────────────────────────
    spawnService('theater', theaterDir, ['run', 'dev'], {
      PORT: String(THEATER_PORT),
      NEXT_PUBLIC_BRAIN_URL: `http://127.0.0.1:${BRAIN_PORT}`,
      // Jangan pakai `.next` bersama dev server utama — bundle env E2E akan
      // tertukar dan UI dev menembak brain E2E yang sudah dimatikan.
      NEXT_DIST_DIR: '.next-e2e',
    });
    await waitForHttp(`http://127.0.0.1:${THEATER_PORT}`, 'theater /', 90_000);
    console.log('✓ theater siap');

    // Observer socket: bukti bebas-DOM bahwa directive dari UI memulai pipeline.
    const statusEvents = [];
    const pmReplies = [];
    const milestones = [];
    const leadUpdates = [];
    const csMessages = [];
    const paymentLinks = [];
    const observer = io(`http://127.0.0.1:${BRAIN_PORT}`, {
      path: '/brain-server',
      transports: ['websocket'],
    });

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const pageConsole = [];
      page.on('console', (msg) => pageConsole.push(`${msg.type()}: ${msg.text()}`));
      page.on('pageerror', (err) => pageConsole.push(`pageerror: ${err.message}`));
      observer.on('agent:status_update', (payload) => statusEvents.push(payload));
      observer.on('pm:reply', (payload) => pmReplies.push(payload));
      observer.on('milestone:first_sale', (payload) => milestones.push(payload));
      observer.on('lead:update', (payload) => leadUpdates.push(payload));
      observer.on('cs:message', (payload) => csMessages.push(payload));
      observer.on('payment:link_created', (payload) => paymentLinks.push(payload));

      await page.goto(`http://127.0.0.1:${THEATER_PORT}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => document.body.innerText.includes('SOCKET.IO CONNECTED'),
        undefined,
        {
          timeout: 30_000,
        },
      );
      console.log('✓ theater tersambung ke brain (SOCKET.IO CONNECTED)');

      // ── Floating PM chat (Fase 8): satu-satunya input — chat → GO ──────────
      // Dock kiri-bawah di Office Theater (terbuka default); tidak ada route
      // /briefing maupun Founder Command Bar lagi.
      await page.waitForSelector('input[aria-label="Tulis pesan untuk PM"]', {
        timeout: 10_000,
      });

      const goButton = page.getByRole('button', { name: /GO — mulai run otonom/ });
      if (!(await goButton.isDisabled())) {
        throw new Error('tombol GO harus disabled saat thread kosong');
      }

      const chatInput = page.locator('input[aria-label="Tulis pesan untuk PM"]');
      await chatInput.fill('e2e briefing — target freelancer, fitur invoice + checkout stripe');
      await chatInput.press('Enter');
      console.log('» pesan briefing dikirim dari UI (founder:chat)');

      const chatDeadline = Date.now() + 30_000;
      while (pmReplies.length === 0 && Date.now() < chatDeadline) await sleep(250);
      if (pmReplies.length === 0) {
        throw new Error('tidak ada pm:reply dari brain setelah founder:chat dikirim');
      }
      const reply = pmReplies[0];
      if (reply?.role !== 'agent' || reply?.channel !== 'briefing' || !reply?.message) {
        throw new Error(`pm:reply tidak sesuai kontrak ChatTurnPayload: ${JSON.stringify(reply)}`);
      }
      await page.waitForFunction(
        (snippet) => document.body.innerText.includes(snippet),
        reply.message.slice(0, 32),
        { timeout: 10_000 },
      );
      console.log(`✓ pm:reply ter-render di UI — "${reply.message.slice(0, 48)}…"`);

      await goButton.click();
      try {
        await page.waitForFunction(
          () => document.body.innerText.toLowerCase().includes('brief terkompilasi'),
          undefined,
          { timeout: 20_000 },
        );
      } catch (err) {
        const text = await page
          .evaluate(() => document.body.innerText)
          .catch(() => '(gagal membaca body)');
        console.error(`--- DEBUG body setelah GO ---\n${text.slice(0, 1600)}`);
        console.error(`--- DEBUG console browser ---\n${pageConsole.slice(-15).join('\n')}`);
        throw err;
      }
      await page.waitForFunction(
        () => document.body.innerText.toLowerCase().includes('directive terkirim'),
        undefined,
        { timeout: 20_000 },
      );
      console.log(
        '✓ GO — brief terkompilasi terkirim sebagai founder:directive (run otonom jalan)',
      );

      const statusDeadline = Date.now() + TIMEOUT_MS;
      while (statusEvents.length === 0 && Date.now() < statusDeadline) await sleep(500);
      if (statusEvents.length === 0) {
        throw new Error('tidak ada agent:status_update dari brain setelah GO');
      }
      console.log(`✓ pipeline mulai — ${statusEvents.length} status diterima dari brain`);

      // ── Payment demo (Fase 9): Simulate Payment → milestone + CELEBRATE ────
      await page.goto(`http://127.0.0.1:${THEATER_PORT}/terminal`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(
        () => document.body.innerText.includes('SOCKET.IO CONNECTED'),
        undefined,
        { timeout: 30_000 },
      );

      const milestonesBefore = milestones.length;
      await page.getByRole('button', { name: /Simulate Payment/i }).click();
      console.log('» Simulate Payment diklik dari UI (driver stub)');

      const payDeadline = Date.now() + 20_000;
      while (milestones.length <= milestonesBefore && Date.now() < payDeadline) await sleep(250);
      if (milestones.length <= milestonesBefore) {
        throw new Error('tidak ada milestone:first_sale dari brain setelah Simulate Payment');
      }
      const paid = milestones[milestones.length - 1];
      if (paid?.paymentProvider !== 'stub' || !paid?.hasCustomers) {
        throw new Error(`milestone tidak sesuai contract PRD §5.2: ${JSON.stringify(paid)}`);
      }
      await page.waitForFunction(
        () => document.body.innerText.includes('FIRST CUSTOMER ACQUIRED'),
        undefined,
        { timeout: 10_000 },
      );
      console.log(
        `✓ payment stub ${paid.currency} ${paid.amount} → milestone:first_sale + banner CELEBRATE di UI`,
      );

      // ── Event Replay (Fase 10): putar ulang run dari event log durable ─────
      // Frame replay dikirim ke socket peminta (bukan broadcast) — verifikasi
      // dua sisi: observer minta replay sendiri (kontrak frame) + playback UI.
      const runList = await new Promise((resolve) =>
        observer.emit('run:list', { limit: 5 }, resolve),
      );
      const latestRun = runList?.runs?.[0];
      if (!latestRun?.runId) throw new Error('run:list tidak berisi run durable');

      const replayFrames = [];
      const replayDone = new Promise((resolve) => {
        observer.on('run:replay', (frame) => {
          replayFrames.push(frame);
          if (frame?.phase === 'end') resolve();
        });
      });
      const replayAck = await new Promise((resolve) =>
        observer.emit('run:replay', { runId: latestRun.runId, stepMs: 0 }, resolve),
      );
      if (!replayAck?.ok) {
        throw new Error(`run:replay ditolak: ${JSON.stringify(replayAck)}`);
      }
      await Promise.race([
        replayDone,
        sleep(30_000).then(() => {
          throw new Error('timeout menunggu frame run:replay end');
        }),
      ]);
      const phases = replayFrames.map((frame) => frame.phase);
      if (
        phases[0] !== 'start' ||
        phases.at(-1) !== 'end' ||
        phases.filter((phase) => phase === 'event').length !== replayAck.total
      ) {
        throw new Error(`frame run:replay tidak sesuai kontrak: ${phases.slice(0, 10).join(',')}`);
      }

      await page.goto(`http://127.0.0.1:${THEATER_PORT}/pipeline`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(
        () => document.body.innerText.includes('SOCKET.IO CONNECTED'),
        undefined,
        { timeout: 30_000 },
      );
      const replayButton = page
        .locator('section:has-text("Run Replay · Event Log") button:has-text("▶")')
        .first();
      await replayButton.waitFor({ state: 'visible', timeout: 20_000 });
      await replayButton.click();
      console.log('» Replay diklik dari UI (panel Run Replay · Event Log)');
      await page.waitForFunction(
        () => document.body.innerText.includes('PLAYBACK DONE'),
        undefined,
        { timeout: 60_000 },
      );
      const progress = await page.evaluate(() => {
        const match = /(\d+)\/(\d+) EVENTS/i.exec(document.body.innerText);
        return match ? { received: Number(match[1]), total: Number(match[2]) } : null;
      });
      if (!progress || progress.total === 0 || progress.received !== progress.total) {
        throw new Error(`progress playback UI tidak lengkap: ${JSON.stringify(progress)}`);
      }
      console.log(
        `✓ event replay — ${replayAck.total} event (start → event* → end) + timeline PLAYBACK DONE di UI`,
      );

      // ── CS Agent (Fase 11): widget → lead → quote/kontrak → bayar → deal ───
      await page.goto(`http://127.0.0.1:${BRAIN_PORT}/demo/widget`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(
        () =>
          document.querySelector('#ao3d-widget-visitor')?.textContent?.startsWith('cs:widget:') ??
          false,
        undefined,
        { timeout: 15_000 },
      );
      const widgetConversation = await page.evaluate(() => window.AO3DWidget.conversationId());
      const leadsBefore = leadUpdates.length;
      const csMessagesBefore = csMessages.length;
      await page.evaluate(() => window.AO3DWidget.send('Halo, produk ini apa?'));
      console.log(`» widget mengirim pesan (${widgetConversation})`);

      await page.waitForFunction(
        () => document.querySelectorAll('.ao3d-bubble-agent').length >= 2,
        undefined,
        { timeout: 20_000 },
      );
      const csDeadline = Date.now() + 20_000;
      while (
        !leadUpdates
          .slice(leadsBefore)
          .some((u) => u?.lead?.conversationId === widgetConversation && u?.reason === 'created') &&
        Date.now() < csDeadline
      ) {
        await sleep(250);
      }
      const widgetLead = leadUpdates
        .slice(leadsBefore)
        .find((u) => u?.lead?.conversationId === widgetConversation)?.lead;
      if (!widgetLead) {
        throw new Error('tidak ada lead:update (created) setelah pesan widget');
      }
      const widgetReply = csMessages
        .slice(csMessagesBefore)
        .find((t) => t?.conversationId === widgetConversation && t?.role === 'agent');
      if (!widgetReply?.message) {
        throw new Error('tidak ada cs:message balasan agent untuk percakapan widget');
      }
      console.log(
        `✓ widget → lead ${widgetLead.id} (${widgetLead.source}) + balasan CS "${widgetReply.message.slice(0, 40)}…"`,
      );

      // CS Inbox: buka tab, pastikan lead widget tampil & terpilih.
      await page.goto(`http://127.0.0.1:${THEATER_PORT}/inbox`, {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForFunction(
        () => document.body.innerText.includes('SOCKET.IO CONNECTED'),
        undefined,
        { timeout: 30_000 },
      );
      await page.waitForFunction(
        // `innerText` mengikuti text-transform CSS (conversation id tampil uppercase).
        (conversation) =>
          document.body.innerText.toLowerCase().includes(conversation.toLowerCase()),
        widgetConversation,
        { timeout: 20_000 },
      );
      console.log('✓ CS Inbox menampilkan lead widget (auto-select)');

      // Quote manual dari inbox → payment link + kontrak PDF.
      const linksBefore = paymentLinks.length;
      await page.getByRole('button', { name: /kirim quote/i }).click();
      const quoteDeadline = Date.now() + 20_000;
      while (paymentLinks.length <= linksBefore && Date.now() < quoteDeadline) await sleep(250);
      const link = paymentLinks.at(-1);
      if (!link || link.leadId !== widgetLead.id || link.provider !== 'stub') {
        throw new Error(`payment:link_created tidak sesuai: ${JSON.stringify(link)}`);
      }
      if (!link.contractUrl?.includes(`/cs/contracts/${widgetLead.id}.pdf`)) {
        throw new Error(`contractUrl tidak menunjuk kontrak lead: ${link.contractUrl}`);
      }
      const pdfRes = await fetch(link.contractUrl);
      const pdf = Buffer.from(await pdfRes.arrayBuffer());
      if (pdfRes.status !== 200 || pdf.subarray(0, 8).toString('latin1') !== '%PDF-1.4') {
        throw new Error(
          `kontrak PDF bukan PDF 1.4 (HTTP ${pdfRes.status}): ${pdf.subarray(0, 8).toString('latin1')}`,
        );
      }
      console.log(`✓ quote terkirim — payment link ${link.currency} ${link.amount} + kontrak PDF`);

      // Bayar di halaman checkout demo (driver stub) → webhook internal → deal.
      const orderId = new URL(link.checkoutUrl).searchParams.get('order_id') ?? '';
      if (!orderId) throw new Error(`checkoutUrl tanpa order_id: ${link.checkoutUrl}`);
      const payRes = await fetch(`http://127.0.0.1:${BRAIN_PORT}/demo/pay`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ order_id: orderId }).toString(),
      });
      if (!payRes.ok) throw new Error(`POST /demo/pay gagal: HTTP ${payRes.status}`);

      const dealDeadline = Date.now() + 20_000;
      for (;;) {
        const deal = leadUpdates.find(
          (u) => u?.lead?.id === widgetLead.id && u?.lead?.status === 'deal',
        );
        if (deal) break;
        if (Date.now() > dealDeadline) {
          throw new Error('tidak ada lead:update deal setelah pembayaran stub');
        }
        await sleep(250);
      }
      await page.waitForFunction(() => /deal/i.test(document.body.innerText), undefined, {
        timeout: 10_000,
      });
      console.log('✓ pembayaran stub → lead deal + badge DEAL tampil di CS Inbox');
    } finally {
      observer.close();
      await browser.close().catch(() => {});
    }

    return 0;
  } finally {
    for (const child of spawned) killTree(child);
    await sleep(300);
    rmSync(dataDir, { recursive: true, force: true });
  }
}

let exitCode = 1;
try {
  exitCode = await main();
  console.log('\nE2E SMOKE PASS ✅');
} catch (err) {
  console.error(`\nE2E SMOKE FAIL ❌ — ${err instanceof Error ? err.message : String(err)}`);
  for (const [name, ring] of logs) {
    console.error(`\n--- log ${name} (${ring.length} baris terakhir) ---`);
    console.error(ring.join('\n'));
  }
}
process.exit(exitCode);
