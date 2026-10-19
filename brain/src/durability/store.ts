import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import Database from 'better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';

import type { EventBus } from '../events';

export type RunStatus = 'running' | 'completed' | 'halted' | 'failed' | 'interrupted';

export interface RunRecord {
  runId: string;
  directive: string;
  projectName: string;
  status: RunStatus;
  stage: string;
  createdAt: string;
  updatedAt: string;
  tokensUsed: number;
  liveUrl: string;
  repoUrl: string;
}

export interface RunEventInput {
  runId: string;
  kind: string;
  agent?: string;
  message?: string;
  payload?: unknown;
}

export interface RunEventRecord {
  id: number;
  runId: string;
  ts: string;
  kind: string;
  agent?: string;
  message?: string;
  payload?: unknown;
}

interface RunRow {
  run_id: string;
  directive: string;
  project_name: string;
  status: RunStatus;
  stage: string;
  created_at: string;
  updated_at: string;
  tokens_used: number;
  live_url: string;
  repo_url: string;
}

interface EventRow {
  id: number;
  run_id: string;
  ts: string;
  kind: string;
  agent: string | null;
  message: string | null;
  payload: string | null;
}

function toRun(row: RunRow): RunRecord {
  return {
    runId: row.run_id,
    directive: row.directive,
    projectName: row.project_name,
    status: row.status,
    stage: row.stage,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tokensUsed: row.tokens_used,
    liveUrl: row.live_url,
    repoUrl: row.repo_url,
  };
}

/** Buka `office.db` di DATA_DIR (WAL + busy timeout) — dipakai RunStore & SqliteSaver. */
export function openOfficeDb(dbPath: string): SqliteDatabase {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

/**
 * Checkpointer LangGraph durable (PRD v3.0 §2.1) — checkpoint tiap node
 * tersimpan di `DATA_DIR/office.db`, sehingga run yang terputus bisa
 * di-resume setelah restart.
 */
export function createCheckpointer(dbPath: string): BaseCheckpointSaver {
  mkdirSync(dirname(dbPath), { recursive: true });
  return SqliteSaver.fromConnString(dbPath);
}

/**
 * Run history + event log durable (SQLite, append-only) — PRD v3.0 §4.4.
 * Theater dapat menampilkan riwayat run walau daemon/browser sudah restart.
 */
export class RunStore {
  private readonly db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        run_id       TEXT PRIMARY KEY,
        directive    TEXT NOT NULL,
        project_name TEXT NOT NULL DEFAULT '',
        status       TEXT NOT NULL,
        stage        TEXT NOT NULL DEFAULT '',
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        tokens_used  INTEGER NOT NULL DEFAULT 0,
        live_url     TEXT NOT NULL DEFAULT '',
        repo_url     TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS run_events (
        id      INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id  TEXT NOT NULL,
        ts      TEXT NOT NULL,
        kind    TEXT NOT NULL,
        agent   TEXT,
        message TEXT,
        payload TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_run_events_run ON run_events (run_id);
      CREATE INDEX IF NOT EXISTS idx_runs_created ON runs (created_at DESC);
    `);
  }

  /** Catat run baru (atau tandai run lama kembali berjalan saat resume). */
  startRun(input: { runId: string; directive: string; projectName?: string }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO runs (run_id, directive, project_name, status, created_at, updated_at)
         VALUES (@runId, @directive, @projectName, 'running', @now, @now)
         ON CONFLICT(run_id) DO UPDATE SET
           status = 'running',
           updated_at = @now,
           directive = excluded.directive,
           project_name = CASE WHEN excluded.project_name <> '' THEN excluded.project_name ELSE runs.project_name END`,
      )
      .run({
        runId: input.runId,
        directive: input.directive,
        projectName: input.projectName ?? '',
        now,
      });
  }

  finishRun(
    runId: string,
    patch: {
      status: RunStatus;
      stage?: string;
      tokensUsed?: number;
      liveUrl?: string;
      repoUrl?: string;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE runs SET
           status = @status,
           stage = COALESCE(@stage, stage),
           tokens_used = COALESCE(@tokensUsed, tokens_used),
           live_url = COALESCE(@liveUrl, live_url),
           repo_url = COALESCE(@repoUrl, repo_url),
           updated_at = @now
         WHERE run_id = @runId`,
      )
      .run({
        runId,
        status: patch.status,
        stage: patch.stage ?? null,
        tokensUsed: patch.tokensUsed ?? null,
        liveUrl: patch.liveUrl ?? null,
        repoUrl: patch.repoUrl ?? null,
        now: new Date().toISOString(),
      });
  }

  appendEvent(input: RunEventInput): void {
    this.db
      .prepare(
        `INSERT INTO run_events (run_id, ts, kind, agent, message, payload)
         VALUES (@runId, @ts, @kind, @agent, @message, @payload)`,
      )
      .run({
        runId: input.runId,
        ts: new Date().toISOString(),
        kind: input.kind,
        agent: input.agent ?? null,
        message: input.message ?? null,
        payload: input.payload === undefined ? null : JSON.stringify(input.payload).slice(0, 2000),
      });
  }

  getRun(runId: string): RunRecord | null {
    const row = this.db.prepare('SELECT * FROM runs WHERE run_id = ?').get(runId) as
      RunRow | undefined;
    return row ? toRun(row) : null;
  }

  listRuns(limit = 20): RunRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM runs ORDER BY created_at DESC LIMIT ?')
      .all(limit) as RunRow[];
    return rows.map(toRun);
  }

  listEvents(runId: string, limit = 200): RunEventRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM run_events WHERE run_id = ? ORDER BY id DESC LIMIT ?')
      .all(runId, limit) as EventRow[];
    return rows.reverse().map((row) => {
      const event: RunEventRecord = {
        id: row.id,
        runId: row.run_id,
        ts: row.ts,
        kind: row.kind,
      };
      if (row.agent) event.agent = row.agent;
      if (row.message) event.message = row.message;
      if (row.payload) {
        try {
          event.payload = JSON.parse(row.payload) as unknown;
        } catch {
          event.payload = row.payload;
        }
      }
      return event;
    });
  }

  /**
   * Boot recovery: run yang tercatat `running` tapi daemon mati ditandai
   * `interrupted` — lalu bisa di-resume lewat `run:resume` (checkpoint SQLite).
   */
  recoverInterrupted(): string[] {
    const rows = this.db
      .prepare("SELECT run_id FROM runs WHERE status = 'running'")
      .all() as Array<{ run_id: string }>;
    if (rows.length === 0) return [];
    this.db
      .prepare("UPDATE runs SET status = 'interrupted', updated_at = ? WHERE status = 'running'")
      .run(new Date().toISOString());
    return rows.map((r) => r.run_id);
  }

  /**
   * Berlangganan event bus daemon → event log durable.
   * Payload besar (artifacts berisi isi berkas) diringkas agar DB tetap ringan.
   */
  attach(bus: EventBus): () => void {
    const offs = [
      bus.onAgent((p) =>
        this.appendEvent({
          runId: p.runId,
          kind: 'agent',
          agent: p.agentId,
          message: p.logMessage,
          payload: { action: p.currentAction, zone: p.targetZone, cycle: p.iterationCycle },
        }),
      ),
      bus.onDeploy((p) =>
        this.appendEvent({
          runId: p.runId,
          kind: 'deploy',
          agent: 'devops_agent',
          message: `${p.status} · ${p.liveUrl}`,
          payload: { status: p.status, liveUrl: p.liveUrl, repoUrl: p.repoUrl },
        }),
      ),
      bus.onMilestone((p) =>
        this.appendEvent({
          runId: p.runId,
          kind: 'milestone',
          message: `first sale ${p.amount} ${p.currency}`,
          payload: { amount: p.amount, currency: p.currency, customer: p.customer },
        }),
      ),
      bus.onRevenue((p) =>
        this.appendEvent({
          runId: p.runId,
          kind: 'revenue',
          message: `sales=${p.salesCount} · gross=${p.grossRevenueArr}`,
          payload: { salesCount: p.salesCount, grossRevenueArr: p.grossRevenueArr },
        }),
      ),
      bus.onSocial((p) =>
        this.appendEvent({
          runId: p.runId,
          kind: 'social',
          agent: 'marketing_agent',
          message: `${p.platform} · ${p.status}`,
          payload: { platform: p.platform, status: p.status, hook: p.hook },
        }),
      ),
      bus.onRetrieval((p) =>
        this.appendEvent({
          runId: p.runId,
          kind: 'retrieval',
          message: `${p.namespace} · hit ${p.topId ?? '-'} (${p.topScore.toFixed(2)})`,
          payload: { namespace: p.namespace, topScore: p.topScore, hits: p.hits },
        }),
      ),
      bus.onArtifacts((p) =>
        this.appendEvent({
          runId: p.runId,
          kind: 'artifacts',
          message: `${p.projectName} · ${p.files.length} files · qa ${p.qaPassed ? 'PASS' : 'FAIL'}`,
          payload: {
            projectName: p.projectName,
            files: p.files.map((f) => f.path),
            qaPassed: p.qaPassed,
            liveUrl: p.liveUrl,
          },
        }),
      ),
      // Fase 11 — handoff Marketer → CS (lead masuk ke mini-CRM).
      bus.onLead((p) =>
        this.appendEvent({
          runId: p.lead.conversationId.startsWith('cs:') ? p.lead.id : 'cs',
          kind: 'lead',
          agent: 'marketing_agent',
          message: `${p.reason} · ${p.lead.source} · ${p.lead.contact}`,
          payload: { leadId: p.lead.id, status: p.lead.status, reason: p.reason },
        }),
      ),
    ];
    return () => offs.forEach((off) => off());
  }
}
