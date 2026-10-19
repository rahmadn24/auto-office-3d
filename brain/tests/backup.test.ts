import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

import { RunStore } from '../src/durability/store';

/**
 * Backup & restore DATA_DIR (Fase 12 — kartu 12.5): tar + checksum + retensi,
 * diuji lewat CLI asli `scripts/backup.mjs` (exit code + JSON stdout), plus
 * bukti restore bisa dibuka kembali oleh RunStore tanpa kehilangan data.
 */

const script = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'backup.mjs');
const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ao3d-backup-'));
  cleanup.push(dir);
  // office.db nyata + lancedb palsu (struktur DATA_DIR seperti produksi).
  const store = new RunStore(new Database(join(dir, 'office.db')));
  store.startRun({ runId: 'run_backup_1', directive: 'backup smoke', projectName: 'Backup Demo' });
  store.finishRun('run_backup_1', { status: 'completed', stage: 'done', tokensUsed: 1234 });
  mkdirSync(join(dir, 'lancedb'), { recursive: true });
  writeFileSync(join(dir, 'lancedb', 'marker.txt'), 'vector store placeholder', 'utf8');
  return dir;
}

function runCli(...cliArgs: string[]): { code: number; json: Record<string, unknown> } {
  const res = spawnSync(process.execPath, [script, ...cliArgs], { encoding: 'utf8' });
  // Sukses → JSON di stdout; error → JSON di stderr (exit 1).
  const raw = (res.stdout ?? '').trim() || (res.stderr ?? '').trim();
  const line = raw.split('\n').pop() ?? '';
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(line) as Record<string, unknown>;
  } catch {
    json = { parseError: line, stderr: res.stderr };
  }
  return { code: res.status ?? -1, json };
}

describe('scripts/backup.mjs — tar + checksum + retensi (Fase 12)', () => {
  it('backup membuat arsip + sidecar sha256 yang cocok', () => {
    const data = makeDataDir();
    const out = mkdtempSync(join(tmpdir(), 'ao3d-out-'));
    cleanup.push(out);

    const { code, json } = runCli('--data', data, '--out', out, '--keep', '7', '--label', 'unit');
    expect(code).toBe(0);
    expect(json.ok).toBe(true);
    expect(json.action).toBe('backup');
    const archive = String(json.archive);
    expect(existsSync(archive)).toBe(true);
    expect(existsSync(`${archive}.sha256`)).toBe(true);
    expect(String(json.archive)).toContain('backup-');
    expect(String(json.archive)).toContain('-unit.tar.gz');
    expect(Number(json.sizeBytes)).toBeGreaterThan(0);

    // Sidecar memakai format `sha256sum` (hash + nama file).
    const sidecar = readFileSync(`${archive}.sha256`, 'utf8').trim();
    expect(sidecar).toMatch(/^[0-9a-f]{64} {2}backup-.+\.tar\.gz$/);
  }, 30_000);

  it('retensi --keep menyisakan N arsip terbaru + membersihkan sidecar-nya', () => {
    const data = makeDataDir();
    const out = mkdtempSync(join(tmpdir(), 'ao3d-out-'));
    cleanup.push(out);

    for (const label of ['satu', 'dua', 'tiga']) {
      const { code } = runCli('--data', data, '--out', out, '--keep', '2', '--label', label);
      expect(code).toBe(0);
    }

    const archives = readdirSync(out).filter((n) => n.endsWith('.tar.gz'));
    const sidecars = readdirSync(out).filter((n) => n.endsWith('.sha256'));
    expect(archives).toHaveLength(2);
    expect(sidecars).toHaveLength(2);
    // Arsip paling awal ('satu') yang dibuang.
    expect(archives.some((n) => n.includes('-satu'))).toBe(false);
    expect(archives.some((n) => n.includes('-tiga'))).toBe(true);
  }, 60_000);

  it('restore memverifikasi checksum lalu RunStore membaca data utuh', () => {
    const data = makeDataDir();
    const out = mkdtempSync(join(tmpdir(), 'ao3d-out-'));
    const restored = join(mkdtempSync(join(tmpdir(), 'ao3d-restore-')), 'data');
    cleanup.push(out);

    const backup = runCli('--data', data, '--out', out);
    expect(backup.code).toBe(0);
    const archive = String(backup.json.archive);
    const digest = String(backup.json.sha256);

    const restore = runCli('--restore', archive, '--target', restored);
    expect(restore.code).toBe(0);
    expect(restore.json.ok).toBe(true);
    expect(restore.json.sha256).toBe(digest);
    expect(existsSync(join(restored, 'lancedb', 'marker.txt'))).toBe(true);

    const db = new Database(join(restored, 'office.db'), { readonly: true });
    const store = new RunStore(db);
    const run = store.getRun('run_backup_1');
    expect(run?.directive).toBe('backup smoke');
    expect(run?.status).toBe('completed');
    expect(run?.tokensUsed).toBe(1234);
    db.close();
  }, 30_000);

  it('arsip korup / checksum hilang → exit 1 tanpa restore', () => {
    const data = makeDataDir();
    const out = mkdtempSync(join(tmpdir(), 'ao3d-out-'));
    const restored = join(mkdtempSync(join(tmpdir(), 'ao3d-restore-')), 'data');
    cleanup.push(out);

    const backup = runCli('--data', data, '--out', out);
    const archive = String(backup.json.archive);

    // Checksum hilang.
    rmSync(`${archive}.sha256`, { force: true });
    const noChecksum = runCli('--restore', archive, '--target', restored);
    expect(noChecksum.code).toBe(1);
    expect(noChecksum.json.ok).toBe(false);

    // Checksum ada tapi arsip dimodifikasi.
    writeFileSync(`${archive}.sha256`, `${'0'.repeat(64)}  ${'x'.repeat(1)}\n`);
    const corrupt = runCli('--restore', archive, '--target', restored);
    expect(corrupt.code).toBe(1);
    expect(String(corrupt.json.error)).toContain('checksum tidak cocok');
    expect(existsSync(restored)).toBe(false);
  }, 30_000);
});
