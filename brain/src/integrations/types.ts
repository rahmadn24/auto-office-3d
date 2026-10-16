import type { BuildStep, DeployStatus, HealthReport, SocialPostPayload } from '../types';

/* ────────────── GitHub Repository Provisioning (PRD §3.3) ────────────── */

export interface RepoProvisionResult {
  repoUrl: string;
  name: string;
  ok: boolean;
  /** Berapa kali retry dipanggil sebelum sukses (backoff, PRD §3.3). */
  retries: number;
}

export interface CommitResult {
  committed: number;
  branch: string;
  sha: string;
}

export interface GitHubDriver {
  /** POST /user/repos membuat repositori publik baru (retry + backoff). */
  provisionRepo(slug: string): Promise<RepoProvisionResult>;
  /** Commit semua artefak (specs/, src/, tests/) ke branch main. */
  commitFiles(repoUrl: string, files: Record<string, string>): Promise<CommitResult>;
}

/* ────────────────── Vercel Edge Deployment (PRD §3.3) ────────────────── */

export interface DeployInput {
  slug: string;
  files: Record<string, string>;
  /** Callback per langkah build (untuk disiarkan bertahap ke Theater). */
  onStep?: (steps: BuildStep[], status: DeployStatus) => void;
}

export interface DeployResult {
  liveUrl: string;
  status: DeployStatus;
  buildSteps: BuildStep[];
  /** Uptime detik & bandwidth MB untuk panel deployment (mock di local). */
  uptimeS: number;
  bandwidthMb: number;
  edgeCache: boolean;
}

export interface DeployDriver {
  deploy(input: DeployInput): Promise<DeployResult>;
}

/* ───────────────────── Health Check Probe (PRD §3.3) ───────────────────── */

export interface HealthProbe {
  probe(liveUrl: string): Promise<HealthReport>;
}

/* ────────────────────── Email (PRD §3.4 welcome) ────────────────────── */

export interface EmailDriver {
  send(input: {
    to: string;
    subject: string;
    body: string;
  }): Promise<{ sent: boolean; id: string }>;
}

/* ───────────────── Social Campaign Dispatcher (PRD §3.4) ───────────────── */

export interface SocialDispatchInput {
  runId: string;
  thread: string[];
  hook: string;
}

export interface SocialDriver {
  dispatch(input: SocialDispatchInput): Promise<SocialPostPayload[]>;
}
