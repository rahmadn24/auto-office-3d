import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Kontrak DATA_DIR (PRD v3.0 §2.1) — seluruh state durable Tinggal di satu folder:
 *
 *   <DATA_DIR>/
 *   ├── lancedb/     # vector memory (namespace per divisi)
 *   └── office.db    # SQLite: checkpoint LangGraph, run history, event log
 *
 * Saat pindah VPS (Fase 12), folder ini di-mount menjadi Docker volume —
 * restart = resume, bukan reset.
 */
export interface DataPaths {
  root: string;
  lancedb: string;
  dbPath: string;
}

export function dataPaths(dataDir: string): DataPaths {
  const root = resolve(dataDir);
  return {
    root,
    lancedb: join(root, 'lancedb'),
    dbPath: join(root, 'office.db'),
  };
}

/** Buat folder data bila belum ada (idempoten). Mode 0700 — isi folder bersifat privat. */
export function ensureDataDir(dataDir: string): DataPaths {
  const paths = dataPaths(dataDir);
  mkdirSync(paths.root, { recursive: true, mode: 0o700 });
  return paths;
}
