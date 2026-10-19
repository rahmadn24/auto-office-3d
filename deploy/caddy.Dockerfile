# AutoOffice3D — Caddy opsional dengan plugin rate-limit (PRD §6.5 / Fase 12).
#
# Image `caddy:2-alpine` polos BELUM punya direktif `rate_limit`; untuk
# mengaktifkannya di VPS:
#
#   docker build -f deploy/caddy.Dockerfile -t 9routerdev/caddy-ratelimit:2 .
#
# lalu di docker-compose.vps.yml ganti `image:` service caddy ke
# `9routerdev/caddy-ratelimit:2` dan hapus komentar blok `rate_limit` di
# deploy/Caddyfile.vps. Tanpa image ini, perlindungan pemakaian tetap berjalan
# lewat basic auth + token Brain (rate limit hanyalah lapisan tambahan).
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/mholt/caddy-ratelimit

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
