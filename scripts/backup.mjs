#!/usr/bin/env node
/**
 * AutoOffice3D — backup & restore DATA_DIR (PRD §7 Fase 12, kartu 12.5).
 *
 * `office.db` + `lancedb/` adalah aset utama kantor — soak berhari-hari tanpa
 * backup itu risiko. Script ini:
 *
 *   backup : tar.gz DATA_DIR → `<out>/backup-<timestamp>[-label].tar.gz`
 *            + file `<archive>.sha256` (format sha256sum) + retensi N arsip.
 *   restore: verifikasi checksum lalu ekstrak ke folder target (kosong).
 *
 * Pemakaian:
 *   node scripts/backup.mjs [--data brain/data] [--out brain/backups] [--keep 7] [--label soak-h1]
 *   node scripts/backup.mjs --restore brain/backups/backup-....tar.gz --target /tmp/restore [--force]
 *
 * Output selalu satu baris JSON (mudah diparse cron/soak runbook). Exit 0/1.
 * Cron VPS contoh (03:17 tiap hari, retensi 14):
 *   17 3 * * * cd /opt/autooffice3d && node scripts/backup.mjs --keep 14 >> logs/backup.log 2>&1
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);

/** @param {string} name @param {string | undefined} fallback */
function arg(name, fallback) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  const value = args[idx + 1];
  if (!value || value.startsWith('--')) throw new Error(`argumen --${name} butuh nilai`);
  return value;
}

function has(name) {
  return args.includes(`--${name}`);
}

function fail(message) {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
}

function sha256File(file) {
  const hash = createHash('sha256');
  hash.update(readFileSync(file));
  return hash.digest('hex');
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function backupPaths(outDir) {
  return readdirSync(outDir)
    .filter((name) => /^backup-.*\.tar\.gz$/.test(name))
    .map((name) => join(outDir, name))
    .sort()
    .reverse();
}

function runTar(tarArgs) {
  const result = spawnSync('tar', tarArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) throw new Error(`tar tidak tersedia: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`tar gagal (exit ${result.status}): ${result.stderr?.toString().slice(0, 300)}`);
  }
}

function doBackup() {
  const dataDir = resolve(arg('data', process.env.DATA_DIR ?? join('brain', 'data')));
  if (!existsSync(dataDir)) fail(`DATA_DIR tidak ditemukan: ${dataDir}`);
  const outDir = resolve(arg('out', process.env.BACKUP_DIR ?? join(dirname(dataDir), 'backups')));
  const keep = Number(arg('keep', '7'));
  if (!Number.isInteger(keep) || keep < 1) fail(`--keep harus integer ≥ 1 (dapat: ${keep})`);
  const label = arg('label', '');
  mkdirSync(outDir, { recursive: true });

  const name = `backup-${timestamp()}${label ? `-${label.replace(/[^a-zA-Z0-9._-]/g, '-')}` : ''}.tar.gz`;
  const archive = join(outDir, name);

  // Arsip berisi folder data apa adanya (top-level = basename) agar restore
  // dengan --strip-components=1 tetap punya konteks folder.
  runTar(['-czf', archive, '-C', dirname(dataDir), basename(dataDir)]);

  const digest = sha256File(archive);
  writeFileSync(`${archive}.sha256`, `${digest}  ${basename(archive)}\n`, 'utf8');

  const removed = [];
  for (const old of backupPaths(outDir).slice(keep)) {
    rmSync(old, { force: true });
    rmSync(`${old}.sha256`, { force: true });
    removed.push(basename(old));
  }

  return {
    ok: true,
    action: 'backup',
    dataDir,
    archive,
    sha256: digest,
    sizeBytes: statSync(archive).size,
    kept: backupPaths(outDir).length,
    removed,
  };
}

function doRestore() {
  const archive = resolve(arg('restore') ?? '');
  if (!archive || !existsSync(archive)) fail(`arsip tidak ditemukan: ${archive}`);
  const target = resolve(arg('target') ?? '');
  if (!target) fail('--restore butuh --target <folder>');

  const checksumFile = `${archive}.sha256`;
  if (!existsSync(checksumFile)) fail(`file checksum hilang: ${checksumFile}`);
  const expected = readFileSync(checksumFile, 'utf8').trim().split(/\s+/)[0];
  const actual = sha256File(archive);
  if (expected !== actual) fail(`checksum tidak cocok — arsip korup (expected ${expected}, actual ${actual})`);

  if (existsSync(target) && readdirSync(target).length > 0 && !has('force')) {
    fail(`target tidak kosong: ${target} (pakai --force untuk menimpa isinya)`);
  }
  mkdirSync(target, { recursive: true });

  runTar(['-xzf', archive, '-C', target, '--strip-components=1']);
  const files = readdirSync(target);
  return {
    ok: true,
    action: 'restore',
    archive,
    target,
    sha256: actual,
    files: files.slice(0, 20),
    fileCount: files.length,
  };
}

try {
  const result = has('restore') ? doRestore() : doBackup();
  console.log(JSON.stringify(result));
  process.exit(0);
} catch (err) {
  fail(err instanceof Error ? err.message : String(err));
}
