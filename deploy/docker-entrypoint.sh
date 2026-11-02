#!/bin/sh
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "[entrypoint] DATABASE_URL 未注入，拒绝启动" >&2
  exit 1
fi

cd /app/server

# 平台共享库通常只注入一条连接串；用户自备库可提供独立的迁移账号。
if [ -n "${MIGRATE_DATABASE_URL:-}" ]; then
  MIGRATION_DATABASE_URL="$MIGRATE_DATABASE_URL"
else
  MIGRATION_DATABASE_URL="$DATABASE_URL"
fi

echo "[entrypoint] 执行 Prisma migration"
DATABASE_URL="$MIGRATION_DATABASE_URL" node node_modules/prisma/build/index.js migrate deploy

exec node dist/src/server.js
