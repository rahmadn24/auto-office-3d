# ADR 0007 — Auth token privileged + injection di Caddy

- Status: Accepted (Fase 12)
- Konteks: widget CS harus bisa dipakai pengunjung anonim, sedangkan kontrol
  run/founder/CS operator tidak boleh terbuka. VPS memakai basic auth untuk
  operator, tetapi socket.io butuh jalur token yang sama untuk CLI/e2e.
- Keputusan:
  - `BRAIN_AUTH_TOKEN` di-set → semua event privileged (`control:*`, `run:*`,
    `founder:*`, `briefing:*`, `cs:list/history/quote/sweep`, HTTP
    `/control/*`) wajib token; channel publik hanya `cs:widget_message`.
  - Token kosong = semua terbuka (dev lokal & e2e) — jangan pernah kosong di
    VPS.
  - Caddy VPS menyuntik `Authorization: Bearer <token>` ke upstream brain dan
    menambahkan basic auth pada host `office.<domain>`; host `cs.<domain>`
    publik tanpa token.
  - Setiap handler operator baru wajib memanggil `denyUnprivileged(...)`.
- Konsekuensi: satu mekanisme token untuk socket + HTTP; audit handler mudah
  (grep `denyUnprivileged`); widget tetap anonim.
