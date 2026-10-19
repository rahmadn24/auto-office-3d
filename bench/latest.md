# Bench LLM — laporan terakhir

> Sumber: `node scripts/bench-llm.mjs` (brain). Gate keputusan PRD §2.2:
> **≥ 80% task lolos** (setiap task = PRD + codegen yang harus lolos `tsc` dan
> test vitest hasil generate).

## Run terakhir (baseline harness — driver `stub`)

| Field | Nilai |
| --- | --- |
| Tanggal | 2026-10-19 |
| Model | `stub-deterministic` (driver `stub`) |
| Kandidat tier | DeepSeek 4.1 Flash (tier gratis · 9router) |
| Tasks | 3/3 lolos (100%) — `invoice-saas`, `analytics-landing`, `mini-crm` |
| Tokens | input 1.976 · output 9.473 |
| Latensi | ~1 ms/task (deterministik, bukan jaringan) |
| Verdict | **LULUS ≥80% — validasi harness offline** |

Catatan jujur: angka di atas adalah **baseline stub** untuk memastikan harness
bench (generate → `tsc` → vitest → coverage) bekerja. Bench model live
(DeepSeek 4.1 Flash lewat 9router) masih **pending token 9router**; jalankan:

```bash
cd brain
ANTHROPIC_API_KEY=<token-9router> node scripts/bench-llm.mjs --model deepseek-v4.1-flash
```

Hasil mentah per candidate tersimpan di `brain/bench/results-*.json` (tidak
di-commit — folder `brain/bench/` di-ignore).

## Harga referensi (tabel benchmark, USD / 1 juta token)

Dipakai `brain/src/llm/pricing.ts` untuk estimasi biaya per run:

| Model | Input | Output |
| --- | --- | --- |
| Claude 3.5 Sonnet | $3.00 | $15.00 |
| Claude 3.5 / Haiku 4.5 | $1.00 | $5.00 |
| GPT-4o mini | $0.15 | $0.60 |
| GPT-4o | $2.50 | $10.00 |
| DeepSeek 4.1 Flash | $0.10 | $0.40 |
| DeepSeek Chat | $0.27 | $1.10 |

Contoh: run stub terakhir (1.976 input + 9.473 output token) ≈ **$0.0007**
pada DeepSeek 4.1 Flash — jauh di bawah budget run 250k token dan budget
harian 2M token.

## Prosedur

1. `npm run check:9router -- --url http://localhost:20128 --key <token>` untuk
   memastikan gateway hidup dan daftar model tampil.
2. `node scripts/bench-llm.mjs --model deepseek-v4.1-flash` (di `brain/`).
3. Bila pass rate < 80%, naik tier kandidat (`BENCH_CANDIDATES` JSON) dan ulangi.
4. Perbarui tabel di atas + verdict run terbaru pada commit berikutnya.
