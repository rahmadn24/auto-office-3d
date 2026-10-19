# Runbook Fase 12 — Soak Test → Go-Live VPS

PRD v3.0 §2.3 (topologi), §6.5/6.6 (auth & isolasi), §7 Fase 12.
Kartu Trello: 12.1–12.7 + gate "🎯 AC & Gate Fase 12".

Kantor 24/7 hanya boleh live setelah **soak lokal ≥ 2 minggu** lulus. Dokumen
ini adalah prosedur operasionalnya: apa yang dijalankan, cara memantau, kriteria
lulus, cara backup/restore, dan langkah migrasi ke VPS.

---

## 0. Arsitektur singkat

| Komponen | Lokal (`npm run dev`) | Compose lokal | VPS |
| --- | --- | --- | --- |
| Brain | `:4800` | internal (tanpa `ports:`) | internal |
| Theater | `:3001` | lewat Caddy | lewat Caddy + basic auth |
| 9router | opsional (`:20128`) | service internal | service internal |
| Caddy | — | `http://office.localhost`, `http://cs.localhost` | `https://office.<domain>`, `https://cs.<domain>`, `https://<slug>.demo.<domain>` |
| Demo | `:4510+` | port host | label `caddy=` → caddy-docker-proxy |

Lapisan auth:
1. **Caddy basic auth** di `office.<domain>` (manusia).
2. **`BRAIN_AUTH_TOKEN`** — socket/HTTP privileged: kontrol run, founder chat,
   CS inbox/quote. Caddy menyuntik `Authorization: Bearer <token>`.
3. **Widget publik** tanpa token → hanya boleh `cs:widget_message`
   (dibuktikan test `brain/tests/auth.test.ts`).
4. Webhook payment/WA/email punya secret/signature sendiri (Fase 9/11).

Rate limit: image Caddy standar belum punya plugin `rate_limit`; build
`deploy/caddy.Dockerfile` lalu aktifkan blok komentar di `deploy/Caddyfile.vps`.

---

## 1. Soak test lokal (≥ 14 hari)

### 1.1 Persiapan

```bash
# .env minimal untuk soak (notifikasi live supaya tidak perlu menunggui layar)
LOG_LEVEL=info
NOTIFY_DRIVER=auto
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
# Brain auth TIDAK wajib di lokal; biarkan kosong agar Theater dev tetap mudah.
BRAIN_AUTH_TOKEN=

npm run dev            # brain :4800 + theater :3001
```

Jalankan juga compose lokal sekali di awal soak untuk memastikan image
produksi ikut sehat (butuh Docker Desktop + ruang disk):

```bash
docker compose up --build -d
curl -s http://office.localhost/health | head -c 400
```

### 1.2 Ritme harian (5 menit)

```bash
# 1) Health: versi, uptime, driver, jumlah run, ukuran DATA_DIR
curl -s http://127.0.0.1:4800/health

# 2) Notifikasi: pastikan tidak ada `sent:false` beruntun di log
docker compose logs --since 24h brain | grep -i notify || true

# 3) Backup harian (cron di bawah) + cek arsip terbaru
ls -lt brain/backups | head -3

# 4) Disk tidak naik tak terkendali (DATA_DIR + Docker)
df -h /; du -sh brain/data
```

Cron backup lokal (opsional, retensi 14):

```cron
17 3 * * * cd /path/ke/autooffice3d && node scripts/backup.mjs --data brain/data --out brain/backups --keep 14 >> brain/backups/cron.log 2>&1
```

### 1.3 Kriteria lulus soak (gate go-live)

- [ ] ≥ 14 hari berturut-turut daemon hidup (boleh restart terencana, dicatat).
- [ ] ≥ 28 run otonom penuh (`stage=done`/deploy ready) tanpa intervensi manual.
- [ ] 0 kegagalan yang disebabkan infra (bukan QA gagal wajar) selama 7 hari terakhir.
- [ ] 3× uji restart aman:
      `kill -TERM <pid brain>` → start lagi → `/health.runs.total` tetap,
      run yang terputus ditandai `interrupted`, `run:resume` berhasil.
- [ ] 1× restore drill: backup → restore ke folder lain → RunStore terbaca
      (`node scripts/backup.mjs --restore ... --target ...`, lalu buka Theater
      dengan DATA_DIR hasil restore).
- [ ] Notifikasi sale/deploy/error benar-benar sampai ke HP (minimal 1 sale +
      1 simulasi error).
- [ ] Ukuran DATA_DIR wajar (< 2 GB) dan backup harian < 5 menit.
- [ ] Tidak ada `console.*` liar di jalur server (log JSON konsisten).

Catat hasil harian di tabel singkat (tanggal · run sukses/gagal · catatan).

### 1.4 Uji restart aman (wajib 3×)

```bash
# saat satu run sedang berjalan (kirim directive dari Theater lebih dulu)
kill -TERM $(lsof -ti :4800)
npm run dev
curl -s http://127.0.0.1:4800/health   # runs.total tidak reset
# di Theater: run berstatus interrupted → tombol resume → selesai
```

---

## 2. Go-live VPS — checklist preflight

- [ ] Soak lulus (semua poin §1.3).
- [ ] VPS 2 vCPU / 4 GB RAM / 40 GB disk (Docker + 9router + demo container).
- [ ] DNS: `office` + `cs` A record; `*.demo` wildcard A record.
- [ ] Port 80/443 terbuka; firewall hanya itu (+ SSH).
- [ ] `cp deploy/vps.env.example .env` dan semua nilai `GANTI_...` diganti.
- [ ] `BRAIN_AUTH_TOKEN=$(openssl rand -hex 32)`.
- [ ] `OFFICE_BASIC_AUTH` = `user hash` (bcrypt) — lihat komentar di env example.
- [ ] Salinan backup terbaru dari lokal sudah diunduh ke mesin lokal (bukan VPS).

Deploy:

```bash
git clone <repo> /opt/autooffice3d && cd /opt/autooffice3d
cp deploy/vps.env.example .env && $EDITOR .env
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.vps.yml ps
```

Verifikasi:

```bash
# Brain tidak punya port publik (hanya Caddy)
docker compose ps                      # brain/theater/9router tanpa 0.0.0.0:port
curl -sI https://office.example.com    # 401 tanpa basic auth
curl -s -u founder:password https://office.example.com/health | head -c 400
curl -s https://cs.example.com/widget/socket.io.min.js -o /dev/null -w '%{http_code}\n'  # 200

# 9router headless (tanpa GUI)
docker compose exec brain node scripts/check-9router.mjs \
  --url http://9router:20128 --key "$NINE_ROUTER_API_KEY" --model <id-model>
# → {"ok":true,...,"messages":{"ok":true,...}}

# Isolasi demo: container demo tidak bisa menjangkau brain/9router
docker run --rm --network demo-net node:22-slim node -e \
  "fetch('http://brain:4800/health', { signal: AbortSignal.timeout(3000) }).then(() => process.exit(1)).catch(() => process.exit(0))" \
  && echo 'TERISOLASI (benar)'
```

Smoke dari tablet (WSS aman lewat Caddy):

1. Buka `https://office.example.com`, login basic auth.
2. Kirim directive; pastikan status agent bergerak + artifact muncul.
3. Buka CS Inbox, kirim pesan dari halaman demo `https://<slug>.demo.example.com`
   → lead masuk, quote → link bayar → kontrak PDF terbuka.
4. Simulate payment (jika driver stub) → notifikasi sale masuk ke HP.
5. Reload tablet / ganti jaringan → socket re-connect (WSS) tanpa state hilang.

---

## 3. Migrasi data lokal → VPS

```bash
# 1) Backup di lokal (verifikasi checksum ikut dibuat)
node scripts/backup.mjs --data brain/data --out brain/backups --keep 14

# 2) Kirim arsip + sidecar ke VPS
scp brain/backups/backup-<ts>.tar.gz{,.sha256} user@vps:/opt/autooffice3d/backups/

# 3) Restore ke volume bernama `autooffice3d_brain-data`
docker compose run --rm -v "$PWD/backups:/backups:ro" \
  -v autooffice3d_brain-data:/target alpine \
  sh -c 'rm -rf /target/* && tar -xzf /backups/backup-<ts>.tar.gz -C /target --strip-components=1'
#    (checksum sudah diverifikasi di lokal; opsional verifikasi di VPS:
#     cd backups && sha256sum -c backup-<ts>.tar.gz.sha256)

# 4) Start & bandingkan jumlah run/lead
docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d
curl -s -u founder:password https://office.example.com/health
```

Catatan: restore menimpa isi volume — lakukan saat container brain berhenti
(`docker compose stop brain`). Jangan pernah restore ke DATA_DIR yang sedang
ditulis daemon.

---

## 4. Backup otomatis di VPS (cron)

`./backups` sudah di-mount ke `/app/backups` di container brain.

```cron
# tiap hari 03:17, retensi 14 arsip, log ringkas
17 3 * * * cd /opt/autooffice3d && docker compose exec -T brain node scripts/backup.mjs --keep 14 >> /var/log/ao3d-backup.log 2>&1
```

Restore drill bulanan (wajib): arsip ada di `./backups` pada host VPS, jadi
jalankan script yang sama dari root repo:

```bash
mkdir -p /tmp/ao3d-restore
node scripts/backup.mjs --restore backups/backup-<ts>.tar.gz --target /tmp/ao3d-restore
ls /tmp/ao3d-restore   # office.db + lancedb/ harus ada
# opsional: bandingkan ukuran/isi dengan volume aktif
```

Restore ke volume produksi hanya saat brain berhenti — lihat §3.

---

## 5. 9router — login sekali jalan & fallback

- Dashboard 9router **tidak** diekspos publik. Prosedur login sekali jalan:
  1. Tambahkan sementara di `docker-compose.vps.yml` service `9router`:
     `ports: ['127.0.0.1:20128:20128']` (loopback VPS saja).
  2. `docker compose ... up -d 9router`
  3. Dari laptop: `ssh -L 20128:127.0.0.1:20128 user@vps`
  4. Buka `http://localhost:20128`, login `INITIAL_PASSWORD`, buat API key
     (Proxies → API Keys), salin ke `.env` (`NINE_ROUTER_API_KEY`).
  5. Hapus lagi baris `ports:` dan `up -d 9router` — dashboard kembali privat.
- Verifikasi headless: `scripts/check-9router.mjs` (lihat §2), termasuk smoke
  `/v1/messages` bila `--model` diisi (memakai kuota provider upstream).
- Brain memakai gateway bila `ANTHROPIC_BASE_URL=http://9router:20128/v1` +
  `LLM_DRIVER=anthropic` + `ANTHROPIC_API_KEY=<API key 9router>`.
- **Fallback resmi**: hapus `ANTHROPIC_BASE_URL`, isi `ANTHROPIC_API_KEY` API
  resmi Anthropic. Tidak ada perubahan kode — driver `anthropic` sama.

---

## 6. Rollback & troubleshooting

| Gejala | Cek / aksi |
| --- | --- |
| `office.<domain>` 502 | `docker compose ps`; theater health; `docker compose logs caddy theater` |
| Socket terus `connecting` | basic auth belum tersimpan browser? buka ulang tab; cek `/brain-server` route Caddy |
| Semua aksi operator `unauthorized` | `BRAIN_AUTH_TOKEN` beda antara .env dan container; `docker compose up -d` ulang |
| Widget tidak muncul di demo | `CS_WIDGET_URL` harus `https://cs.<domain>`; cek `/widget/socket.io.min.js` 200 |
| Demo 404 | label `caddy=` tidak terbaca: `docker logs caddy | grep docker-proxy`; pastikan `DEMO_BASE_DOMAIN` di-set saat deploy |
| 9router 401 | `REQUIRE_API_KEY=true` → isi `NINE_ROUTER_API_KEY`; cek key di dashboard |
| Disk penuh | `docker system df`; `docker image prune`; arsip backup retensi; log rotate (sudah 10m×5) |

Rollback cepat: `docker compose down` (data aman di volume) → checkout tag
sebelumnya → `up -d --build`. Restore data hanya bila migrasi/skema bermasalah.

---

## 7. Status verifikasi Fase 12 (jujur)

| Item | Status |
| --- | --- |
| Backup + restore test | ✅ otomatis (`brain/tests/backup.test.ts`) |
| Logger pino + `/health` | ✅ otomatis (`logger.test.ts`, `server.test.ts`) |
| Notifikasi Telegram/Discord | ✅ unit test (fetch mock); kirim nyata menunggu kredensial |
| Auth token socket/HTTP | ✅ otomatis (`auth.test.ts`) |
| Compose lokal + overlay VPS | ✅ `docker compose config` valid; **runtime Docker ditunda** (disk) |
| 9router headless | 🕓 script siap; eksekusi menunggu VPS/image |
| Soak ≥ 2 minggu | 🕓 berjalan setelah go-ahead Founder |
| Migrasi + smoke tablet | 🕓 setelah soak lulus |
