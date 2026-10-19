#!/usr/bin/env node
/**
 * E2E smoke AutoOffice3D — dipakai lokal & CI.
 *
 * Alur:
 *   1. Nyalakan Brain (LLM stub, memori in-process, DATA_DIR temporer) :4899.
 *   2. Nyalakan Theater (`next dev`) :3101.
 *   3. Buka Chrome headless → tunggu badge "SOCKET.IO CONNECTED".
 *   4. Kirim directive founder via FounderCommandBar.
 *   5. Verifikasi E2E: observer socket mendengar `agent:status_update` dari Brain
 *      (directive dari UI benar-benar memulai pipeline) + UI menandai directive
 *      ter-queue (counter riwayat "↺ 1").
 *   6. Matikan semua proses anak + hapus data temporer. Exit code 0/1.
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
const DIRECTIVE = 'e2e smoke — bangun landing page dan deploy ke vercel';

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
    });
    await waitForHttp(`http://127.0.0.1:${THEATER_PORT}`, 'theater /', 90_000);
    console.log('✓ theater siap');

    // Observer socket: bukti bebas-DOM bahwa directive dari UI memulai pipeline.
    const statusEvents = [];
    const observer = io(`http://127.0.0.1:${BRAIN_PORT}`, {
      path: '/brain-server',
      transports: ['websocket'],
    });

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      observer.on('agent:status_update', (payload) => statusEvents.push(payload));

      await page.goto(`http://127.0.0.1:${THEATER_PORT}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        () => document.body.innerText.includes('SOCKET.IO CONNECTED'),
        undefined,
        {
          timeout: 30_000,
        },
      );
      console.log('✓ theater tersambung ke brain (SOCKET.IO CONNECTED)');

      await page.locator('input[aria-label="Tulis directive founder"]').fill(DIRECTIVE);
      await page.locator('button[type="submit"]').click();
      console.log('» directive dikirim dari UI');

      const deadline = Date.now() + TIMEOUT_MS;
      while (statusEvents.length === 0 && Date.now() < deadline) await sleep(500);
      if (statusEvents.length === 0) {
        throw new Error('tidak ada agent:status_update dari brain setelah directive dikirim');
      }
      console.log(`✓ pipeline mulai — ${statusEvents.length} status diterima dari brain`);

      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="Riwayat directive"]')?.textContent?.includes('1'),
        undefined,
        { timeout: 10_000 },
      );
      console.log('✓ directive ter-queue di founder command bar (riwayat ↺ 1)');
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
