# ADR 0002 — State durable terpusat di DATA_DIR

- Status: Accepted (Fase 7, diperluas Fase 10–12)
- Konteks: run otonom harus selamat dari restart daemon dan bisa di-resume;
  audit run perlu riwayat; backup harus satu langkah.
- Keputusan:
  - Satu folder `DATA_DIR` (default `brain/data`) menampung semuanya:
    `office.db` (LangGraph checkpoint SQLite + tabel `runs`/`run_events`/
    `leads`/`cs_messages`/`briefing_messages`) dan `lancedb/` (vector memory).
  - `SqliteSaver` LangGraph + `RunStore` memakai file yang sama; `.db` dan
    `lancedb/` tidak pernah di-commit.
  - Backup/restore (`scripts/backup.mjs`) memperlakukan folder ini sebagai
    unit atomik + checksum SHA-256.
- Konsekuensi: migrasi VPS = memindahkan satu folder; restore aman diverifikasi
  checksum; jangan menjalankan dua daemon dengan DATA_DIR yang sama.
