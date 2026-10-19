import type { LeadQuote, LeadSource } from '../types';
import { formatMoney } from '../types';
import { BRAIN_VERSION } from '../version';

/**
 * KONTRAK PDF — generator minimal tanpa dependency (Fase 11, PRD §3.5 closing flow).
 *
 * Menghasilkan PDF 1.4 satu halaman yang valid (xref + trailer + %%EOF) dengan
 * font standar Helvetica/Helvetica-Bold — cukup untuk demo & e2e, deterministik,
 * dan bisa diuji byte-level. Data client/produk/harga terisi otomatis dari lead.
 */

export interface ContractData {
  lead: {
    id: string;
    name: string;
    contact: string;
    source: LeadSource;
  };
  productName: string;
  quote: Pick<LeadQuote, 'amount' | 'currency' | 'checkoutUrl' | 'contractUrl'>;
  /** ISO date pembuatan kontrak. */
  date: string;
}

export interface PdfLine {
  text: string;
  size: number;
  bold?: boolean;
  gapBefore?: number;
}

/** Escape literal string PDF (di dalam parentheses stream). */
export function escapePdfText(text: string): string {
  return text
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/** Susun baris kontrak (terisi otomatis dari lead + quote). */
export function contractLines(data: ContractData): PdfLine[] {
  const { lead, quote } = data;
  const client = lead.name.trim() || lead.contact;
  const dateLabel = data.date.slice(0, 10);
  const contractNo = `AO3D-${lead.id
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 12)
    .toUpperCase()}-${dateLabel.replace(/-/g, '')}`;
  const lines: PdfLine[] = [
    { text: `KONTRAK LAYANAN DIGITAL — ${data.productName}`, size: 16, bold: true },
    { text: `Nomor: ${contractNo}`, size: 10 },
    { text: `Tanggal: ${dateLabel}`, size: 10 },
    { text: '', size: 10, gapBefore: 8 },
    { text: 'PARA PIHAK', size: 12, bold: true, gapBefore: 6 },
    { text: 'Penyedia: AutoOffice3D — The Brain (kantor agen otonom).', size: 11 },
    { text: `Klien: ${client} (${lead.source} · ${lead.contact}).`, size: 11 },
    { text: '', size: 10, gapBefore: 6 },
    { text: 'LINGKUP & HARGA', size: 12, bold: true, gapBefore: 6 },
    {
      text: `Lingkup: akses penuh produk digital "${data.productName}" beserta pembaruan.`,
      size: 11,
    },
    {
      text: `Harga: ${formatMoney(quote.amount, quote.currency)} (satu kali bayar / langganan sesuai halaman checkout).`,
      size: 11,
    },
    { text: 'Pembayaran dilakukan melalui tautan hosted berikut:', size: 11, gapBefore: 4 },
    { text: quote.checkoutUrl, size: 10 },
    { text: '', size: 10, gapBefore: 4 },
    { text: 'KETENTUAN', size: 12, bold: true, gapBefore: 6 },
    {
      text: '1. Kontrak berlaku efektif setelah pembayaran pertama terverifikasi otomatis.',
      size: 11,
    },
    { text: '2. Klien memperoleh akses produk pada tautan pembayaran yang sama.', size: 11 },
    { text: '3. Pembatalan dalam 7 hari mendapat pengembalian penuh tanpa syarat.', size: 11 },
    { text: '4. Data klien diproses sesuai kebijakan privasi AutoOffice3D.', size: 11 },
    { text: '', size: 10, gapBefore: 6 },
    { text: 'TANDA TANGAN', size: 12, bold: true, gapBefore: 6 },
    { text: 'Penyedia,                          Klien,', size: 11, gapBefore: 10 },
    { text: '', size: 11, gapBefore: 22 },
    { text: '__________________________        __________________________', size: 11 },
    { text: 'Founder · AutoOffice3D               ' + client, size: 10 },
    { text: '', size: 10, gapBefore: 8 },
    {
      text: `Dibuat otomatis oleh CS Agent · brain v${BRAIN_VERSION} · salinan: ${quote.contractUrl}`,
      size: 8,
    },
  ];
  return lines;
}

interface PdfObject {
  body: string;
}

interface PdfRow {
  text: string;
  size: number;
  bold: boolean;
  gapBefore: number;
}

/** Susun baris menjadi rows siap render (word-wrap) pada skala tertentu. */
function layoutRows(lines: PdfLine[], scale: number): PdfRow[] {
  const marginLeft = 56;
  const rows: PdfRow[] = [];
  for (const line of lines) {
    const size = Math.max(6, line.size * scale);
    const gapBefore = (line.gapBefore ?? 0) * scale;
    if (line.text.trim().length === 0) {
      rows.push({ text: '', size, bold: line.bold ?? false, gapBefore });
      continue;
    }
    // Word-wrap sederhana (approx 0.5*size per karakter untuk Helvetica).
    const maxChars = Math.max(20, Math.floor((595 - marginLeft * 2) / (size * 0.5)));
    const words = line.text.split(/\s+/);
    let current = '';
    const wrapped: string[] = [];
    for (const word of words) {
      if ((current + ' ' + word).trim().length > maxChars && current) {
        wrapped.push(current);
        current = word;
      } else {
        current = (current + ' ' + word).trim();
      }
    }
    if (current) wrapped.push(current);
    wrapped.forEach((row, index) => {
      rows.push({
        text: row,
        size,
        bold: line.bold ?? false,
        gapBefore: index === 0 ? gapBefore : 0,
      });
    });
  }
  return rows;
}

function layoutHeight(rows: PdfRow[]): number {
  return rows.reduce((sum, row) => sum + row.gapBefore + row.size + 4, 0);
}

function contentStream(lines: PdfLine[]): string {
  const marginLeft = 56;
  const top = 786;
  const bottom = 60;
  const available = top - bottom;

  // Semua baris kontrak wajib muat di satu halaman — bila kepanjangan,
  // skala font & jarak diturunkan proporsional (deterministik).
  let scale = 1;
  let rows = layoutRows(lines, scale);
  const height = layoutHeight(rows);
  if (height > available) {
    scale = (available - 8) / height;
    rows = layoutRows(lines, scale);
  }

  let y = top;
  const parts: string[] = [];
  const round = (value: number) => Math.round(value * 10) / 10;
  for (const row of rows) {
    y -= row.gapBefore + row.size + 4;
    if (y < bottom) break;
    if (row.text.trim().length === 0) continue;
    const font = row.bold ? '/F2' : '/F1';
    parts.push(
      `BT ${font} ${round(row.size)} Tf 1 0 0 1 ${marginLeft} ${round(y)} Tm (${escapePdfText(row.text)}) Tj ET`,
    );
  }
  return parts.join('\n') + '\n';
}

/** Rakit PDF 1.4 minimal (objek → xref offset byte-accurate). */
export function renderContractPdf(data: ContractData): Buffer {
  const content = contentStream(contractLines(data));
  const contentLength = Buffer.byteLength(content, 'latin1');

  const objects: PdfObject[] = [];
  objects[1] = { body: '<< /Type /Catalog /Pages 2 0 R >>' };
  objects[2] = { body: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' };
  objects[3] = {
    body:
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
  };
  objects[4] = { body: `<< /Length ${contentLength} >>\nstream\n${content}endstream` };
  objects[5] = { body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' };
  objects[6] = { body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>' };
  objects[7] = {
    body: `<< /Title (${escapePdfText(`Kontrak ${data.productName}`)}) /Producer (AutoOffice3D Brain v${BRAIN_VERSION}) /CreationDate (D:${data.date.replace(/[-:TZ.]/g, '').slice(0, 14)}) >>`,
  };

  let out = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 1; i < objects.length; i += 1) {
    const object = objects[i];
    if (!object) continue;
    offsets[i] = Buffer.byteLength(out, 'latin1');
    out += `${i} 0 obj\n${object.body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i += 1) {
    out += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Nama file kontrak untuk satu lead (dipakai route download & pesan channel). */
export function contractFileName(leadId: string): string {
  return `${leadId.replace(/[^a-zA-Z0-9._-]/g, '-')}.pdf`;
}
