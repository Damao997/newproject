FROM registry.zrhsh.com/library/node:20-alpine AS builder

WORKDIR /app

# 后端 postinstall 会执行 prisma generate，因此 schema 必须先于 npm ci 就位。
COPY server/package.json server/package-lock.json ./server/
COPY server/vendor ./server/vendor
COPY server/prisma ./server/prisma
RUN cd server && npm ci

COPY server/tsconfig.json ./server/
COPY server/src ./server/src
RUN cd server && npm run build

COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci

COPY web/tsconfig*.json web/vite.config.ts web/postcss.config.js web/tailwind.config.js web/index.html ./web/
COPY web/public ./web/public
COPY web/src ./web/src
RUN cd web && npm run build

FROM registry.zrhsh.com/library/node:20-alpine AS runner

RUN apk add --no-cache openssl socat su-exec

ENV NODE_ENV=production \
    PORT=8080 \
    WEB_ROOT=/app/web

WORKDIR /app

COPY --from=builder --chown=node:node /app/server/node_modules ./server/node_modules
COPY --from=builder --chown=node:node /app/server/dist ./server/dist
COPY --from=builder --chown=node:node /app/server/prisma ./server/prisma
COPY --from=builder --chown=node:node /app/server/package.json ./server/package.json
COPY --from=builder --chown=node:node /app/web/dist ./web
COPY --chown=node:node deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /app/server/uploads/report-images \
    && chown -R node:node /app/server/uploads

EXPOSE 80 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q --spider "http://127.0.0.1:${PORT}/health" || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
