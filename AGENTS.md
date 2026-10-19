# AGENTS.md — panduan agen di repo AutoOffice3D

> Dibaca model/agen sebelum menyentuh kode. Tujuan: paham aturan main tanpa audit ulang.
> PRD = SSOT produk & roadmap: `brief/master_prd_architecture_brief_autooffice3d.md`.
> README = landing page branding (tanpa roadmap). Status fase = Trello (lihat bawah).

## Peta repo

```
brain/    THE BRAIN — daemon Node/TS: LangGraph agent graph, LLM router, memory,
          sandbox, integrasi (payment/GitHub/Vercel/email/sosial), durability
          (SQLite + LanceDB), socket.io telemetry. Port 4800, path /brain-server.
theater/  THE THEATER — Next.js 14 App Router + React Three Fiber: HUD 3D isometrik,
          konsumsi event socket, store zustand. Dev port 3001.
brief/    PRD v3.0 (master), brief desain.
scripts/  Tooling root (dev orchestrator).
.github/  CI (verify brain+theater, build, e2e smoke).
```

Poin masuk cepat: `brain/src/index.ts` (boot daemon) · `brain/src/graph/nodes.ts`
(node graph) · `brain/src/server/http.ts` (health/control/webhook/demo/widget/kontrak) ·
`brain/src/server/socket.ts` (bootstrap + io handlers, termasuk `run:replay`) ·
`brain/src/payments/` (Payment Sentinel multi-provider: provider.ts + driver
stripe/midtrans/stub/xendit + factory `createPayment`) ·
`brain/src/cs/` (CS Agent Fase 11: `service.ts` omnichannel + closing, `leads.ts`
store durable `leads`/`cs_messages`, `channels.ts` adapter widget/WA/email,
`contract.ts` PDF tanpa dependency, `widget.ts` aset widget) ·
`brain/src/products/presets/` (preset stack tier-1 `landing`/`saas-fullstack`/
`custom-app`: halaman + Dockerfile template + gate sendiri) ·
`brain/src/integrations/dockerdeploy.ts` (DEPLOY_DRIVER=docker: build → run
`demo-net` → health probe → READY) · `brain/src/briefing.ts` (Briefing Room:
founder:chat/pm:reply, compile brief) ·
`theater/components/briefing/BriefingRoom.tsx` (tab Briefing Room) ·
`theater/components/cs/CsInbox.tsx` + `theater/store/csStore.ts` (tab `/inbox`:
omnichannel lead + quote/kontrak + sweep follow-up) ·
`theater/components/pipeline/RunReplayPanel.tsx` + `theater/store/replayStore.ts`
(playback event replay) · `theater/app/layout.tsx` (BrainBridge socket sekali
untuk semua tab) · `theater/store/brainStore.ts` (state dari event) ·
`brain/src/version.ts` (BRAIN_VERSION — sumber tunggal, theater membacanya dari
handshake `system:hello`) · `docker-compose.yml` + `deploy/Caddyfile` +
`brain/Dockerfile` + `theater/Dockerfile` (office stack, Fase 10/soak).

## Perintah (root = paling gampang)

| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | Brain :4800 + Theater :3001 sekaligus (Ctrl+C stop keduanya) |
| `npm run verify` | Gate lengkap: typecheck + lint + format:check + test (brain & theater) |
| `npm test` / `npm run typecheck` | Versi cepat |
| `npm run build` | `next build` theater (JANGAN bareng `npm run dev`) |
| `npm run e2e` | E2E smoke browser (brain stub + theater + Chrome; butuh `npx playwright install chromium`) |
| `npm run e2e:docker` | Smoke Docker Desktop: 3 preset → produk ter-deploy bisa diakses + isolasi + spin down (butuh Docker hidup + ~1 GB ruang) |

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

Board `6ad1d2b83957007054c4f4c6`. List Done: `6ad1d304c1183a26bcbad9c6`; list Fase 9:
`6ad3b85049a840e0a31bf792`; list per fase 10–13 mengikuti pola yang sama. Alur tiap fase:
kerjakan di branch fase → `npm run verify` hijau → centang AC di kartu → merge `--no-ff` → push.

## Testing

- `vitest`. Test yang tidak boleh menyentuh disk: `loadConfig({ MEMORY_DRIVER: 'memory' })`.
- Tambah test untuk setiap fix; pola: `brain/tests/*.test.ts`, `theater/tests/*.test.ts`.
- E2E smoke: `theater/scripts/e2e-smoke.mjs` — nyalakan brain stub + theater di port
  terpisah (4899/3101), DATA_DIR temporer, kirim directive dari UI, verifikasi
  `agent:status_update` + ack UI, lalu chat briefing + GO, lalu Simulate Payment
  (`milestone:first_sale` driver stub + banner CELEBRATE). Port & timeout via env `E2E_*`.
- Browser Playwright: `npx playwright install chromium` (cache `~/Library/Caches/ms-playwright`, rev chromium-1248).

## Jebakan yang sudah pernah menggigit

- `next build` bersamaan `next dev` → konflik `.next`. Route aneh? `rm -rf theater/.next` + restart.
- Vitest theater **tidak** me-resolve alias `@/*` untuk import runtime — di file
  yang di-tes (`store/`, `lib/`) pakai path relatif; `import type '@/...'` aman
  karena dihapus saat transform.
- Disk sering mepet: cek `df -h /` sebelum install besar; cache `mediaanalysisd`
  (`~/Library/Caches/com.apple.mediaanalysisd*`) pernah tumbuh GB-an dan aman dibersihkan.
- `npm` di mesin ini pakai persetujuan install-scripts (`allowScripts` di package.json);
  paket native (better-sqlite3, esbuild, fsevents) harus di-approve agar postinstall jalan.
- Socket client: BrainBridge WAJIB di `app/layout.tsx` (bukan per-tab) supaya koneksi
  tidak drop saat pindah tab.
- Frame `run:replay` dikirim **hanya ke socket peminta** (bukan `io.emit`) — e2e/observer
  harus meminta replay sendiri, jangan menunggu broadcast.
- `innerText` di Chromium mengikuti `text-transform: uppercase` — assertion UI
  (mis. `PLAYBACK DONE`, `n/m EVENTS`) jangan mengandalkan huruf kecil.
- Payment Sentinel (jangan regresi): signature invalid saat secret terpasang →
  `401` + `firstSale:false` tanpa menaikkan metrics; valid → `200` + sale.
  Route webhook mengikuti driver aktif: `/webhook/{stripe|midtrans|stub|xendit}`.
- CS Agent (Fase 11, jangan regresi): lead id dari handoff Marketer deterministik
  per run (`lead_<runId>_<n>`) → resume tidak menduplikasi; quote otomatis hanya
  mengirim SATU pesan (artefak link+kontrak dibuat tanpa kirim); WA di luar
  jendela 24 jam → template HSM; webhook email wajib header
  `x-cs-inbound-secret` bila secret di-set.
- Aset `/widget/socket.io.min.js` dicari relatif ke entry `socket.io-client`
  (package `exports` memblokir subpath `dist/*`); jangan kembali ke
  `require.resolve('socket.io-client/dist/...')`.
- `cs:list`/`cs:history` butuh payload objek pada emit (`emit(event, {}, cb)`) —
  `state:request` justru ack tunggal tanpa payload (`emit(event, cb)`).

## Alur kerja yang diharapkan

1. Baca PRD bagian fase yang relevan; cek kartu Trello (AC = acceptance criteria).
2. Implementasi kecil-kecil + test; jalankan `npm run verify` (dan `npm run e2e` bila menyentuh UI/socket).
3. Centang AC di Trello, merge `--no-ff` ke `main`, push. Branch fase boleh dihapus.
4. Update `.env.example`/PRD bila kontrak env/fase berubah.
