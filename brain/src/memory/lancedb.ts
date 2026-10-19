import { join } from 'node:path';

import type { Connection, Table, VectorQuery } from '@lancedb/lancedb';

import type { Embedder } from './embeddings';
import {
  SIMILARITY_THRESHOLD,
  matchesWhere,
  sortBySeq,
  type MemoryHit,
  type MemoryListQuery,
  type MemoryNamespace,
  type MemoryProvider,
  type MemoryRecord,
} from './provider';

interface LanceRow {
  [key: string]: unknown;
  id: string;
  text: string;
  metadata: string;
  vector: number[];
}

interface RawRow {
  id: string;
  text: string;
  metadata?: string | null;
  _distance?: number;
}

/**
 * Driver default (PRD v3.0 §2.1): LanceDB embedded — durable, zero-server.
 * Satu tabel per namespace di dalam `DATA_DIR/lancedb/`, sehingga ingatan
 * agen selamat dari restart (lokal maupun container VPS).
 *
 * Koneksi dibuat lazily agar `createMemory()` tetap sinkron dan test yang
 * tidak menyentuh disk tidak membayar biaya I/O.
 */
export class LanceDbMemory implements MemoryProvider {
  readonly driver = 'lancedb';
  private dbPromise?: Promise<Connection>;
  private readonly tables = new Map<string, Promise<Table>>();

  constructor(
    private readonly dir: string,
    private readonly embedder: Embedder,
  ) {}

  private db(): Promise<Connection> {
    this.dbPromise ??= import('@lancedb/lancedb').then((lancedb) => lancedb.connect(this.dir));
    return this.dbPromise;
  }

  /** Nama tabel aman untuk LanceDB (`pm-memory` → `pm_memory`). */
  private tableName(namespace: MemoryNamespace): string {
    return namespace.replace(/[^a-z0-9]+/gi, '_');
  }

  private async table(namespace: MemoryNamespace): Promise<Table | null> {
    const db = await this.db();
    const exists = await db.tableNames();
    if (!exists.includes(this.tableName(namespace))) return null;
    const cached = this.tables.get(namespace);
    if (cached) return cached;
    const opened = db.openTable(this.tableName(namespace));
    this.tables.set(namespace, opened);
    return opened;
  }

  async upsert(namespace: MemoryNamespace, records: MemoryRecord[]): Promise<void> {
    if (records.length === 0) return;
    const vectors = await this.embedder.embed(records.map((r) => r.text));
    const rows: LanceRow[] = records.map((record, i) => ({
      id: record.id,
      text: record.text,
      metadata: JSON.stringify(record.metadata ?? {}),
      vector: vectors[i] ?? [],
    }));

    const db = await this.db();
    const name = this.tableName(namespace);
    const existing = await this.table(namespace);
    if (!existing) {
      const created = await db.createTable(name, rows);
      this.tables.set(namespace, Promise.resolve(created));
      return;
    }

    // Upsert by id: update bila id sama, insert bila baru.
    try {
      await existing
        .mergeInsert('id')
        .whenMatchedUpdateAll()
        .whenNotMatchedInsertAll()
        .execute(rows);
    } catch (err) {
      // Skema berubah (mis. dimensi embedding berganti) → bangun ulang tabel.
      const message = err instanceof Error ? err.message : String(err);
      if (/dimension|FixedSizeList|schema/i.test(message)) {
        await db.dropTable(name);
        const recreated = await db.createTable(name, rows);
        this.tables.set(namespace, Promise.resolve(recreated));
        return;
      }
      throw err;
    }
  }

  async search(namespace: MemoryNamespace, query: string, topK = 3): Promise<MemoryHit[]> {
    const table = await this.table(namespace);
    if (!table) return [];
    const [vector] = await this.embedder.embed([query]);
    if (!vector || vector.length === 0) return [];

    let rows: RawRow[];
    try {
      const query = table.search(vector) as VectorQuery;
      rows = (await query.distanceType('cosine').limit(topK).toArray()) as RawRow[];
    } catch {
      return [];
    }

    return rows.map((row) => {
      // Cosine *distance* → similarity (LanceDB: distance = 1 - similarity).
      const score = Math.max(0, Math.min(1, 1 - (row._distance ?? 1)));
      let metadata: Record<string, string | number | boolean> | undefined;
      if (row.metadata) {
        try {
          metadata = JSON.parse(row.metadata) as Record<string, string | number | boolean>;
        } catch {
          metadata = undefined;
        }
      }
      const hit: MemoryHit = { id: row.id, text: row.text, namespace, score };
      if (metadata && Object.keys(metadata).length > 0) hit.metadata = metadata;
      return hit;
    });
  }

  /** Daftar record kronologis (Briefing Room) — scan tabel + filter metadata in-process. */
  async list(namespace: MemoryNamespace, query: MemoryListQuery = {}): Promise<MemoryRecord[]> {
    const table = await this.table(namespace);
    if (!table) return [];
    let rows: RawRow[];
    try {
      rows = (await table.query().toArray()) as RawRow[];
    } catch {
      return [];
    }
    const records: MemoryRecord[] = [];
    for (const row of rows) {
      const record: MemoryRecord = { id: row.id, text: row.text };
      if (row.metadata) {
        try {
          record.metadata = JSON.parse(row.metadata) as Record<string, string | number | boolean>;
        } catch {
          // metadata korup → record tetap terpakai tanpa filter metadata
        }
      }
      if (matchesWhere(record, query.where)) records.push(record);
    }
    return sortBySeq(records).slice(0, query.limit ?? 200);
  }

  async sizes(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    const db = await this.db();
    const names = await db.tableNames();
    for (const name of names) {
      const table = await db.openTable(name);
      out[name.replace(/_/g, '-')] = await table.countRows();
    }
    return out;
  }

  static readonly threshold = SIMILARITY_THRESHOLD;
}

/** Path default driver LanceDB di dalam folder DATA_DIR. */
export function lancedbDir(dataDir: string): string {
  return join(dataDir, 'lancedb');
}
