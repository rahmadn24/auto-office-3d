# AutoOffice3D — Autonomous 3D AI Virtual Office

> **The Theater & The Brain.** Satu baris ide Founder → PRD → kode → QA → deploy Vercel → kampanye marketing → webhook pembayaran pertama, semuanya otonom dan tampil real-time di kantor 3D isometrik.

- **Single Source of Truth:** [`brief/master_prd_architecture_brief_autooffice3d.md`](brief/master_prd_architecture_brief_autooffice3d.md)
- **Design system:** [`brief/autonomous_command_hud/DESIGN.md`](brief/autonomous_command_hud/DESIGN.md)
- **Referensi visual:** `brief/<view>/code.html` + `screen.png` (6 view)
- **Task board:** https://trello.com/b/RbCtUakd

---

## Struktur repository

Satu repo, dua app terpisah per folder (komputasi AI tidak bercampur dengan rendering 60 FPS):

```
auto-office-3d/
├── brief/      # Dokumen spesifikasi + referensi UI (read-only, jangan diedit sembarangan)
├── brain/      # THE BRAIN — backend daemon otonom
│   └── src/
│       ├── config.ts       # Env config tervalidasi (zod)
│       ├── types.ts        # Kontrak payload PRD §5 (agent:status_update, milestone:first_sale)
│       ├── events.ts       # Event bus in-process (di-subscribe Socket.io)
│       ├── graph/          # LangGraph state machine + 4 divisi + circuit breaker
│       ├── control.ts      # HALT GRAPH / resume (Loop Controls)
│       ├── diff.ts         # Diff tracker per-berkas (telemetri Dev Agent)
│       ├── memory/         # Vector memory (Pinecone / in-memory) + embeddings
│       ├── sandbox/        # Isolasi eksekusi kode (E2B / local exec) + security guard
│       ├── llm/            # Provider Claude (Anthropic) / stub deterministik
│       ├── telemetry/      # Token budget guard (250k)
│       └── server/         # Socket.io realtime protocol
└── theater/    # THE THEATER — frontend Next.js/Vite + React Three Fiber (mulai Fase 2)
```

## Aturan pengembangan (WAJIB)

1. **Satu fase = satu branch.** Penamaan: `fase/<n>-<slug>`
   | Branch | Fase |
   |---|---|
   | `fase/1-brain-state-machine` | State Machine & Backend Daemon |
   | `fase/2-3d-viewport` | 3D Isometric Viewport & Scene |
   | `fase/3-socket-sync` | Socket.io Real-Time Synchronization |
   | `fase/4-integrations` | External Integrations & Revenue Loop |
   | `fase/5-polish-e2e` | Polish & End-to-End Stress Testing |
2. **`main` selalu bisa dijalankan.** Tidak ada merge parsial yang menggantung.
3. **Merge ke `main` hanya setelah fase dinyatakan oke** — checklist Acceptance Criteria di kartu Trello fase tersebut tercentang semua + `npm test` & `npm run typecheck` hijau.
4. Kerja di dalam folder fase yang sesuai (`brain/` untuk Fase 1 & 3–4, `theater/` untuk Fase 2 & 5).

```bash
# Mulai fase
git checkout main && git pull
git checkout -b fase/1-brain-state-machine

# Setelah oke
git checkout main && git merge --no-ff fase/1-brain-state-machine
```

## Menjalankan

```bash
cd brain
npm install
npm test                # unit + integration test (48 test)
npm run test:coverage   # + laporan coverage (target ≥ 90% statement)
npm run typecheck       # tsc --noEmit (strict)
npm run lint            # ESLint flat config
npm run format:check    # Prettier konsisten
npm run simulate        # 1 prompt Founder → run otonom penuh (mode stub, tanpa API key)
npm run dev             # start Socket.io daemon di ws://localhost:4800/brain-server
```

### Loop Controls (HALT GRAPH / RESUME)

Run bisa dihentikan manual kapan saja lalu dilanjutkan dari state tersimpan
(checkpointer LangGraph):

```bash
curl -X POST http://localhost:4800/control/halt   # {} = semua run, {"runId":"..."} = satu run
curl -X POST http://localhost:4800/control/resume
```

Lewat Socket.io: event `control:halt` / `control:resume` dengan payload
`{ runId?: string }` (state terkini ikut dikirim di `system:hello.loopControls`).

Semua driver bersifat **env-gated** — tanpa API key sistem tetap jalan memakai driver
`stub`/`memory`/`local` (offline), dan otomatis berpindah ke driver produksi
(`anthropic`/`pinecone`/`e2b`) begitu kredensial diisi di `brain/.env`.
