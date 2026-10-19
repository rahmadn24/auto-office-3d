# ADR 0005 — Payment Sentinel multi-provider (stub/stripe/midtrans/xendit)

- Status: Accepted (Fase 9, dipertahankan Fase 10–13)
- Konteks: demo publik butuh alur bayar tanpa akun gateway; produksi butuh
  Stripe (kartu global) dan Midtrans (Indonesia), tanpa mengubah alur otomasi.
- Keputusan:
  - Kontrak `PaymentProvider` tunggal (`createLink`, `receiveWebhook`,
    `metrics`, `demoNotification`); webhook route mengikuti driver aktif:
    `/webhook/{stripe|midtrans|stub|xendit}`.
  - Semua verifikasi signature + idempotency (`eventId` unik) berada di driver;
    handler HTTP hanya meneruskan dan mem-broadcast hasil.
  - Signature invalid saat secret terpasang → `401` + `firstSale:false` dan
    metrics tidak naik (dikunci test regresi).
  - Driver `stub` menyediakan halaman `/demo/checkout` + `POST /demo/pay`.
- Konsekuensi: menambah gateway baru = satu driver + routing, bukan cabang alur;
  milestone `first_sale` konsisten lintas provider.
