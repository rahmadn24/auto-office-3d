import { describe, expect, it } from 'vitest';

import {
  contractFileName,
  contractLines,
  escapePdfText,
  renderContractPdf,
  type ContractData,
} from '../src/cs/contract';
import { formatMoney } from '../src/types';

/**
 * Kontrak PDF (Fase 11 closing flow): generator minimal tanpa dependency —
 * harus PDF 1.4 valid (xref byte-accurate) dan terisi otomatis dari lead+quote.
 */

function data(overrides: Partial<ContractData> = {}): ContractData {
  return {
    lead: {
      id: 'lead_abc123',
      name: 'Rina (Demo)',
      contact: 'rina@example.com',
      source: 'email',
    },
    productName: 'Invoice Generator',
    quote: {
      amount: 29,
      currency: 'USD',
      checkoutUrl: 'http://localhost:4800/demo/checkout?order_id=stub_x',
      contractUrl: 'http://localhost:4800/cs/contracts/lead_abc123.pdf',
    },
    date: '2026-01-02T03:04:05.000Z',
    ...overrides,
  };
}

describe('kontrak PDF — generator minimal (Fase 11)', () => {
  it('menghasilkan PDF 1.4 valid dengan header, xref, dan EOF', () => {
    const pdf = renderContractPdf(data());
    const text = pdf.toString('latin1');

    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Type /Page');
    expect(text).toContain('/BaseFont /Helvetica');

    const startxref = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
    expect(Number.isFinite(startxref)).toBe(true);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');

    const lines = text.slice(startxref).split('\n');
    const size = Number(lines[1]?.split(' ')[1]);
    expect(size).toBe(8); // 7 objek + entri free
    // Setiap offset xref harus menunjuk tepat ke awal objeknya (byte-accurate).
    for (let i = 1; i < size; i += 1) {
      const offset = Number(lines[2 + i]?.slice(0, 10));
      expect(Number.isFinite(offset)).toBe(true);
      expect(text.slice(offset, offset + `${i} 0 obj`.length)).toBe(`${i} 0 obj`);
    }
  });

  it('terisi otomatis: produk, klien (escaped), harga, checkout, dan tautan kontrak', () => {
    const pdf = renderContractPdf(data());
    const text = pdf.toString('latin1');
    expect(text).toContain('KONTRAK LAYANAN DIGITAL');
    expect(text).toContain('Invoice Generator');
    expect(text).toContain('Rina \\(Demo\\)');
    expect(text).toContain('rina@example.com');
    expect(text).toContain(formatMoney(29, 'USD'));
    expect(text).toContain('demo/checkout?order_id=stub_x');
    expect(text).toContain('lead_abc123.pdf');
    expect(text).toContain('AO3D-LEADABC123-20260102');
  });

  it('menghormati override quote (IDR) & tanggal dokumen', () => {
    const pdf = renderContractPdf(
      data({
        quote: {
          amount: 450_000,
          currency: 'IDR',
          checkoutUrl: 'https://checkout.example/abc',
          contractUrl: 'https://brain.example/cs/contracts/abc.pdf',
        },
        date: '2026-12-31T23:59:59.000Z',
      }),
    );
    const text = pdf.toString('latin1');
    expect(text).toContain('Rp 450.000');
    expect(text).toContain('Tanggal: 2026-12-31');
  });

  it('escapePdfText: kurung/backslash di-escape, non-ASCII diganti ?', () => {
    expect(escapePdfText('Rina (Demo) \\ ü')).toBe('Rina \\(Demo\\) \\\\ ?');
  });

  it('contractLines selalu memuat ketentuan & blok tanda tangan', () => {
    const texts = contractLines(data())
      .map((line) => line.text)
      .join('\n');
    expect(texts).toContain('PARA PIHAK');
    expect(texts).toContain('KETENTUAN');
    expect(texts).toContain('TANDA TANGAN');
    expect(texts).toContain('Founder · AutoOffice3D');
  });

  it('contractFileName menetralkan karakter path (tidak bisa traversal)', () => {
    expect(contractFileName('lead_abc')).toBe('lead_abc.pdf');
    expect(contractFileName('../../etc/passwd')).toBe('..-..-etc-passwd.pdf');
    expect(contractFileName('lead:123/abc')).toBe('lead-123-abc.pdf');
  });
});
