# ADR 0008 — Backup CLI + checksum, soak sebelum VPS

- Status: Accepted (Fase 12)
- Konteks: before go-live, state durable (SQLite + LanceDB) harus bisa
  di-backup terjadwal dan dipindahkan ke VPS tanpa korupsi. Menjalankan UI
  soak ≥14 hari dulu lebih murah daripada debug di produksi.
- Keputusan:
  - Backup = `scripts/backup.mjs` (tanpa dependensi luar): `tar.gz` + file
    `<archive>.sha256` + retensi `--keep N`.
  - Restore memverifikasi checksum dulu; daemon wajib berhenti sebelum restore
    ke DATA_DIR yang sedang ditulis.
  - Soak lokal (brain :4800 + theater :3001, `npm run dev`) berjalan ≥14 hari
    dengan kriteria lulus di `deploy/RUNBOOK.md` §1; hasilnya = prasyarat
    migrasi VPS.
  - Cron VPS memakai `docker compose exec -T brain node scripts/backup.mjs
    --keep 14`.
- Konsekuensi: backup bisa diaudit (checksum + retensi), dan go-live punya
  kriteria objektif (drill restart, tidak ada kebocoran memori/queue).
