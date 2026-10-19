import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { renderPresetStack, resolvePreset } from '../products/presets';
import type { BuildStep, DeployStatus } from '../types';
import type { DeployDriver, DeployInput, DeployResult } from './types';

const execFileAsync = promisify(execFile);

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Eksekusi perintah docker — injectable supaya unit test tidak butuh daemon. */
export type ExecFn = (cmd: string[], opts?: { cwd?: string }) => Promise<ExecResult>;

export interface DockerDeployOptions {
  /** Network terpisah untuk container demo (PRD §6.6). */
  network?: string;
  containerPrefix?: string;
  /** Range port host (lokal) untuk mapping ke port container. */
  portRange?: readonly [number, number];
  /** Interface host untuk publish (`-p <publishHost>:port:containerPort`). */
  publishHost?: string;
  /** Host untuk URL health probe (compose: `host.docker.internal`). */
  probeHost?: string;
  healthIntervalMs?: number;
  healthAttempts?: number;
  exec?: ExecFn;
  pickPort?: (start: number, end: number) => Promise<number>;
  probeHealth?: (url: string) => Promise<boolean>;
  workRoot?: string;
  /** Biarkan build context di disk (debug/test). */
  keepContext?: boolean;
  commandTimeoutMs?: number;
  /** URL publik Brain untuk widget CS di halaman produk (Fase 11). */
  widgetUrl?: string;
  /** Path socket Brain (`/brain-server`) yang dipakai widget. */
  widgetSocketPath?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function short(value: string, max = 220): string {
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function sanitizeSegment(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || 'demo';
}

/** Gabung path relatif artefak tanpa membolehkan keluar dari context dir. */
function safeJoin(root: string, relative: string): string {
  const segments = relative
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.');
  if (segments.length === 0 || segments.some((segment) => segment === '..')) {
    throw new Error(`unsafe artifact path: ${relative}`);
  }
  return join(root, ...segments);
}

async function writeFileEnsured(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

function probePortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function defaultPickPort(start: number, end: number): Promise<number> {
  for (let port = start; port <= end; port += 1) {
    if (await probePortFree(port)) return port;
  }
  throw new Error(`tidak ada port bebas di range ${start}-${end}`);
}

async function defaultExec(cmd: string[], opts: { cwd?: string } = {}): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd[0] as string, cmd.slice(1), {
      cwd: opts.cwd,
      timeout: 180_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string; stderr?: string; message?: string };
    return {
      code: typeof e.code === 'number' ? e.code : 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? String(err),
    };
  }
}

async function defaultProbeHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * DeployDriver `docker` (PRD §3.3 & §7 Fase 10):
 *
 *   render preset stack → tulis build context (codegen + preset + Dockerfile)
 *   → `docker build` → `docker run` di network demo → health probe HTTP 200
 *   → READY (atau degraded dengan alasan spesifik).
 *
 * Env-gated: hanya aktif bila `DEPLOY_DRIVER=docker`. Tanpa Docker/daemon,
 * deploy mengembalikan status `degraded` dan otak tetap berjalan (driver
 * `local` adalah default `auto`) — sistem tidak pernah butuh Docker untuk boot.
 */
export class DockerDeploy implements DeployDriver {
  readonly driver = 'docker';
  private readonly network: string;
  private readonly containerPrefix: string;
  private readonly portRange: readonly [number, number];
  private readonly publishHost: string;
  private readonly probeHost: string;
  private readonly healthIntervalMs: number;
  private readonly healthAttempts: number;
  private readonly exec: ExecFn;
  private readonly pickPort: (start: number, end: number) => Promise<number>;
  private readonly probeHealth: (url: string) => Promise<boolean>;
  private readonly workRoot: string;
  private readonly keepContext: boolean;
  private readonly widgetUrl?: string;
  private readonly widgetSocketPath?: string;

  constructor(options: DockerDeployOptions = {}) {
    this.network = options.network ?? 'demo-net';
    this.containerPrefix = options.containerPrefix ?? 'ao3d-demo';
    this.portRange = options.portRange ?? [4510, 4599];
    this.publishHost = options.publishHost ?? '127.0.0.1';
    this.probeHost = options.probeHost ?? '127.0.0.1';
    this.healthIntervalMs = options.healthIntervalMs ?? 500;
    this.healthAttempts = options.healthAttempts ?? 30;
    this.exec = options.exec ?? defaultExec;
    this.pickPort = options.pickPort ?? defaultPickPort;
    this.probeHealth = options.probeHealth ?? defaultProbeHealth;
    this.workRoot = options.workRoot ?? tmpdir();
    this.keepContext = options.keepContext ?? false;
    this.widgetUrl = options.widgetUrl;
    this.widgetSocketPath = options.widgetSocketPath;
  }

  async deploy(input: DeployInput): Promise<DeployResult> {
    const preset = resolvePreset(input.preset);
    const slug = sanitizeSegment(input.slug);
    const name = sanitizeSegment(`${this.containerPrefix}-${slug}`);
    const runId = input.runId ?? 'demo';
    const directive = input.directive ?? '';
    const tagline = directive
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)[0]
      ?.slice(0, 160);
    const pricing = /\$\s?\d+(?:[.,]\d+)?(?:\s*\/\s*mo)?/i.exec(directive)?.[0];

    const steps: BuildStep[] = [
      { label: `render ${preset.id} stack`, status: 'pending' },
      { label: `docker build ${name}`, status: 'pending' },
      { label: `docker run --network ${this.network}`, status: 'pending' },
      { label: `health probe ${preset.healthPath}`, status: 'pending' },
    ];
    const publish = (status: DeployStatus): void => {
      input.onStep?.(
        steps.map((step) => ({ ...step })),
        status,
      );
    };
    const setStep = (index: number, status: BuildStep['status']): void => {
      steps[index] = { ...(steps[index] as BuildStep), status };
    };
    const degraded = (reason: string, containerStarted = false): DeployResult => {
      publish('degraded');
      return {
        liveUrl: '',
        status: 'degraded',
        buildSteps: steps.map((step) => ({ ...step })),
        uptimeS: 0,
        bandwidthMb: 0,
        edgeCache: false,
        containerName: containerStarted ? name : undefined,
        degradedReason: reason,
      };
    };

    publish('building');
    setStep(0, 'running');
    publish('building');

    const stack = renderPresetStack(preset.id, {
      projectName: input.projectName ?? input.slug,
      slug,
      tagline,
      pricing,
      runId,
      ...(this.widgetUrl
        ? {
            widget: {
              url: this.widgetUrl,
              ...(this.widgetSocketPath ? { socketPath: this.widgetSocketPath } : {}),
            },
          }
        : {}),
    });

    let workspace: string | null = null;
    try {
      workspace = await mkdtemp(join(this.workRoot, 'ao3d-deploy-'));
      const contextDir = join(workspace, slug);
      await mkdir(contextDir, { recursive: true });
      // Bundle codegen disimpan di `codegen/` agar tidak bisa menimpa runtime
      // preset (Dockerfile/app.mjs hasil render) — provenance tetap ikut image.
      for (const [path, content] of Object.entries(input.files)) {
        await writeFileEnsured(safeJoin(join(contextDir, 'codegen'), path), content);
      }
      for (const [path, content] of Object.entries(stack.files)) {
        await writeFileEnsured(join(contextDir, path), content);
      }
      await writeFileEnsured(
        join(contextDir, 'codegen', 'provenance.json'),
        `${JSON.stringify(
          {
            generatedBy: 'AutoOffice3D',
            preset: preset.id,
            slug,
            runId,
            files: Object.keys(input.files).length,
            renderedAt: new Date().toISOString(),
          },
          null,
          2,
        )}\n`,
      );

      const version = await this.exec(['docker', 'version', '--format', '{{.Server.Version}}']);
      if (version.code !== 0) {
        return degraded(`docker daemon tidak tersedia · ${short(version.stderr)}`);
      }

      const network = await this.exec([
        'docker',
        'network',
        'create',
        '--label',
        'autooffice3d.demo=1',
        this.network,
      ]);
      if (network.code !== 0 && !/already exists/i.test(network.stderr)) {
        return degraded(`docker network create gagal · ${short(network.stderr)}`);
      }

      setStep(0, 'done');
      setStep(1, 'running');
      publish('building');
      const build = await this.exec([
        'docker',
        'build',
        '--label',
        'autooffice3d.demo=1',
        '-t',
        name,
        contextDir,
      ]);
      if (build.code !== 0) {
        return degraded(`docker build gagal · ${short(build.stderr || build.stdout)}`);
      }

      // Bersihkan context setelah build (kecuali mode debug/test).
      if (!this.keepContext) {
        await rm(workspace, { recursive: true, force: true });
        workspace = null;
      }

      setStep(1, 'done');
      setStep(2, 'running');
      publish('deploying');

      let hostPort: number;
      try {
        hostPort = await this.pickPort(this.portRange[0], this.portRange[1]);
      } catch (err) {
        return degraded((err as Error).message);
      }

      // Idempoten: container lama dengan nama sama dibuang dulu.
      await this.exec(['docker', 'rm', '-f', name]);
      const run = await this.exec([
        'docker',
        'run',
        '-d',
        '--name',
        name,
        '--network',
        this.network,
        '--label',
        'autooffice3d.demo=1',
        '--label',
        `autooffice3d.slug=${slug}`,
        '--label',
        `autooffice3d.preset=${preset.id}`,
        '--label',
        `autooffice3d.run=${runId}`,
        // Siap untuk Caddy wildcard Fase 12 (label dibaca caddy-docker-proxy).
        '--label',
        `autooffice3d.route=demo.${slug}.localhost`,
        // Isolasi §6.6: container demo tidak boleh menjangkau host (Brain,
        // 9router) lewat nama magic Docker Desktop; tanpa volume → DATA_DIR
        // tidak pernah ter-mount.
        '--add-host=host.docker.internal:0.0.0.0',
        '--add-host=gateway.docker.internal:0.0.0.0',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--memory=256m',
        '--cpus=0.5',
        '-e',
        `PORT=${stack.port}`,
        '-p',
        `${this.publishHost}:${hostPort}:${stack.port}`,
        name,
      ]);
      if (run.code !== 0) {
        return degraded(`docker run gagal · ${short(run.stderr)}`);
      }

      setStep(2, 'done');
      setStep(3, 'running');
      publish('deploying');

      const liveUrl = `http://${this.probeHost}:${hostPort}`;
      const healthUrl = `${liveUrl}${stack.healthPath}`;
      let healthy = false;
      for (let attempt = 0; attempt < this.healthAttempts; attempt += 1) {
        if (await this.probeHealth(healthUrl)) {
          healthy = true;
          break;
        }
        if (attempt < this.healthAttempts - 1) await sleep(this.healthIntervalMs);
      }
      if (!healthy) {
        return degraded(
          `health probe ${stack.healthPath} gagal (${this.healthAttempts}x percobaan)`,
          true,
        );
      }

      setStep(3, 'done');
      publish('ready');

      const inspect = await this.exec([
        'docker',
        'image',
        'inspect',
        '--format',
        '{{.Size}}',
        name,
      ]);
      const bytes = inspect.code === 0 ? Number(inspect.stdout.trim()) : 0;
      const bandwidthMb =
        Number.isFinite(bytes) && bytes > 0 ? Number((bytes / 1_000_000).toFixed(2)) : 0;

      return {
        liveUrl,
        status: 'ready',
        buildSteps: steps.map((step) => ({ ...step })),
        uptimeS: 0,
        bandwidthMb,
        edgeCache: false,
        containerName: name,
      };
    } catch (err) {
      return degraded(`deploy error · ${short((err as Error).message)}`);
    } finally {
      if (workspace && !this.keepContext) {
        await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  /** Spin down instance demo — `docker rm -f <container>`. */
  async spinDown(containerName: string): Promise<boolean> {
    const name = sanitizeSegment(containerName);
    const result = await this.exec(['docker', 'rm', '-f', name]);
    return result.code === 0;
  }
}

export { sanitizeSegment as sanitizeDemoName };
