#!/bin/sh
# ============================================================
# init-roles.sh
# 挂载到 /docker-entrypoint-initdb.d/01-init-roles.sh，由 postgres
# 官方 entrypoint 在首次初始化（数据目录为空）时自动执行。
#
# 职责：把 DB_APP_PASSWORD 以 psql 变量传入 init-roles.sql。
# 必要性：entrypoint 对 *.sql 文件是无参调用 psql -f，无法传变量；
#         而密码不能硬编码在 SQL 里，故用本包装器桥接。
# ============================================================
set -eu

INIT_DIR=/opt/init

if [ -z "${DB_APP_PASSWORD:-}" ]; then
  echo "[init-roles] 致命错误：DB_APP_PASSWORD 未设置，无法创建业务账号" >&2
  exit 1
fi

echo "[init-roles] 创建 WAL 归档与备份目录"
mkdir -p /backup_data/wal /backup_data/full /backup_data/logs
# archive_command 由 postgres 进程（postgres 用户）执行，须可写
chown -R postgres:postgres /backup_data 2>/dev/null || true

echo "[init-roles] 执行 init-roles.sql（创建 yipinhui_app 并授最小权限）"
psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" \
     --dbname "$POSTGRES_DB" \
     -v app_password="$DB_APP_PASSWORD" \
     -f "$INIT_DIR/init-roles.sql"

# audit_log 分区与独立权限（表由 Prisma 迁移创建，此处仅在已存在时生效）
if [ -f "$INIT_DIR/init-audit.sql" ]; then
  echo "[init-roles] 执行 init-audit.sql"
  psql -v ON_ERROR_STOP=1 \
       --username "$POSTGRES_USER" \
       --dbname "$POSTGRES_DB" \
       -f "$INIT_DIR/init-audit.sql" || \
    echo "[init-roles] 警告：init-audit.sql 执行未完全成功（通常因表尚未由迁移创建），迁移后请重跑"
fi

echo "[init-roles] 初始化完成"
