import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import {
  PRODUCT_PRESETS,
  PRODUCT_PRESET_IDS,
  detectPreset,
  normalizePresetId,
  renderPresetStack,
  resolvePreset,
} from '../src/products/presets';

const execFileAsync = promisify(execFile);

describe('preset stack tier-1 (kartu 10.1 — PRD §3.1)', () => {
  it('registry lengkap: landing / saas-fullstack / custom-app, port & gate sendiri', () => {
    expect(PRODUCT_PRESETS.map((preset) => preset.id)).toEqual([...PRODUCT_PRESET_IDS]);
    for (const preset of PRODUCT_PRESETS) {
      expect(preset.port).toBeGreaterThan(1024);
      expect(preset.healthPath).toBe('/health');
      expect(preset.tier1).toMatch(/TypeScript\/Node/);
      const stack = preset.render({ projectName: 'Demo', slug: 'demo' });
      expect(stack.port).toBe(preset.port);
      expect(stack.gate.length).toBeGreaterThan(0);
    }
    const ports = PRODUCT_PRESETS.map((preset) => preset.port);
    expect(new Set(ports).size).toBe(ports.length);
  });

  it('Dockerfile template per preset memuat gate-nya sendiri + EXPOSE port', () => {
    for (const preset of PRODUCT_PRESETS) {
      const stack = preset.render({ projectName: 'Demo', slug: 'demo' });
      expect(stack.dockerfile).toContain('FROM node:22-alpine');
      expect(stack.dockerfile).toContain(`RUN ${stack.gate}`);
      expect(stack.dockerfile).toContain(`EXPOSE ${preset.port}`);
      expect(stack.dockerfile).toContain('CMD ["node", "server.mjs"]');
      expect(stack.dockerfile).toContain('HEALTHCHECK');
      expect(stack.files.Dockerfile).toBe(stack.dockerfile);
    }
  });

  it('saas-fullstack memakai multi-stage npm; landing/custom-app tidak', () => {
    const saas = renderPresetStack('saas-fullstack', { projectName: 'Demo', slug: 'demo' });
    expect(saas.dockerfile).toContain('AS deps');
    expect(saas.files['package.json']).toContain('"demo-demo"');
    const landing = renderPresetStack('landing', { projectName: 'Demo', slug: 'demo' });
    expect(landing.dockerfile).not.toContain('AS deps');
    expect(landing.files['package.json']).toBeUndefined();
  });

  it('berkas runtime lengkap: app.mjs / server.mjs / selftest.mjs / README + tagline & runId', () => {
    const stack = renderPresetStack('custom-app', {
      projectName: 'Ops Portal',
      slug: 'opsportal',
      tagline: 'Internal tool untuk tim ops',
      pricing: '$49/mo',
      runId: 'run_abc',
    });
    expect(Object.keys(stack.files)).toEqual(
      expect.arrayContaining(['app.mjs', 'server.mjs', 'selftest.mjs', 'README.md', 'Dockerfile']),
    );
    expect(stack.files['app.mjs']).toContain('opsportal');
    expect(stack.files['app.mjs']).toContain('Internal tool untuk tim ops');
    expect(stack.files['README.md']).toContain('run_abc');
  });

  it('setiap preset lolos gate-nya sendiri saat dijalankan dengan node (tanpa Docker)', async () => {
    for (const preset of PRODUCT_PRESETS) {
      const dir = await mkdtemp(join(tmpdir(), `ao3d-preset-${preset.id}-`));
      try {
        const stack = preset.render({
          projectName: `Gate Demo ${preset.id}`,
          slug: 'gatedemo',
          tagline: 'Deterministic gate check',
        });
        for (const [path, content] of Object.entries(stack.files)) {
          const target = join(dir, path);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, content, 'utf8');
        }
        const { stdout } = await execFileAsync(process.execPath, ['selftest.mjs'], {
          cwd: dir,
          timeout: 20_000,
        });
        expect(stdout).toContain('selftest OK');
        expect(stdout).toContain(`preset ${preset.id}`);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  }, 60_000);

  it('detectPreset: baris brief eksplisit menang, lalu keyword, default custom-app', () => {
    const briefDirective = [
      'Landing page keren untuk waitlist',
      '',
      '[Brief Ringkas — hasil Briefing Room]',
      '- Audience: indie hackers',
      '- Preset stack: saas-fullstack',
      '- Model harga: $29/mo',
    ].join('\n');
    expect(detectPreset(briefDirective)).toBe('saas-fullstack');
    expect(detectPreset('Build a landing page with a waitlist form')).toBe('landing');
    expect(detectPreset('An invoice engine with checkout and a billing dashboard')).toBe(
      'saas-fullstack',
    );
    expect(detectPreset('internal tool portal for the ops team')).toBe('custom-app');
    expect(detectPreset('Buat produk yang keren sekali')).toBe('custom-app');
    expect(detectPreset('preset = landing')).toBe('landing');
  });

  it('normalizePresetId + resolvePreset fallback default PM', () => {
    expect(normalizePresetId('saas')).toBe('saas-fullstack');
    expect(normalizePresetId('full-stack')).toBe('saas-fullstack');
    expect(normalizePresetId('app')).toBe('custom-app');
    expect(normalizePresetId('bogus')).toBeNull();
    expect(resolvePreset('bogus').id).toBe('saas-fullstack');
    expect(resolvePreset(undefined).id).toBe('saas-fullstack');
    expect(resolvePreset('landing').id).toBe('landing');
  });
});
