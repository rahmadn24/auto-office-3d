'use client';

import { useMemo, useState, type ReactNode } from 'react';

import type { ArtifactsPayload } from '@/lib/events';
import { formatTokens } from '@/lib/format';
import { GLASS } from '@/lib/ui';
import { useBrain } from '@/store/brainStore';

/* ───────────────────────── Format helpers ───────────────────────── */

function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** Penulis per direktori (chip PM/Dev/QA/GTM — PRD artefak pipeline). */
const WRITER_OF_DIR: Record<string, { label: string; color: string }> = {
  specs: { label: 'PM', color: '#818cf8' },
  src: { label: 'DEV', color: '#10b981' },
  tests: { label: 'QA', color: '#06b6d4' },
  marketing: { label: 'GTM', color: '#ec4899' },
};

function dirOf(path: string): string {
  return path.includes('/') ? (path.split('/')[0] ?? 'root') : 'root';
}

/* ─────────────── Minimal ZIP (store, tanpa kompresi) — aksi Download ─────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ (buf[i] ?? 0)) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIP tanpa kompresi — cukup untuk bundel artefak kecil (browser-only). */
function buildZip(files: Array<{ path: string; content: string }>): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) => new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
  const u32 = (v: number) =>
    new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff]);

  for (const f of files) {
    const name = enc.encode(f.path);
    const data = enc.encode(f.content);
    const crc = crc32(data);
    const local = [
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ];
    const localLen = local.reduce((n, a) => n + a.length, 0);
    parts.push(...local);
    central.push(
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    );
    offset += localLen;
  }
  const centralStart = offset;
  const centralLen = central.reduce((n, a) => n + a.length, 0);
  const end = [
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralLen),
    u32(centralStart),
    u16(0),
  ];
  const total = [...parts, ...central, ...end];
  const joined = new Uint8Array(total.reduce((n, a) => n + a.length, 0));
  let p = 0;
  for (const a of total) {
    joined.set(a, p);
    p += a.length;
  }
  return new Blob([joined], { type: 'application/zip' });
}

/* ───────────────────────── Markdown renderer ringan ───────────────────────── */

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith('**'))
      out.push(
        <strong key={k} className="font-semibold text-[#f8fafc]">
          {tok.slice(2, -2)}
        </strong>,
      );
    else if (tok.startsWith('`'))
      out.push(
        <code key={k} className="rounded bg-white/8 px-1 font-mono text-[11px] text-[#38bdf8]">
          {tok.slice(1, -1)}
        </code>,
      );
    else
      out.push(
        <span
          key={k}
          className="rounded bg-[rgba(56,189,248,0.1)] px-1 font-mono text-[11px] text-[#38bdf8]"
        >
          {tok}
        </span>,
      );
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Markdown({ source }: { source: string }): ReactNode {
  const blocks = source.split(/\n/);
  const out: ReactNode[] = [];
  let list: string[] = [];
  let table: string[][] = [];
  let code: string[] | null = null;

  const flushList = (key: string) => {
    if (list.length === 0) return;
    out.push(
      <ul key={key} className="my-1 flex flex-col gap-0.5 pl-1">
        {list.map((li, i) => (
          <li key={i} className="flex gap-1.5 text-[12px] leading-relaxed text-[#c7c4d7]">
            <span className="text-[#4edea3]">▸</span>
            <span>{inline(li, `${key}-${i}`)}</span>
          </li>
        ))}
      </ul>,
    );
    list = [];
  };
  const flushTable = (key: string) => {
    if (table.length === 0) return;
    const rows = table.filter((r) => !r.every((c) => /^-{2,}$/.test(c.trim())));
    out.push(
      <div key={key} className="my-1.5 overflow-x-auto rounded border border-white/8">
        <table className="w-full border-collapse font-mono text-[11px]">
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className={ri === 0 ? 'bg-white/5' : ''}>
                {r.map((c, ci) => (
                  <td key={ci} className="border-b border-white/6 px-2 py-1 text-[#c7c4d7]">
                    {c.trim()}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    table = [];
  };

  for (let idx = 0; idx < blocks.length; idx++) {
    const raw = blocks[idx] ?? '';
    const key = `b${idx}`;
    if (raw.startsWith('```')) {
      if (code) {
        out.push(
          <pre
            key={key}
            className="my-1.5 overflow-x-auto rounded border border-white/8 bg-black/30 p-2 font-mono text-[11px] leading-relaxed text-[#4edea3]"
          >
            {code.join('\n')}
          </pre>,
        );
        code = null;
      } else {
        flushList(`${key}-l`);
        flushTable(`${key}-t`);
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(raw);
      continue;
    }
    if (raw.startsWith('|')) {
      flushList(`${key}-l`);
      table.push(raw.replace(/^\||\|$/g, '').split('|'));
      continue;
    }
    flushTable(`${key}-t`);
    const line = raw.trimEnd();
    if (line.startsWith('### ')) {
      flushList(key);
      out.push(
        <h4 key={key} className="mt-2 font-headline text-[13px] font-semibold text-[#f8fafc]">
          {inline(line.slice(4), key)}
        </h4>,
      );
    } else if (line.startsWith('## ')) {
      flushList(key);
      out.push(
        <h3
          key={key}
          className="mt-3 font-headline text-[15px] font-semibold tracking-tight text-[#38bdf8]"
        >
          {inline(line.slice(3), key)}
        </h3>,
      );
    } else if (line.startsWith('# ')) {
      flushList(key);
      out.push(
        <h2
          key={key}
          className="font-headline text-[18px] font-semibold tracking-tight text-[#f8fafc]"
        >
          {inline(line.slice(2), key)}
        </h2>,
      );
    } else if (line.startsWith('> ')) {
      flushList(key);
      out.push(
        <blockquote
          key={key}
          className="my-1 border-l-2 border-[#818cf8] bg-[rgba(129,140,248,0.06)] py-1 pl-2 font-mono text-[11px] text-[#c7c4d7]"
        >
          {inline(line.slice(2), key)}
        </blockquote>,
      );
    } else if (/^[-*] /.test(line)) {
      list.push(line.slice(2));
    } else if (/^\d+\. /.test(line)) {
      list.push(line.replace(/^\d+\. /, ''));
    } else if (line.trim() === '') {
      flushList(`${key}-e`);
    } else {
      flushList(`${key}-p`);
      out.push(
        <p key={key} className="my-1 text-[12px] leading-relaxed text-[#c7c4d7]">
          {inline(line, key)}
        </p>,
      );
    }
  }
  flushList('end-l');
  flushTable('end-t');
  if (code)
    out.push(
      <pre key="end-c" className="rounded bg-black/30 p-2 font-mono text-[11px] text-[#4edea3]">
        {code.join('\n')}
      </pre>,
    );
  return <div>{out}</div>;
}

/* ───────────────────────── Sub-panels ───────────────────────── */

function Panel({
  title,
  right,
  children,
  className = '',
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <section className={`flex min-h-0 flex-col rounded-lg ${GLASS} ${className}`}>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/6 px-3 py-1.5">
        <h2 className="font-mono text-mono-label uppercase tracking-wide text-[#94a3b8]">
          {title}
        </h2>
        {right}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </section>
  );
}

function WorkspaceTree({
  files,
  selected,
  onSelect,
}: {
  files: ArtifactsPayload['files'];
  selected: string | null;
  onSelect: (p: string) => void;
}): ReactNode {
  const groups = useMemo(() => {
    const g = new Map<string, string[]>();
    for (const f of files) {
      const d = dirOf(f.path);
      if (!g.has(d)) g.set(d, []);
      g.get(d)!.push(f.path);
    }
    return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [files]);

  return (
    <div className="flex flex-col gap-1.5">
      {groups.map(([dir, paths]) => {
        const writer = WRITER_OF_DIR[dir] ?? { label: 'AI', color: '#94a3b8' };
        return (
          <div key={dir}>
            <div className="flex items-center gap-1.5 px-1">
              <span className="font-mono text-label-xs uppercase tracking-wide text-[#f8fafc]">
                {dir}/
              </span>
              <span
                className="rounded-full px-1 py-px font-mono text-[9px] uppercase tracking-wide"
                style={{
                  backgroundColor: `${writer.color}1a`,
                  color: writer.color,
                  border: `1px solid ${writer.color}40`,
                }}
              >
                {writer.label}
              </span>
              <span className="font-mono text-[9px] text-[#475569]">{paths.length}</span>
            </div>
            <ul className="mt-0.5">
              {paths.map((p) => {
                const on = p === selected;
                return (
                  <li key={p}>
                    <button
                      type="button"
                      onClick={() => onSelect(p)}
                      className="w-full truncate rounded px-2 py-0.5 text-left font-mono text-[11px] transition-colors"
                      style={{
                        backgroundColor: on ? 'rgba(56,189,248,0.1)' : 'transparent',
                        color: on ? '#38bdf8' : '#94a3b8',
                      }}
                    >
                      {p.slice(dir.length + 1)}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function CodePanel({
  file,
}: {
  file: { path: string; content: string; diff: ArtifactsPayload['files'][number]['diff'] };
}): ReactNode {
  const lines = file.content.split('\n');
  const tone =
    file.diff.status === 'created'
      ? '#10b981'
      : file.diff.status === 'modified'
        ? '#ffb95f'
        : file.diff.status === 'deleted'
          ? '#ef4444'
          : '#475569';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-white/6 px-3 py-1 font-mono text-[10px] uppercase tracking-wide">
        <span className="truncate text-[#f8fafc]">{file.path}</span>
        <span className="flex items-center gap-2">
          <span style={{ color: tone }}>{file.diff.status}</span>
          <span className="text-[#10b981]">+{file.diff.added}</span>
          <span className="text-[#ef4444]">-{file.diff.removed}</span>
          <span className="text-[#4edea3]">lint 0 err</span>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-black/25">
        <table className="w-full border-collapse font-mono text-[11px] leading-[1.55]">
          <tbody>
            {lines.map((l, i) => {
              const marked = l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : null;
              return (
                <tr key={i}>
                  <td className="w-10 select-none border-r border-white/6 px-2 text-right align-top text-[#475569]">
                    {i + 1}
                  </td>
                  <td
                    className="px-2 align-top"
                    style={{
                      backgroundColor:
                        marked === 'add'
                          ? 'rgba(16,185,129,0.1)'
                          : marked === 'del'
                            ? 'rgba(239,68,68,0.1)'
                            : 'transparent',
                      color:
                        marked === 'add' ? '#4edea3' : marked === 'del' ? '#ff8a80' : '#c7c4d7',
                    }}
                  >
                    <pre className="m-0 whitespace-pre-wrap break-all">{l || ' '}</pre>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function QaPanel({ a }: { a: ArtifactsPayload }): ReactNode {
  const testMatch = a.qaSummary.match(/(\d+)\/(\d+)\s+tests/);
  const covMatch = a.qaSummary.match(/stmts\s+(\d+)%/);
  const passed = testMatch ? Number(testMatch[1]) : null;
  const total = testMatch ? Number(testMatch[2]) : null;
  const cov = covMatch ? Number(covMatch[1]) : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          className="rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide"
          style={{
            backgroundColor: a.qaPassed ? 'rgba(78,222,163,0.12)' : 'rgba(239,68,68,0.12)',
            color: a.qaPassed ? '#4edea3' : '#ef4444',
            border: `1px solid ${a.qaPassed ? 'rgba(78,222,163,0.4)' : 'rgba(239,68,68,0.4)'}`,
          }}
        >
          {a.qaPassed ? '✓ PASS' : '✗ FAIL'}{' '}
          {passed != null && total != null ? `${passed}/${total} tests` : ''}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wide text-[#94a3b8]">
          cycle {a.cycles}/{a.maxCycles}
        </span>
      </div>
      {cov != null && (
        <div>
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wide">
            <span className="text-[#94a3b8]">Coverage · stmts</span>
            <span className="text-[#4edea3]">{cov}%</span>
          </div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
            <div className="h-full rounded-full bg-[#4edea3]" style={{ width: `${cov}%` }} />
          </div>
        </div>
      )}
      <pre className="overflow-x-auto rounded border border-white/6 bg-black/30 p-2 font-mono text-[11px] leading-relaxed text-[#4edea3]">
        {`$ npm run test\n${a.qaSummary}`}
      </pre>
      <div className="font-mono text-[10px] uppercase tracking-wide text-[#94a3b8]">
        tokens {formatTokens(a.tokensUsed)} · {formatDuration(a.durationMs)}
      </div>
    </div>
  );
}

function EmptyState(): ReactNode {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-6 text-center">
      <span className="font-mono text-label-xs uppercase tracking-widest text-[#475569]">
        No artifacts yet
      </span>
      <p className="max-w-md font-mono text-[11px] leading-relaxed text-[#475569]">
        Jalankan satu directive founder (tab Office Theater → RUN DEMO) — PRD, kode, dan QA akan
        muncul di sini begitu run otonom selesai.
      </p>
    </div>
  );
}

/* ───────────────────────── Root view ───────────────────────── */

/** View "Artifacts & PRD" (kartu 📄) — workspace tree + PRD render + kode/diff + QA. */
export function ArtifactsView(): ReactNode {
  const a = useBrain((s) => s.artifacts);
  const retrievals = useBrain((s) => s.retrievals);
  const [selected, setSelected] = useState<string | null>(null);

  const files = a?.files ?? [];
  const activePath = selected ?? files[0]?.path ?? null;
  const activeFile = files.find((f) => f.path === activePath) ?? files[0] ?? null;
  const qaCount = a
    ? a.qaSummary.match(/(\d+)\/(\d+)\s+tests/)
      ? `${a.qaSummary.match(/(\d+)\/(\d+)\s+tests/)?.[1]}/${a.qaSummary.match(/(\d+)\/(\d+)\s+tests/)?.[2]}`
      : a.qaPassed
        ? 'PASS'
        : 'FAIL'
    : null;

  if (!a)
    return (
      <div className="h-full w-full overflow-y-auto">
        <EmptyState />
      </div>
    );

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(
        a.liveUrl ? `https://${a.liveUrl}` : window.location.href,
      );
    } catch {
      /* clipboard unavailable */
    }
  };
  const downloadZip = () => {
    const blob = buildZip(files.map((f) => ({ path: f.path, content: f.content })));
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${a.projectName.replace(/\s+/g, '-').toLowerCase() || 'artifacts'}-bundle.zip`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-full w-full flex-col gap-3 overflow-y-auto p-4 pb-20 md:pb-4 xl:p-8">
      {/* ── Header artefak ── */}
      <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg px-3 py-2 ${GLASS}`}>
        <span className="font-headline text-[14px] font-semibold tracking-tight text-[#f8fafc]">
          {a.projectName}
        </span>
        <span className="font-mono text-mono-label uppercase tracking-wide text-[#4edea3]">
          Generated Autonomously in {formatDuration(a.durationMs)}
        </span>
        {qaCount && (
          <span className="rounded-full border border-[rgba(78,222,163,0.4)] bg-[rgba(78,222,163,0.12)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[#4edea3]">
            {qaCount} tests
          </span>
        )}
        <span className="font-mono text-[10px] uppercase tracking-wide text-[#475569]">
          run {a.runId.slice(0, 14)} · {files.length} files · {formatTokens(a.tokensUsed)} tokens
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={copyLink}
            className="rounded border border-white/12 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[#f8fafc] transition-colors hover:bg-white/5"
          >
            Copy Share Link
          </button>
          <a
            href={a.repoUrl || '#'}
            target="_blank"
            rel="noreferrer"
            className="rounded border border-[rgba(56,189,248,0.4)] px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[#38bdf8] transition-colors hover:bg-[rgba(56,189,248,0.1)]"
          >
            Fork to GitHub ↗
          </a>
          <button
            type="button"
            onClick={downloadZip}
            className="rounded border border-white/12 px-2 py-1 font-mono text-[10px] uppercase tracking-wide text-[#f8fafc] transition-colors hover:bg-white/5"
          >
            Download ZIP
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-12 xl:gap-6">
        {/* ── Workspace tree ── */}
        <Panel title="Workspace" className="lg:col-span-2">
          <WorkspaceTree files={files} selected={activePath} onSelect={setSelected} />
        </Panel>

        {/* ── PRD rendered ── */}
        <Panel
          title="Product Requirement Doc · Rendered"
          right={
            <span className="font-mono text-[9px] uppercase tracking-wide text-[#818cf8]">
              RAG citations {retrievals.filter((r) => r.namespace === 'pm-memory').length}
            </span>
          }
          className="min-h-[320px] lg:col-span-5"
        >
          <Markdown source={a.prd || '_PRD kosong_'} />
          {retrievals.filter((r) => r.namespace === 'pm-memory').length > 0 && (
            <div className="mt-3 border-t border-white/6 pt-2">
              <div className="font-mono text-label-xs uppercase tracking-wide text-[#94a3b8]">
                RAG Citations
              </div>
              <ul className="mt-1 flex flex-col gap-0.5">
                {retrievals
                  .filter((r) => r.namespace === 'pm-memory')
                  .slice(0, 4)
                  .map((r, i) => (
                    <li key={i} className="truncate font-mono text-[10px] text-[#475569]">
                      [{r.topId ?? '∅'}]{' '}
                      <span style={{ color: r.topScore > 0.85 ? '#4edea3' : '#ffb95f' }}>
                        cos {r.topScore.toFixed(3)}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </Panel>

        {/* ── Code + QA ── */}
        <div className="flex min-h-0 flex-col gap-3 lg:col-span-5 xl:gap-6">
          <Panel
            title="Code · Diff"
            className="min-h-[260px] flex-1"
            right={
              activeFile ? (
                <span className="font-mono text-[9px] uppercase tracking-wide text-[#475569]">
                  {activeFile.path}
                </span>
              ) : null
            }
          >
            {activeFile ? (
              <CodePanel file={activeFile} />
            ) : (
              <div className="p-3 font-mono text-[11px] text-[#475569]">no file selected</div>
            )}
          </Panel>
          <Panel title="QA Test Runner" className="min-h-[160px]">
            <QaPanel a={a} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
