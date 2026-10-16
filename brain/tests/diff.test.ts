import { describe, expect, it } from 'vitest';

import { diffArtifacts, diffSummary } from '../src/diff';

describe('diff tracker per-berkas (PRD §3.2 — Dev Agent mengirim diff)', () => {
  it('berkas baru = created dengan jumlah baris', () => {
    const diff = diffArtifacts({}, { 'src/a.ts': 'line1\nline2\nline3' });
    expect(diff['src/a.ts']).toEqual({ status: 'created', added: 3, removed: 0 });
  });

  it('tidak ada perubahan = unchanged (PRD yang tidak disentuh tidak dihitung)', () => {
    const before = { 'specs/PRD.md': '# PRD\nline', 'src/a.ts': 'x' };
    const after = { 'specs/PRD.md': '# PRD\nline', 'src/a.ts': 'x\ny' };
    const diff = diffArtifacts(before, after);
    expect(diff['specs/PRD.md']).toEqual({ status: 'unchanged', added: 0, removed: 0 });
    expect(diff['src/a.ts']).toEqual({ status: 'modified', added: 1, removed: 0 });
  });

  it('menghitung baris terhapus dan berkas hilang', () => {
    const before = { 'src/old.ts': 'a\nb\nc', 'src/gone.ts': 'x\ny' };
    const after = { 'src/old.ts': 'a\nb' };
    const diff = diffArtifacts(before, after);
    expect(diff['src/old.ts']).toEqual({ status: 'modified', added: 0, removed: 1 });
    expect(diff['src/gone.ts']).toEqual({ status: 'deleted', added: 0, removed: 2 });
  });

  it('ringkasan diff untuk log Dev Agent (berkas tak berubah tidak dihitung)', () => {
    const summary = diffSummary(
      diffArtifacts(
        { 'README.md': 'same' },
        { 'README.md': 'same', 'src/a.ts': 'x\ny', 'src/b.ts': 'z' },
      ),
    );
    expect(summary).toBe('+3/-0 across 2 files (2 new)');
  });
});
