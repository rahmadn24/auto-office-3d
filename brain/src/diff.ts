/** Diff per-berkas antar dua iterasi codegen (PRD §3.2 — Dev Agent mengirim diff). */

export type DiffStatus = 'created' | 'modified' | 'deleted' | 'unchanged';

export interface FileDiff {
  status: DiffStatus;
  added: number;
  removed: number;
}

export type ArtifactDiff = Record<string, FileDiff>;

function countLines(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of text.split('\n')) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }
  return counts;
}

/** Diff berbasis multiset baris (tanpa LCS) — cukup untuk telemetri HUD. */
export function diffArtifacts(
  before: Record<string, string>,
  after: Record<string, string>,
): ArtifactDiff {
  const result: ArtifactDiff = {};

  for (const [path, afterText] of Object.entries(after)) {
    const beforeText = before[path];
    if (beforeText === undefined) {
      result[path] = {
        status: 'created',
        added: afterText.split('\n').length,
        removed: 0,
      };
      continue;
    }
    if (beforeText === afterText) {
      result[path] = { status: 'unchanged', added: 0, removed: 0 };
      continue;
    }

    const beforeLines = countLines(beforeText);
    const afterLines = countLines(afterText);
    let added = 0;
    let removed = 0;

    for (const [line, count] of afterLines) {
      const delta = count - (beforeLines.get(line) ?? 0);
      if (delta > 0) added += delta;
    }
    for (const [line, count] of beforeLines) {
      const delta = count - (afterLines.get(line) ?? 0);
      if (delta > 0) removed += delta;
    }

    result[path] = { status: 'modified', added, removed };
  }

  for (const path of Object.keys(before)) {
    if (!(path in after)) {
      result[path] = {
        status: 'deleted',
        added: 0,
        removed: before[path]?.split('\n').length ?? 0,
      };
    }
  }

  return result;
}

export function diffSummary(diff: ArtifactDiff): string {
  const entries = Object.values(diff).filter((d) => d.status !== 'unchanged');
  const added = entries.reduce((sum, d) => sum + d.added, 0);
  const removed = entries.reduce((sum, d) => sum + d.removed, 0);
  const created = entries.filter((d) => d.status === 'created').length;
  return `+${added}/-${removed} across ${entries.length} files (${created} new)`;
}
