import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DockerDeploy, type ExecFn, type ExecResult } from '../src/integrations/dockerdeploy';
import type { DeployStatus } from '../src/types';

function ok(stdout = ''): ExecResult {
  return { code: 0, stdout, stderr: '' };
}

function fail(stderr: string, code = 1): ExecResult {
  return { code, stdout: '', stderr };
}

/** Exec tiruan: merekam perintah + jawaban default Docker yang sehat. */
function makeExec(overrides: Record<string, (cmd: string[]) => ExecResult> = {}): {
  exec: ExecFn;
  calls: string[][];
} {
  const calls: string[][] = [];
  const exec: ExecFn = async (cmd) => {
    calls.push([...cmd]);
    const key = `${cmd[0]} ${cmd[1] ?? ''}`.trim();
    const override = overrides[key];
    if (override) return override(cmd);
    if (cmd[0] === 'docker' && cmd[1] === 'version') return ok('29.8.0\n');
    if (cmd[0] === 'docker' && cmd[1] === 'network') {
      return fail('network with name demo-net already exists');
    }
    if (cmd[0] === 'docker' && cmd[1] === 'image') return ok('184000000\n');
    if (cmd[0] === 'docker' && cmd[1] === 'run') return ok('sha256:container\n');
    return ok();
  };
  return { exec, calls };
}

async function withWorkRoot<T>(fn: (workRoot: string) => Promise<T>): Promise<T> {
  const workRoot = await mkdtemp(join(tmpdir(), 'ao3d-docker-test-'));
  try {
    return await fn(workRoot);
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

const ARTIFACTS = {
  'src/lib/engine.ts': 'export const total = 1;\n',
  'server.mjs': 'artifact-bundle-server-should-not-overwrite-preset',
};

describe('DockerDeploy — DEPLOY_DRIVER=docker (kartu 10.2 & 10.3)', () => {
  it('happy path: render → build → run (network demo + isolasi) → health → READY', async () => {
    await withWorkRoot(async (workRoot) => {
      const { exec, calls } = makeExec();
      const statuses: DeployStatus[] = [];
      const deploy = new DockerDeploy({
        exec,
        workRoot,
        keepContext: true,
        pickPort: async () => 4599,
        probeHealth: async () => true,
        healthIntervalMs: 1,
      });

      const result = await deploy.deploy({
        slug: 'landing-demo',
        projectName: 'Landing Demo',
        runId: 'run_1',
        preset: 'landing',
        directive: 'Build a landing page for indie hackers\nsecond line',
        files: ARTIFACTS,
        onStep: (_steps, status) => statuses.push(status),
      });

      expect(result.status).toBe('ready');
      expect(result.liveUrl).toBe('http://127.0.0.1:4599');
      expect(result.containerName).toBe('ao3d-demo-landing-demo');
      expect(result.buildSteps.map((step) => step.status)).toEqual([
        'done',
        'done',
        'done',
        'done',
      ]);
      expect(statuses.at(-1)).toBe('ready');

      const build = calls.find((cmd) => cmd[0] === 'docker' && cmd[1] === 'build');
      expect(build).toBeDefined();
      expect(build).toContain('-t');
      expect(build).toContain('ao3d-demo-landing-demo');
      const contextDir = build?.[build.length - 1] as string;
      expect(contextDir).toContain('ao3d-deploy-');

      const run = calls.find((cmd) => cmd[0] === 'docker' && cmd[1] === 'run')?.join(' ') ?? '';
      expect(run).toContain('--network demo-net');
      expect(run).toContain('127.0.0.1:4599:4173');
      expect(run).toContain('autooffice3d.demo=1');
      expect(run).toContain('autooffice3d.slug=landing-demo');
      expect(run).toContain('autooffice3d.preset=landing');
      expect(run).toContain('autooffice3d.run=run_1');
      // Isolasi §6.6: nama magic host diblokir, tanpa volume/tanpa socket.
      expect(run).toContain('--add-host=host.docker.internal:0.0.0.0');
      expect(run).toContain('--add-host=gateway.docker.internal:0.0.0.0');
      expect(run).toContain('--cap-drop=ALL');
      expect(run).not.toContain('-v ');
      expect(run).not.toContain('docker.sock');

      // Build context: preset files di root, bundle codegen terisolasi di codegen/.
      const dockerfile = await readFile(join(contextDir, 'Dockerfile'), 'utf8');
      expect(dockerfile).toContain('EXPOSE 4173');
      const rootServer = await readFile(join(contextDir, 'server.mjs'), 'utf8');
      expect(rootServer).toContain("import { createApp, META } from './app.mjs'");
      const artifact = await readFile(join(contextDir, 'codegen', 'server.mjs'), 'utf8');
      expect(artifact).toContain('artifact-bundle-server');
      const provenance = await readFile(join(contextDir, 'codegen', 'provenance.json'), 'utf8');
      expect(provenance).toContain('"preset": "landing"');
      expect(provenance).toContain('"runId": "run_1"');
    });
  });

  it('tanpa daemon Docker → degraded (bukan throw); brain tetap hidup', async () => {
    await withWorkRoot(async (workRoot) => {
      const { exec } = makeExec({
        'docker version': () =>
          fail('Cannot connect to the Docker daemon at unix:///var/run/docker.sock'),
      });
      const statuses: DeployStatus[] = [];
      const deploy = new DockerDeploy({ exec, workRoot, pickPort: async () => 4599 });
      const result = await deploy.deploy({
        slug: 'demo',
        preset: 'landing',
        files: {},
        onStep: (_steps, status) => statuses.push(status),
      });
      expect(result.status).toBe('degraded');
      expect(result.liveUrl).toBe('');
      expect(result.degradedReason).toContain('docker daemon tidak tersedia');
      expect(statuses.at(-1)).toBe('degraded');
    });
  });

  it('build gagal → degraded dengan alasan spesifik', async () => {
    await withWorkRoot(async (workRoot) => {
      const { exec } = makeExec({
        'docker build': () => fail('ERROR: failed to solve: gate gagal'),
      });
      const deploy = new DockerDeploy({ exec, workRoot, pickPort: async () => 4599 });
      const result = await deploy.deploy({ slug: 'demo', preset: 'landing', files: {} });
      expect(result.status).toBe('degraded');
      expect(result.degradedReason).toContain('docker build gagal');
      expect(result.degradedReason).toContain('gate gagal');
    });
  });

  it('health tidak pernah 200 → degraded + containerName (bisa di-spin down)', async () => {
    await withWorkRoot(async (workRoot) => {
      const { exec } = makeExec();
      const deploy = new DockerDeploy({
        exec,
        workRoot,
        pickPort: async () => 4599,
        probeHealth: async () => false,
        healthAttempts: 2,
        healthIntervalMs: 1,
      });
      const result = await deploy.deploy({ slug: 'demo', preset: 'landing', files: {} });
      expect(result.status).toBe('degraded');
      expect(result.degradedReason).toContain('health probe');
      expect(result.containerName).toBe('ao3d-demo-demo');
    });
  });

  it('preset default = saas-fullstack (multi-stage npm) saat input.preset kosong', async () => {
    await withWorkRoot(async (workRoot) => {
      const { exec, calls } = makeExec();
      const deploy = new DockerDeploy({
        exec,
        workRoot,
        keepContext: true,
        pickPort: async () => 4599,
        probeHealth: async () => true,
        healthIntervalMs: 1,
      });
      const result = await deploy.deploy({ slug: 'saasdemo', files: {} });
      expect(result.status).toBe('ready');
      const build = calls.find((cmd) => cmd[0] === 'docker' && cmd[1] === 'build');
      const contextDir = build?.[build.length - 1] as string;
      const dockerfile = await readFile(join(contextDir, 'Dockerfile'), 'utf8');
      expect(dockerfile).toContain('AS deps');
      expect(result.liveUrl).toBe('http://127.0.0.1:4599');
    });
  });

  it('path artefak berbahaya (traversal) ditolak sebelum menulis ke disk', async () => {
    await withWorkRoot(async (workRoot) => {
      const { exec } = makeExec();
      const deploy = new DockerDeploy({ exec, workRoot, pickPort: async () => 4599 });
      const result = await deploy.deploy({
        slug: 'demo',
        preset: 'landing',
        files: { '../evil.ts': 'process.exit(1)' },
      });
      expect(result.status).toBe('degraded');
      expect(result.degradedReason).toContain('unsafe artifact path');
    });
  });

  it('probeHost/publishHost bisa di-override (mode compose office stack)', async () => {
    await withWorkRoot(async (workRoot) => {
      const { exec, calls } = makeExec();
      const deploy = new DockerDeploy({
        exec,
        workRoot,
        publishHost: '0.0.0.0',
        probeHost: 'host.docker.internal',
        pickPort: async () => 4520,
        probeHealth: async () => true,
        healthIntervalMs: 1,
      });
      const result = await deploy.deploy({ slug: 'compose-demo', preset: 'landing', files: {} });
      expect(result.status).toBe('ready');
      expect(result.liveUrl).toBe('http://host.docker.internal:4520');
      const run = calls.find((cmd) => cmd[0] === 'docker' && cmd[1] === 'run')?.join(' ') ?? '';
      expect(run).toContain('0.0.0.0:4520:4173');
    });
  });

  it('spinDown: docker rm -f container; false bila docker menolak', async () => {
    const { exec, calls } = makeExec();
    const deploy = new DockerDeploy({ exec });
    expect(await deploy.spinDown('ao3d-demo-landing-demo')).toBe(true);
    expect(calls.at(-1)).toEqual(['docker', 'rm', '-f', 'ao3d-demo-landing-demo']);

    const failing = new DockerDeploy({ exec: async () => fail('No such container') });
    expect(await failing.spinDown('ao3d-demo-ghost')).toBe(false);
  });

  it('network yang sudah ada ditoleransi; network error lain → degraded', async () => {
    await withWorkRoot(async (workRoot) => {
      const { exec } = makeExec();
      const deploy = new DockerDeploy({
        exec,
        workRoot,
        pickPort: async () => 4599,
        probeHealth: async () => true,
        healthIntervalMs: 1,
      });
      const ready = await deploy.deploy({ slug: 'demo', preset: 'landing', files: {} });
      expect(ready.status).toBe('ready');

      const { exec: execDenied } = makeExec({
        'docker network': () => fail('permission denied while trying to connect'),
      });
      const denied = new DockerDeploy({ exec: execDenied, workRoot, pickPort: async () => 4599 });
      const result = await denied.deploy({ slug: 'demo', preset: 'landing', files: {} });
      expect(result.status).toBe('degraded');
      expect(result.degradedReason).toContain('docker network create gagal');
    });
  });
});
