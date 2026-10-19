#!/usr/bin/env node
/**
 * Smoke Docker — harness demo Fase 10 (AC: "E2E lokal Docker Desktop:
 * run → produk ter-deploy demo → bisa diakses → di-stop").
 *
 * Menjalankan Brain dengan DEPLOY_DRIVER=docker (LLM/sandbox stub) lalu, untuk
 * setiap preset stack (default: ketiganya), memverifikasi:
 *   1. container demo hidup berlabel `autooffice3d.demo=1` + port ter-publish;
 *   2. halaman produk & /health merespons 200 di host;
 *   3. isolasi §6.6 — dari dalam container: `host.docker.internal` diblokir,
 *      network = demo-net, tanpa volume (DATA_DIR tidak pernah ter-mount);
 *   4. spin down (`docker rm -f`) benar-benar menghapus instance.
 *
 * Prasyarat: Docker Desktop hidup (`docker info`) + base image node:22-alpine
 * bisa ditarik. Jalankan dari root: `npm run e2e:docker`.
 * Env: SMOKE_PRESETS=landing,saas-fullstack,custom-app · SMOKE_TIMEOUT_MS=240000.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const brainDir = fileURLToPath(new URL('..', import.meta.url));
const BRAIN_PORT = Number(process.env.SMOKE_BRAIN_PORT ?? 4897);
const PRESETS = (process.env.SMOKE_PRESETS ?? 'landing,saas-fullstack,custom-app')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 240_000);
const network = 'demo-net';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function docker(args, opts = {}) {
  try {
    const { stdout, stderr } = await execFileAsync('docker', args, {
      timeout: opts.timeoutMs ?? 60_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return {
      code: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? String(err.message ?? err),
    };
  }
}

async function dockerOrFail(args, label) {
  const result = await docker(args);
  if (result.code !== 0) {
    throw new Error(`${label} gagal: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout;
}

async function waitForHttp(url, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.status === 200) return res;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await sleep(400);
  }
  throw new Error(`timeout menunggu ${label} (${url}) — terakhir: ${last}`);
}

async function listDemoContainers() {
  const out = await dockerOrFail(
    ['ps', '--filter', 'label=autooffice3d.demo=1', '--format', '{{.Names}}\t{{.Ports}}'],
    'docker ps',
  );
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, ports = ''] = line.split('\t');
      const match = /:(\d+)->/.exec(ports);
      return { name, port: match ? Number(match[1]) : null };
    });
}

async function waitForContainer(existing, label) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const found = (await listDemoContainers()).find((c) => !existing.has(c.name) && c.port);
    if (found) return found;
    await sleep(700);
  }
  throw new Error(`timeout menunggu container demo baru muncul (${label})`);
}

async function spinDown(container) {
  await docker(['rm', '-f', container.name]);
  await docker(['rmi', '-f', container.name], { timeoutMs: 120_000 });
  const still = (await listDemoContainers()).find((c) => c.name === container.name);
  if (still) throw new Error(`spin down gagal — container ${container.name} masih ada`);
}

async function assertIsolation(container) {
  // 1) Network terpisah dari office stack.
  const networkMode = (
    await dockerOrFail(
      ['inspect', '-f', '{{.HostConfig.NetworkMode}}', container.name],
      'docker inspect network',
    )
  ).trim();
  if (networkMode !== network) {
    throw new Error(`isolasi gagal — network container = ${networkMode}, harus ${network}`);
  }

  // 2) Tanpa volume → DATA_DIR/Brain tidak pernah ter-mount.
  const mounts = (
    await dockerOrFail(
      ['inspect', '-f', '{{json .Mounts}}', container.name],
      'docker inspect mounts',
    )
  ).trim();
  if (mounts !== '[]') throw new Error(`isolasi gagal — container punya volume: ${mounts}`);

  // 3) host.docker.internal (Brain/9router) harus diblokir dari dalam container.
  const probe = await docker([
    'exec',
    container.name,
    'node',
    '-e',
    "fetch('http://host.docker.internal:4800/health', { signal: AbortSignal.timeout(4000) }).then(() => process.exit(0)).catch(() => process.exit(7))",
  ]);
  if (probe.code === 0) {
    throw new Error('isolasi gagal — container demo bisa menjangkau host.docker.internal (Brain)');
  }
}

async function spinDownAll() {
  const containers = await listDemoContainers();
  for (const container of containers) {
    await spinDown(container);
  }
}

async function main() {
  const info = await docker(['info', '--format', '{{.ServerVersion}}']);
  if (info.code !== 0) {
    throw new Error(
      `Docker daemon tidak tersedia — hidupkan Docker Desktop dulu. (${info.stderr.trim()})`,
    );
  }
  console.log(`✓ docker daemon ${info.stdout.trim()}`);

  const { io } = await import('socket.io-client');
  const dataDir = mkdtempSync(join(tmpdir(), 'ao3d-docker-smoke-'));
  let child = null;
  const logs = [];
  let socket = null;

  const runOnce = (preset) =>
    new Promise((resolve, reject) => {
      socket.emit(
        'founder:directive',
        [
          `Build a ${preset} demo product for indie hackers`,
          '',
          `Preset stack: ${preset}`,
          'Pricing: $29/mo',
        ].join('\n'),
        (ack) =>
          ack?.ok ? resolve() : reject(new Error(`directive ditolak: ${JSON.stringify(ack)}`)),
      );
    });

  const waitRunSettled = async () => {
    const deadline = Date.now() + TIMEOUT_MS;
    while (Date.now() < deadline) {
      const runs = await new Promise((resolve) => socket.emit('run:list', { limit: 5 }, resolve));
      const latest = runs?.runs?.[0];
      if (latest && ['completed', 'failed', 'halted'].includes(latest.status)) return latest;
      await sleep(800);
    }
    throw new Error('timeout menunggu run selesai (run:list)');
  };

  try {
    // Brain dengan driver docker — state temporer, tanpa menyentuh repo.
    child = (await import('node:child_process')).spawn('npm', ['run', 'start'], {
      cwd: brainDir,
      env: {
        ...process.env,
        PORT: String(BRAIN_PORT),
        DATA_DIR: dataDir,
        MEMORY_DRIVER: 'memory',
        LLM_DRIVER: 'stub',
        SANDBOX_DRIVER: 'local',
        DEPLOY_DRIVER: 'docker',
        PAYMENT_DRIVER: 'stub',
        EMAIL_DRIVER: 'stub',
        SOCIAL_DRIVER: 'stub',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const collect = (chunk) => {
      const line = String(chunk).trim();
      if (line) logs.push(line);
      if (logs.length > 400) logs.shift();
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    await waitForHttp(`http://127.0.0.1:${BRAIN_PORT}/health`, 'brain /health', 60_000);
    console.log('✓ brain siap (DEPLOY_DRIVER=docker, LLM stub)');

    // Bersihkan sisa container demo dari sesi sebelumnya.
    await spinDownAll();

    socket = io(`http://127.0.0.1:${BRAIN_PORT}`, {
      path: '/brain-server',
      transports: ['websocket'],
    });
    await new Promise((resolve, reject) => {
      socket.on('connect', resolve);
      socket.on('connect_error', reject);
    });

    for (const preset of PRESETS) {
      const existing = new Set((await listDemoContainers()).map((c) => c.name));
      await runOnce(preset);
      console.log(`» run preset ${preset} dimulai dari directive (socket)`);

      const container = await waitForContainer(existing, preset);
      console.log(`✓ container demo ${container.name} hidup di port ${container.port}`);

      // Produk bisa diakses (AC) — halaman + health check.
      const page = await waitForHttp(`http://127.0.0.1:${container.port}/`, `${preset} /`, 30_000);
      const html = await page.text();
      if (!html.includes(`data-preset="${preset}"`)) {
        throw new Error(`halaman demo bukan preset ${preset}`);
      }
      const health = await (
        await waitForHttp(`http://127.0.0.1:${container.port}/health`, `${preset} /health`, 10_000)
      ).json();
      if (health.ok !== true || health.preset !== preset) {
        throw new Error(`/health tidak sesuai kontrak: ${JSON.stringify(health)}`);
      }
      console.log(`✓ produk ${preset} bisa diakses (200 + /health ok)`);

      await assertIsolation(container);
      console.log('✓ isolasi §6.6 — network demo-net, tanpa volume, host diblokir');

      await spinDown(container);
      console.log(`✓ spin down ${container.name} (container + image dihapus)`);

      const settled = await waitRunSettled();
      console.log(`✓ run ${settled.runId} selesai — status ${settled.status}`);
    }

    return 0;
  } catch (err) {
    console.error(`\nDOCKER SMOKE FAIL ❌ — ${err instanceof Error ? err.message : String(err)}`);
    console.error(`\n--- log brain (${logs.length} baris terakhir) ---`);
    console.error(logs.slice(-40).join('\n'));
    return 1;
  } finally {
    if (socket) socket.close();
    await spinDownAll().catch(() => {});
    if (child) {
      child.kill('SIGTERM');
      await sleep(800);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
}

const exitCode = await main();
if (exitCode === 0) console.log('\nDOCKER SMOKE PASS ✅');
process.exit(exitCode);
