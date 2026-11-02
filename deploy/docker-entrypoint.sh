#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[entrypoint] DATABASE_URL 未注入，拒绝启动" >&2
  exit 1
fi

cd /app/server

# 中台固定从容器 80 端口接入，但禁止业务 Node 进程以 root 运行。
# 仅由 root 启动端口转发，Node 及 migration 始终降权到 node 用户。
if [ "${PORT:-8080}" = "80" ]; then
  echo "[entrypoint] 启动 80 -> 8080 端口转发"
  socat TCP-LISTEN:80,fork,reuseaddr TCP:127.0.0.1:8080 &
  PORT=8080
  export PORT
fi

# 平台共享库通常只注入一条连接串；用户自备库可提供独立的迁移账号。
if [ -n "${MIGRATE_DATABASE_URL:-}" ]; then
  MIGRATION_DATABASE_URL="$MIGRATE_DATABASE_URL"
else
  MIGRATION_DATABASE_URL="$DATABASE_URL"
fi

echo "[entrypoint] 执行 Prisma migration"
DATABASE_URL="$MIGRATION_DATABASE_URL" su-exec node node node_modules/prisma/build/index.js migrate deploy

exec su-exec node node dist/src/server.js
