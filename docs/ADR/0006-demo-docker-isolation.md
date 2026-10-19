# ADR 0006 — Isolasi demo di Docker (network `office` vs `demo-net`)

- Status: Accepted (Fase 10, dipakai Fase 12)
- Konteks: setiap run dapat membangun & menjalankan produk demo (container).
  Demo tidak boleh saling melihat, tidak boleh menembus jaringan internal
  (brain/cs), dan hanya boleh terekspos lewat Caddy.
- Keputusan:
  - Compose lokal: `brain`/`caddy`/`9router` di network `office`; kontainer
    demo di `demo-net` terpisah.
  - Brain tidak mem-publish port di compose; Caddy satu-satunya entry point.
  - Publikasi demo memakai port host acak + health probe; label
    `caddy=demo.<slug>.<domain>` membuat caddy-docker-proxy merutekan host.
  - Kontainer demo mendapat limit resource + spin-down (`docker compose ls`).
- Konsekuensi: demo tidak bisa menyentuh state internal; e2e Docker
  (`npm run e2e:docker`) memvalidasi 3 preset, isolasi, dan spin down.
