# AutoOffice3D — The Brain (daemon LangGraph + Socket.io telemetry).
#
# Runtime memakai `tsx` (TypeScript langsung) — script `npm start` di host
# melakukan hal yang sama, jadi image tidak perlu langkah kompilasi terpisah.
# State durable (office.db + LanceDB) hidup di volume /app/data.
#
# Demo deployment (DEPLOY_DRIVER=docker) memakai Docker CLI di dalam image ini
# → socket host di-mount oleh docker-compose.yml.
FROM node:22-slim

# Docker CLI (+ plugin buildx) untuk driver deploy demo container.
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:27-cli /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins

ENV NODE_ENV=production
WORKDIR /app

# Layer dependency — hanya production deps (tsx ikut karena runner runtime).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

ENV PORT=4800
ENV SOCKET_PATH=/brain-server
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 4800

HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4800) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node_modules/.bin/tsx", "src/index.ts"]
