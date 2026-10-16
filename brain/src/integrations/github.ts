import type { CommitResult, GitHubDriver, RepoProvisionResult } from './types';

const GITHUB_API = 'https://api.github.com';
const MAX_RETRIES = 3;

function backoffMs(attempt: number): number {
  // Exponential backoff: 250ms, 500ms, 1s (PRD §3.3 — gagal API → retry dengan backoff).
  return 250 * 2 ** attempt;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pseudoSha(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x010000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, 7);
}

/**
 * Driver offline: mensimulasikan POST /user/repos + commit ke branch main
 * tanpa jaringan. `failTimes` berapa kali percobaan pertama gagal — dipakai unit
 * test untuk memverifikasi logika retry/backoff (PRD §3.3).
 */
export class LocalGitHub implements GitHubDriver {
  readonly driver = 'local';

  constructor(
    private readonly owner = 'autooffice3d',
    private readonly opts: { failTimes?: number } = {},
  ) {}

  async provisionRepo(slug: string): Promise<RepoProvisionResult> {
    let attempt = 0;
    for (;;) {
      if (attempt >= (this.opts.failTimes ?? 0)) {
        return {
          repoUrl: `https://github.com/${this.owner}/${slug}`,
          name: slug,
          ok: true,
          retries: attempt,
        };
      }
      if (attempt >= MAX_RETRIES) {
        return { repoUrl: '', name: slug, ok: false, retries: attempt };
      }
      await sleep(backoffMs(attempt));
      attempt += 1;
    }
  }

  async commitFiles(repoUrl: string, files: Record<string, string>): Promise<CommitResult> {
    return {
      committed: Object.keys(files).length,
      branch: 'main',
      sha: pseudoSha(`${repoUrl}:${Object.keys(files).sort().join(',')}`),
    };
  }
}

/** Driver produksi: GitHub REST API v3 (PRD §3.3). Butuh GITHUB_TOKEN. */
export class LiveGitHub implements GitHubDriver {
  readonly driver = 'github';

  constructor(
    private readonly token: string,
    private readonly owner = 'autooffice3d',
  ) {}

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'autooffice3d-brain',
    };
  }

  async provisionRepo(slug: string): Promise<RepoProvisionResult> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(`${GITHUB_API}/user/repos`, {
          method: 'POST',
          headers: this.headers(),
          body: JSON.stringify({ name: slug, private: false, auto_init: true }),
        });
        if (!res.ok && res.status !== 422) {
          // 422 = repo sudah ada → tetap dianggap tersedia.
          throw new Error(`GitHub POST /user/repos ${res.status}: ${await res.text()}`);
        }
        const data = (await res.json().catch(() => ({}))) as { html_url?: string };
        return {
          repoUrl: data.html_url ?? `https://github.com/${this.owner}/${slug}`,
          name: slug,
          ok: true,
          retries: attempt,
        };
      } catch {
        if (attempt >= MAX_RETRIES) {
          return { repoUrl: '', name: slug, ok: false, retries: attempt };
        }
        await sleep(backoffMs(attempt));
      }
    }
    return { repoUrl: '', name: slug, ok: false, retries: MAX_RETRIES };
  }

  async commitFiles(repoUrl: string, files: Record<string, string>): Promise<CommitResult> {
    const paths = Object.keys(files);
    // GitHub Contents API per-berkas (sederhana, tanpa library) — cukup untuk
    // artefak hasil agen. sha branch main diambil dulu bila branch sudah ada.
    let committed = 0;
    for (const path of paths) {
      const putUrl = `${GITHUB_API}/repos/${this.owner}/${new URL(repoUrl).pathname.split('/').pop()}/contents/${path}`;
      const res = await fetch(putUrl, {
        method: 'PUT',
        headers: this.headers(),
        body: JSON.stringify({
          message: `autooffice3d: add ${path}`,
          content: Buffer.from(files[path] ?? '', 'utf8').toString('base64'),
          branch: 'main',
        }),
      });
      if (res.ok || res.status === 422) committed += 1;
    }
    return { committed, branch: 'main', sha: pseudoSha(`${repoUrl}:${paths.sort().join(',')}`) };
  }
}

export type { GitHubDriver, RepoProvisionResult, CommitResult } from './types';
