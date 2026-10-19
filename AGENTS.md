# AGENTS.md — panduan agen di repo AutoOffice3D

> Dibaca model/agen sebelum menyentuh kode. Tujuan: paham aturan main tanpa audit ulang.
> PRD = SSOT produk & roadmap: `brief/master_prd_architecture_brief_autooffice3d.md`.
> README = landing page branding (tanpa roadmap). Status fase = Trello (lihat bawah).

## Peta repo

```
brain/    THE BRAIN — daemon Node/TS: LangGraph agent graph, LLM router, memory,
          sandbox, integrasi (Stripe/GitHub/Vercel/email/sosial), durability
          (SQLite + LanceDB), socket.io telemetry. Port 4800, path /brain-server.
theater/  THE THEATER — Next.js 14 App Router + React Three Fiber: HUD 3D isometrik,
          konsumsi event socket, store zustand. Dev port 3001.
brief/    PRD v3.0 (master), brief desain.
scripts/  Tooling root (dev orchestrator).
.github/  CI (verify brain+theater, build, e2e smoke).
```

Poin masuk cepat: `brain/src/index.ts` (boot daemon) · `brain/src/graph/nodes.ts`
(node graph) · `brain/src/server/socket.ts` (HTTP + socket.io) ·
`theater/app/layout.tsx` (BrainBridge socket sekali untuk semua tab) ·
`theater/store/brainStore.ts` (state dari event) · `brain/src/version.ts`
(BRAIN_VERSION — sumber tunggal, theater membacanya dari handshake `system:hello`).

## Perintah (root = paling gampang)

| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | Brain :4800 + Theater :3001 sekaligus (Ctrl+C stop keduanya) |
| `npm run verify` | Gate lengkap: typecheck + lint + format:check + test (brain & theater) |
| `npm test` / `npm run typecheck` | Versi cepat |
| `npm run build` | `next build` theater (JANGAN bareng `npm run dev`) |
| `npm run e2e` | E2E smoke browser (brain stub + theater + Chrome; butuh `npx playwright install chromium`) |

Per paket sama saja: `npm --prefix brain run verify`, dst.

## Aturan keras

1. **Tanpa import silang brain ↔ theater.** Kontrak event diduplikasi terkontrol:
   `brain/src/server/contract.ts` ↔ `theater/lib/events.ts`. Ubah satu → ubah pasangannya
   + fixtures test. Jangan pernah `import ... from '../brain/...'`.
2. **Versi jangan hardcode.** Pakai `BRAIN_VERSION` (`brain/src/version.ts`).
3. **Driver live tanpa kredensial = error saat boot** (`brain/src/config.ts` fail-fast).
   Semua driver `auto` → offline/stub bila env kosong; sistem harus selalu bisa jalan tanpa key.
4. **Jangan commit**: `brain/data/` (state durable), `brain/bench/` (hasil bench),
   `.playwright-mcp/`, `.env` (kontrak env ada di `brain/.env.example`).
5. **Patch bug pasca-fase** → branch `fix/<slug>`; deliverable fase → `fase/<n>-<slug>`.
   Merge ke `main` hanya setelah AC Trello dicentang + `npm run verify` hijau, pakai `--no-ff`.
6. Commit identity repo: `git -c user.name="rahmadn24" -c user.email="rahmadn24@users.noreply.github.com" commit ...`.

## Trello (tracking fase)

Board `6ad1d2b83957007054c4f4c6`. List Done: `6ad1d304c1183a26bcbad9c6`; list Fase 8:
`6ad3b850a3b3d4e0bf00cfd1`; list per fase 9–13 mengikuti pola yang sama. Alur tiap fase:
kerjakan di branch fase → `npm run verify` hijau → centang AC di kartu → merge `--no-ff` → push.

## Testing

- `vitest`. Test yang tidak boleh menyentuh disk: `loadConfig({ MEMORY_DRIVER: 'memory' })`.
- Tambah test untuk setiap fix; pola: `brain/tests/*.test.ts`, `theater/tests/*.test.ts`.
- E2E smoke: `theater/scripts/e2e-smoke.mjs` — nyalakan brain stub + theater di port
  terpisah (4899/3101), DATA_DIR temporer, kirim directive dari UI, verifikasi
  `agent:status_update` + ack UI. Port & timeout bisa di-override via env `E2E_*`.
- Browser Playwright: `npx playwright install chromium` (cache `~/Library/Caches/ms-playwright`, rev chromium-1248).

## Jebakan yang sudah pernah menggigit

- `next build` bersamaan `next dev` → konflik `.next`. Route aneh? `rm -rf theater/.next` + restart.
- Disk sering mepet: cek `df -h /` sebelum install besar; cache `mediaanalysisd`
  (`~/Library/Caches/com.apple.mediaanalysisd*`) pernah tumbuh GB-an dan aman dibersihkan.
- `npm` di mesin ini pakai persetujuan install-scripts (`allowScripts` di package.json);
  paket native (better-sqlite3, esbuild, fsevents) harus di-approve agar postinstall jalan.
- Socket client: BrainBridge WAJIB di `app/layout.tsx` (bukan per-tab) supaya koneksi
  tidak drop saat pindah tab.
- Stripe (jangan regresi): signature invalid saat secret terpasang → `401` +
  `firstSale:false` tanpa menaikkan metrics; valid → `200` + sale.

## Alur kerja yang diharapkan

1. Baca PRD bagian fase yang relevan; cek kartu Trello (AC = acceptance criteria).
2. Implementasi kecil-kecil + test; jalankan `npm run verify` (dan `npm run e2e` bila menyentuh UI/socket).
3. Centang AC di Trello, merge `--no-ff` ke `main`, push. Branch fase boleh dihapus.
4. Update `.env.example`/PRD bila kontrak env/fase berubah.
