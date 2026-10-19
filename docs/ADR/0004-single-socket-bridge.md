# ADR 0004 — Satu socket bridge di app layout + store Zustand

- Status: Accepted (Fase 3 & 5, dikunci Fase 12)
- Konteks: Theater memiliki banyak tab; koneksi Socket.io yang dibuat per tab
  akan drop saat pindah route dan memicu reconnect storm.
- Keputusan:
  - `BrainBridge` dipasang sekali di `theater/app/layout.tsx`; singleton socket
    module-level di `theater/lib/brainSocket.ts`.
  - Semua event masuk lewat satu pintu → `brainStore`/`csStore`/`briefingStore`
    → komponen membaca store (bukan listener sendiri-sendiri).
  - Reconnect menarik `state:request` (snapshot) sekali agar deep-link dan
    reload langsung terisi.
  - Frame `run:replay` dikirim hanya ke socket peminta (bukan broadcast).
- Konsekuensi: pindah tab tidak mereset state; tidak ada listener ganda; replay
  tidak membanjiri klien lain.
