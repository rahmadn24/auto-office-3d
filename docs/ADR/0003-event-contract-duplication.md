# ADR 0003 — Kontrak event diduplikasi terkontrol (tanpa import silang)

- Status: Accepted (Fase 3, diperluas Fase 9–13)
- Konteks: `brain` dan `theater` adalah dua paket terpisah (daemon Node vs
  Next.js). Import silang akan mengikat build, bundler, dan versi Node browser.
- Keputusan:
  - Skema Zod diduplikasi di `brain/src/server/contract.ts` dan
    `theater/lib/events.ts` dengan fixture test yang sengaja identik
    (`contract.test.ts` ↔ `events.test.ts`).
  - Brain memvalidasi payload sebelum `io.emit`; Theater memvalidasi payload
    sebelum menyentuh store. Payload tidak valid ditolak + dicatat `logger.warn`.
  - Perubahan skema wajib mengubah kedua sisi + fixture test di PR yang sama.
- Konsekuensi: duplikasi dijaga oleh test paritas; tidak ada dependensi
  build-time antar paket; SDK pihak ketiga bisa ditambahkan per sisi tanpa
  saling mengunci.
