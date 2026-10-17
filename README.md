# AutoOffice3D — Autonomous 3D AI Virtual Office

> **The Theater & The Brain.** Satu kantor virtual pribadi yang dihuni oleh tim AI: Founder cukup mengide, seluruh tim (PM, Dev, QA, DevOps, Marketer, CS) bekerja sendiri — dan semuanya tampil **real-time di kantor 3D isometrik** di browser.

## Project ini apa?

AutoOffice3D adalah **kantor virtual pribadi** milik Founder — satu perusahaan software yang beroperasi **full-agent**. Office-nya sendiri bukan produk yang dijual; yang dijual adalah **produk hasil generate** di dalamnya (landing page, micro-SaaS, custom app) kepada client nyata.

Alurnya:

```
Ide Founder → BRIEFING (diskusi multi-turn sama PM) → GO
   → BUILD otonom (PM → Dev ↔ QA → DevOps) → produk jadi + repo GitHub + deploy
   → MARKETING (kampanye sosial → leads)
   → SALES (CS Agent: jawab client, follow-up, quote)
   → COMMERCE (payment link Midtrans/Stripe + kontrak PDF) → DEAL → production
```

- **The Brain** (`brain/`) — daemon backend: orkestrasi LangGraph, memori vector RAG, sandbox eksekusi kode, driver LLM & integrasi cloud.
- **The Theater** (`theater/`) — HUD web Next.js + React Three Fiber: kantor 3D low-poly isometrik 5 zona, tiap aksi agen direfleksikan sebagai avatar berjalan/mengetik bicara lewat speech bubble, lengkap dengan Founder Command Bar untuk mengeluarkan instruksi.

Semua driver **env-gated** — tanpa API key apa pun, sistem tetap jalan penuh memakai driver `stub` / `memory` / `local` (offline, deterministik). Begitu kredensial diisi di `brain/.env`, driver otomatis berganti ke yang produksi (`anthropic`, `pinecone`, `vercel`, `e2b`, dsb).

## Struktur repository

Satu repo, dua app terpisah per folder (komputasi AI tidak bercampur dengan rendering 60 FPS):

```
auto-office-3d/
├── brief/                  # Dokumen spesifikasi (PRD = SSOT) + referensi UI (read-only)
│   └── master_prd_architecture_brief_autooffice3d.md
├── brain/                  # THE BRAIN — backend daemon otonom
│   ├── scripts/            # Utilitas (benchmark model, dll)
│   └── src/
│       ├── config.ts       # Env config tervalidasi (zod)
│       ├── types.ts        # Kontrak payload (agent:status_update, milestone:first_sale, chat)
│       ├── events.ts       # Event bus in-process (di-subscribe Socket.io)
│       ├── run.ts          # Jalankan 1 run otonom penuh dari satu prompt
│       ├── graph/          # LangGraph state machine — 5 divisi + circuit breaker
│       ├── control.ts      # HALT / RESUME run (Loop Controls)
│       ├── memory/         # Vector memory (driver: pinecone / in-memory) + embeddings
│       ├── llm/            # LLM provider (Anthropic / stub deterministik)
│       ├── sandbox/        # Isolasi eksekusi kode (E2B / local exec) + security guard
│       ├── integrations/   # GitHub, Vercel, Stripe (webhook sentinel), X/Twitter
│       ├── telemetry/      # Token budget guard (250k/run)
│       └── server/         # Socket.io realtime protocol
├── theater/                # THE THEATER — frontend Next.js + React Three Fiber
│   ├── app/                # App Router
│   ├── components/
│   │   ├── scene/          # OfficeScene, Floor, ZoneMatrix, Furniture, NeuralBus
│   │   ├── shell/          # AppShell + Founder Command Bar
│   │   ├── pipeline/       # Telemetry pipeline (teks)
│   │   ├── artifacts/      # Artefak run (PRD, kode, hasil QA)
│   │   └── overlays/       # PerfOverlay, CelebrateOverlay, dll
│   ├── store/              # Zustand — state real-time dari socket
│   ├── lib/zones.ts        # Kontrak zone matrix (duplikat terkontrol dari PRD §4.1)
│   └── tests/              # Test kontrak zona & kamera
```

Kontrak TypeScript antara Brain dan Theater **diduplikasi terkontrol** (mis. `zones.ts`) — tanpa import silang, agar kedua app tetap bisa dirilis independen.

## Menjalankan

```bash
# THE BRAIN
cd brain
npm install
npm test                # unit + integration (94 test)
npm run test:coverage   # + coverage (target ≥ 90% statement)
npm run typecheck       # tsc --noEmit (strict)
npm run simulate        # 1 prompt Founder → run otonom penuh (mode stub, tanpa API key)
npm run dev             # Socket.io daemon di ws://localhost:4800/brain-server

# THE THEATER
cd theater
npm install
npm run dev             # kantor 3D di http://localhost:3000
npm test                # kontrak zona/kamera (59 test)
npm run build           # next build (produksi)
```

Cara paling cepat mencoba: jalankan Brain (`npm run dev`), jalankan Theater (`npm run dev`), lalu ketik satu ide di **Founder Command Bar** (footer) — tekan Enter, dan lihat tim agen 3D mulai bekerja.

### Loop Controls (HALT / RESUME)

Run bisa dihentikan manual kapan saja lalu dilanjutkan dari state tersimpan (checkpointer LangGraph):

```bash
curl -X POST http://localhost:4800/control/halt    # {} = semua run, {"runId":"..."} = satu run
curl -X POST http://localhost:4800/control/resume
```

Lewat Socket.io: event `control:halt` / `control:resume` dengan payload `{ runId?: string }`.

## Roadmap

| Fase | Status | Isi |
|---|---|---|
| 1–6 | ✅ Selesai | Brain daemon, viewport 3D, sinkronisasi socket, integrasi GitHub/Vercel/Stripe, polish E2E, Founder Command Bar |
| 7 | 📋 | Durability (`DATA_DIR`, LanceDB, checkpoint resume) + evaluasi & benchmark model LLM |
| 8 | 📋 | Briefing Room — chat multi-turn sama PM sebelum run otonom |
| 9 | 📋 | Payment abstraction — Midtrans/Xendit + Stripe (driver pattern) |
| 10 | 📋 | Demo Harness — deploy produk generate ke Docker (preset stack, subdomain) |
| 11 | 📋 | CS Agent — omnichannel (widget/WA/email), leads follow-up, quote → payment link → kontrak |
| 12 | 📋 | Soak test → Go-Live VPS (Docker Compose 24/7) |

Detail per fase (deliverable & acceptance criteria) ada di [papan Trello](https://trello.com/b/RbCtUakd).

## Dokumen & referensi

- **Single Source of Truth (PRD):** [`brief/master_prd_architecture_brief_autooffice3d.md`](brief/master_prd_architecture_brief_autooffice3d.md)
- **Design system:** [`brief/autonomous_command_hud/DESIGN.md`](brief/autonomous_command_hud/DESIGN.md)
- **Referensi visual:** `brief/<view>/code.html` + `screen.png` (6 view)
- **Task board:** https://trello.com/b/RbCtUakd
