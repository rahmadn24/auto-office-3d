# 📑 MASTER PRODUCT REQUIREMENT DOCUMENT (PRD) & TECHNICAL BRIEF
**Project Name:** AutoOffice3D — Autonomous 3D AI Virtual Office (The Theater & The Brain)  
**Document Version:** 2.0 (Post-Architecture & UI Baseline)  
**Author:** AI Systems Architect & Product Team  
**Status:** Approved for Implementation  
**Execution Paradigm:** 100% Unattended Autonomous Execution (Zero-Human-in-the-Loop post Founder Prompt)

---

## 1. Executive Summary & Vision

### 1.1 Product Vision
**AutoOffice3D** adalah platform simulasi kantor otonom *end-to-end* di mana seorang Founder cukup memasukkan satu ide bisnis/aplikasi dalam bentuk teks satu baris. Sistem multi-agen AI di latar belakang (*The Brain*) secara otonom mendiskusikan kebutuhan, menyusun PRD, menulis kode, menguji secara deterministik, mendeploy aplikasi ke edge cloud publik, serta menjalankan kampanye pemasaran dan mendengarkan webhook pembayaran pelanggan pertama (ARR/MRR).

Seluruh dinamika dan komunikasi antar-agen tersebut direfleksikan secara instan dan *real-time* ke dalam antarmuka 3D isometrik web (*The Theater*) bergaya modern low-poly.

### 1.2 Target Milestones & Success Criteria (Definition of Done)
1. **Zero-Touch Delivery:** Dari 1 instruksi teks Founder hingga aplikasi online dengan URL Vercel aktif tanpa tombol persetujuan manusia manual.
2. **Deterministic QA Loop:** Dev dan QA agen beriterasi memperbaiki *type error* & unit test hingga skor kelulusan 100% dengan perlindungan *Circuit Breaker*.
3. **Persistent Memory Recall:** Agen berhasil menyimpan sintesis kerja ke Vector DB (Pinecone/Qdrant) dengan cosine similarity > 0.85 untuk penggunaan siklus berikutnya.
4. **Interactive 3D Telemetry Synchronization:** R3F/Three.js frontend mencerminkan status koordinat, animasi berjalan, mengetik, dan selebrasi dengan latensi soket < 50ms.
5. **Monetization Event Loop:** Penangkapan webhook Stripe `checkout.session.completed` pertama kali yang secara otomatis memicu mode selebrasi global (*Celebration State*).

---

## 2. System Architecture & Topology

Sistem dibagi secara tegas menjadi dua repositori independen (*Decoupled Non-Monorepo*) untuk memisahkan beban komputasi AI dengan performa rendering grafis 60 FPS:

```
┌────────────────────────────────────────────────────────┐
│               THE BRAIN (Backend Daemon)               │
│  LangGraph.js Orchestrator + Isolated Sandbox (E2B)    │
│  Vector DB (Pinecone Namespace Isolation)              │
└──────────────────────────┬─────────────────────────────┘
                           │ Socket.io Event Stream
                           │ (Telemetry & State Diffs)
┌──────────────────────────▼─────────────────────────────┐
│              THE THEATER (Frontend Web HUD)            │
│  Next.js / Vite + React Three Fiber + Tailwind CSS     │
│  Interactive Low-Poly Isometric 3D Office + HUD Canvas │
└────────────────────────────────────────────────────────┘
```

### 2.1 Backend Repository: `virtual-office-brain`
* **Framework:** Node.js (TypeScript) + LangGraph.js State Machine.
* **LLM Engine:** Claude 3.5 Sonnet (Penulisan kode & PRD) + OpenAI text-embedding-3-small (Vector Search).
* **Code Sandbox:** E2B / Fly Machines isolated micro-VMs (menjalankan `npm install`, compile, Vitest headless) dengan timeout 60s.
* **Vector Memory:** Pinecone Serverless dengan partisi namespace:
  * `pm-memory`: Standar PRD, user persona, benchmarking.
  * `dev-memory`: Template arsitektur kode, boilerplate Next.js/Stripe.
  * `qa-memory`: Edge-case test cases, anti-patterns.
  * `marketing-mem`: Formula copywriting viral, metrik engagement.
* **Realtime Protocol:** Socket.io Server (WebSockets + polling fallback) dengan enkripsi WSS.
* **Cloud API Integrations:** GitHub REST API v3, Vercel Edge API, Stripe Webhooks API, X/Twitter API v2.

### 2.2 Frontend Repository: `virtual-office-theater`
* **Framework:** React 18+ (Next.js 14 App Router atau Vite) + TypeScript.
* **3D Viewport:** React Three Fiber (R3F) / Three.js r128+ + `@react-three/drei`.
* **State Management:** Zustand (Sinkronisasi store real-time dari Socket.io payload).
* **Styling & Design System:** Tailwind CSS v3, Plus Jakarta Sans, Palet Dark HUD `#051424`.
* **Audio FX:** Web Audio API (Ambient typing, hum server, fanfare chime saat transaksi pertama).

---

## 3. Multi-Agent State Machine & Division Specifications

Alur kerja backend diatur oleh Graf Siklus LangGraph dengan 4 divisi otonom:

### 3.1 Division 1: Product Management (PM Agent)
* **Trigger Input:** Founder raw string (misal: *"Micro-SaaS invoice generator with Stripe integration"*).
* **RAG Retrieval:** Query ke namespace `pm-memory` untuk mengambil pola arsitektur serupa.
* **Output Artifact:** Berkas `specs/PRD-AutoInvoice.md` berformat markdown berisi:
  * Executive Summary & Target Audience
  * Functional User Stories (US-801, US-802, etc.)
  * TypeScript Data Contract / Interface definitions
  * Acceptance Criteria (AC).

### 3.2 Division 2: Full-Stack Engineering & QA Loop
* **Engineering Dev Agent:**
  * Membaca `PRD-AutoInvoice.md`.
  * Menghasilkan struktur berkas proyek (`src/routes`, `src/components`, `src/lib/stripe.ts`).
  * Mengirimkan diff kode ke sandbox runner.
* **QA Test Runner Agent:**
  * Mengeksekusi `vitest run --coverage` di dalam sandbox.
  * Memeriksa type-safety TypeScript (`tsc --noEmit`).
  * Jika terjadi kegagalan (test failed / compile error): Log error dikembalikan ke Dev Agent dengan counter iterasi bertambah (`Cycle N/5`).
* **Circuit Breaker Guardrail:**
  * Batas iterasi maksimal: **5 siklus**.
  * Jika siklus ke-5 masih gagal, sistem memotong eksekusi dan mengaktifkan fallback safe-build untuk mencegah pemborosan token (*token bleed*).

### 3.3 Division 3: DevOps & Autonomous Deployment
* **GitHub Repository Provisioning:** Membuat repositori publik baru secara terprogram via API (`POST /user/repos`), commit kode, dan push ke branch `main`.
* **Vercel Edge Deployment:** Memicu deployment via Vercel API hook, memantau build status (`READY`), dan mengekstrak `live_url` (contoh: `invoiceai-gen.vercel.app`).
* **Health Check Probe:** Memverifikasi HTTP status 200 OK pada endpoint root dan endpoint API sebelum menandai deployment sukses.

### 3.4 Division 4: Growth, Marketing & Revenue Sentinel
* **Social Campaign Dispatcher:**
  * Menyusun posting pengumuman peluncuran produk dan hook *Build-in-Public*.
  * Mengirimkan thread ke Twitter/X API dan Meta Threads.
* **Stripe Webhook Sentinel:**
  * Membuka webhook listener aktif untuk event `checkout.session.completed` dan `payment_intent.succeeded`.
  * Memantau metrik pengunjung aktif dan konversi keranjang.
  * Begitu terdeteksi transaksi pertama ($29.00 ARR):
    1. Mengubah state global `hasCustomers = true`.
    2. Menyiarkan event `CELEBRATE` ke Socket.io.
    3. Mengirimkan email konfirmasi selamat datang otomatis ke pembeli.

---

## 4. 3D Virtual Theater Technical Specifications

### 4.1 Zone Coordinates Matrix (The Map)
Ruang kantor dimodelkan dalam sistem grid isometrik 3D berukuran 60x60 unit dengan origin (0,0,0) di pusat Neural Bus:

| Zona ID | Nama Zona | Koordinat (X, Y, Z) | Dimensi (W x D) | Aksen Warna | Divisi Penghuni |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `zone_01` | Founder Desk | `(-14, 0.4, 14)` | 10 x 10 | `#6366f1` (Indigo) | Founder Avatar |
| `zone_02` | Strategy / Meeting Room | `(-13, 0.4, -13)` | 12 x 11 | `#f59e0b` (Amber) | PM Agent & Brainstorming |
| `zone_03` | Core Dev & QA Lab | `(14, 0.4, -12)` | 14 x 12 | `#10b981` (Emerald) | Dev Agent & QA Runner |
| `zone_04` | Creative & Marketing Studio | `(14, 0.4, 12)` | 12 x 11 | `#ec4899` (Pink) | Growth & Social Agent |
| `zone_05` | DevOps & Cloud Hub | `(0, 0.4, 16)` | 8 x 8 | `#06b6d4` (Cyan) | Infra & Server Racks |
| `hub_00` | Central Neural Bus | `(0, 0.4, 0)` | 8 x 8 | `#38bdf8` (Sky) | Hologram Router |

### 4.2 Low-Poly Bipedal Character Rigs & Animation States
Karakter agen dibangun dengan geometri modular low-poly (*box-man*), terdiri dari:
* **Body:** Kubus torso dengan rompi warna divisi.
* **Glowing Head:** Kubus kepala ber-emissive shader yang intensitas pendarannya meningkat saat berpikir/mengetik.
* **Limbs:** Lengan dan kaki dengan pivot sendi untuk siklus berjalan (*walking cycle*) dan mengetik (*working cycle*).
* **Floating Speech Bubble:** Overlay 2D/3D billboard di atas kepala agen yang menampilkan log aksi langsung.

#### State Matrix:
1. `IDLE`: Agen duduk di kursi meja masing-masing dengan osilasi pernapasan halus (*subtle sine wave* Y: ±0.03).
2. `WORKING`: Tangan agen mengayun mengetik pada keyboard meja, emisi kepala berdenyut dengan frekuensi 8Hz.
3. `WALKING`: Interpolasi posisi linier (Lerp) dari koordinat asal ke target waypoint dengan ayunan kaki berlawanan arah (*stride swing*).
4. `CELEBRATE`: Dipicu saat `hasCustomers = true`. Semua agen berkumpul di Central Hub, melompat berulang kali (Y: +1.4), dan memancarkan partikel konfeti.

### 4.3 Camera Viewport & Controls
* **Default Isometric Angle:** `Position(38, 30, 42)`, `LookAt(0, 0, 0)`, FOV 40°.
* **Orbit Controls:** Smooth damping rotation dengan batasan polar angle (0.2 hingga π/2.2).
* **Cinematic Presets:**
  * `Overview`: Tampilan menyeluruh 5 zona kantor.
  * `Founder`: Kamera fokus ke Meja Founder saat pengetikan prompt awal.
  * `Dev Lab`: Kamera zoom ke meja Dev & QA saat iterasi build berlangsung.
  * `Meeting`: Kamera fokus ke Meja Bundar saat fase diskusi PM.

---

## 5. Real-Time Telemetry Protocol (Socket.io Schema)

### 5.1 Event: `agent:status_update`
Dikirimkan dari backend setiap kali agen berpindah state atau menghasilkan progres baru:

```typescript
interface AgentStatusPayload {
  runId: string;
  agentId: 'founder_agent' | 'pm_agent' | 'dev_agent' | 'qa_agent' | 'devops_agent' | 'marketing_agent';
  division: 'Product' | 'Engineering' | 'QA' | 'DevOps' | 'Growth';
  currentAction: 'idle' | 'walking' | 'discussing' | 'coding' | 'testing' | 'deploying' | 'marketing' | 'celebrating';
  targetZone: 'founder_desk' | 'meeting_room' | 'dev_lab' | 'marketing_studio' | 'devops_hub' | 'central_bus';
  coordinates?: { x: number; y: number; z: number };
  logMessage: string;
  iterationCycle?: { current: number; max: number };
  telemetry: {
    tokensUsed: number;
    latencyMs: number;
    model: string;
  };
  timestamp: string;
}
```

### 5.2 Event: `milestone:first_sale`
Memicu selebrasi kantor global:

```typescript
interface FirstSalePayload {
  runId: string;
  customer: {
    city: string;
    country: string;
    maskedEmail: string;
  };
  amount: number; // e.g. 29.00
  currency: 'USD';
  stripeEventId: string;
  hasCustomers: true;
  timestamp: string;
}
```

---

## 6. Security, Sandboxing & Risk Mitigations

1. **Host Isolation:** Kode yang ditulis oleh Dev Agent tidak pernah dijalankan di OS mesin backend. Semua eksekusi `node`, `vitest`, dan `npm` wajib diisolasi di container E2B/gVisor sandboxed dengan akses jaringan terbatas.
2. **API Key Vault:** Kredensial Vercel, GitHub, Stripe, dan Twitter disimpan dalam vault memori terenkripsi AES-256 dan hanya diinjeksi ke instance runner per-tugas.
3. **Prompt Injection & Code Poisoning Guard:** Validasi sintaks AST statis terhadap kode sebelum pengujian untuk mencegah pembacaan file sistem lokal atau exfiltrasi env var host.
4. **Token Bleed Protection:** Batas pengeluaran token maksimum per run ditetapkan sebesar 250.000 tokens dengan hard-kill jika terlampaui.

---

## 7. Delivery Roadmap & Checklist Implementasi

| Fase | Durasi Estimasi | Deliverable Utama |
| :--- | :---: | :--- |
| **Fase 1: State Machine & Backend Daemon** | Minggu 1–2 | • Setup LangGraph.js graph & router divisi<br>• Integrasi Pinecone memory per-namespace<br>• Integrasi E2B secure sandbox runner |
| **Fase 2: 3D Isometric Viewport & Scene** | Minggu 2–3 | • Pemodelan geometri kantor & 5 zona koordinat<br>• Pembuatan model karakter low-poly bipedal & animasi skeletal<br>• Setup kamera orbit & preset flyover |
| **Fase 3: Socket.io Real-Time Synchronization** | Minggu 3–4 | • Pipeline event stream backend ke frontend store<br>• Sinkronisasi speech bubble & perpindahan koordinat agen 3D |
| **Fase 4: External Integrations & Revenue Loop** | Minggu 4–5 | • Integrasi Vercel auto-deploy & GitHub API<br>• Stripe webhook sentinel & modul selebrasi ($29 ARR) |
| **Fase 5: Polish & End-to-End Stress Testing** | Minggu 6 | • Simulasi run end-to-end tanpa intervensi Founder<br>• Optimalisasi render FPS (batching draw calls di Three.js) |

---
*Dokumen ini merupakan acuan tunggal kebenaran spesifikasi teknis (Single Source of Truth) untuk pengembangan AutoOffice3D.*
