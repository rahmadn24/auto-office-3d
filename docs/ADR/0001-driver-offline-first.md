# ADR 0001 — Driver pattern offline-first (auto → stub → live)

- Status: Accepted (berlaku sejak Fase 1, diperluas Fase 9–13)
- Konteks: sistem harus bisa dijalankan tanpa satu pun API key (demo lokal,
  CI, e2e) tetapi memakai driver produksi begitu kredensial tersedia.
- Keputusan:
  - Setiap integrasi punya kontrak driver (`stub` offline deterministik vs
    `live` berbasis API).
  - Env `*_DRIVER=auto` memilih `live` hanya bila kredensial lengkap; selain
    itu jatuh ke `stub`.
  - Memaksa driver `live` tanpa kredensial **gagal saat boot** dengan pesan
    env yang kurang (`brain/src/config.ts` fail-fast).
  - `DEPLOY_DRIVER=auto` tidak pernah memilih `docker` (butuh daemon lokal);
    docker hanya aktif bila diminta eksplisit.
- Konsekuensi: `npm run dev`, test, dan e2e tidak butuh kredensial; salah
  konfigurasi produksi terdeteksi dini, bukan diam-diam memakai stub.
