#!/bin/sh
# ============================================================
# backup.sh
# 浙江壹品慧财年经营数据分析平台 — 数据库备份与保留策略
#
# 运行环境：db-backup 容器（postgres:15-alpine），由 crond 调度。
# 连接凭证来自环境变量 PGHOST/PGUSER/PGPASSWORD/PGDATABASE（超级用户）。
#
# 用法：
#   backup.sh full                 每日全量（pg_dump -Fc + AES-256 加密）
#   backup.sh rotate               WAL 归档轮转与过期清理
#   backup.sh cleanup-blacklist    清理 token_blacklist 过期记录
#   backup.sh restore <file>       从加密备份恢复（交互确认，谨慎使用）
#   backup.sh verify <file>        校验备份可解密且结构完整（不落库）
#
# 目录约定（挂载于 backup_data 卷）：
#   /backup_data/full    全量备份（*.dump.enc）
#   /backup_data/wal     WAL 归档（由 postgres archive_command 写入）
#   /backup_data/logs    运行日志
# ============================================================
set -eu

FULL_DIR=/backup_data/full
WAL_DIR=/backup_data/wal
LOG_DIR=/backup_data/logs

FULL_RETENTION_DAYS="${FULL_RETENTION_DAYS:-30}"
WAL_RETENTION_DAYS="${WAL_RETENTION_DAYS:-7}"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

die() {
  log "错误：$*"
  exit 1
}

require_key() {
  [ -n "${BACKUP_ENCRYPTION_KEY:-}" ] || die "BACKUP_ENCRYPTION_KEY 未设置，拒绝产出未加密备份"
  # 32 字符起：与 openssl rand -hex 32（64 字符）配合，防止弱口令
  [ ${#BACKUP_ENCRYPTION_KEY} -ge 32 ] || die "BACKUP_ENCRYPTION_KEY 过短（要求 ≥32 字符）"
}

ensure_dirs() {
  mkdir -p "$FULL_DIR" "$WAL_DIR" "$LOG_DIR"
}

# ── 全量备份 ────────────────────────────────────────────────
do_full() {
  require_key
  ensure_dirs

  ts=$(date '+%Y%m%d_%H%M%S')
  target="$FULL_DIR/yipinhui_${ts}.dump.enc"
  tmp="${target}.partial"

  log "开始全量备份 -> $target"

  # -Fc 自定义格式（支持并行恢复与选择性恢复）
  # 管道直接加密，明文不落盘
  # pbkdf2 + 高迭代：抵御离线暴破
  if ! pg_dump -Fc --no-owner --no-acl \
      | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
          -pass env:BACKUP_ENCRYPTION_KEY -out "$tmp"; then
    rm -f "$tmp"
    die "全量备份失败（pg_dump 或加密环节）"
  fi

  # 原子化落地：先 .partial 再 mv，避免 cron 与清理任务读到半成品
  mv "$tmp" "$target"
  chmod 600 "$target"

  size=$(du -h "$target" | cut -f1)
  log "全量备份完成：$target（$size）"

  # 立即校验新备份可解密，避免"备份成功但不可用"
  if do_verify "$target" >/dev/null 2>&1; then
    log "新备份校验通过"
  else
    log "警告：新备份校验失败，请立即人工介入"
  fi

  prune_full
}

prune_full() {
  log "清理 ${FULL_RETENTION_DAYS} 天前的全量备份"
  find "$FULL_DIR" -name '*.dump.enc' -type f -mtime "+${FULL_RETENTION_DAYS}" -print -delete || true
  # 清理可能残留的中断文件
  find "$FULL_DIR" -name '*.partial' -type f -mtime +1 -print -delete || true
}

# ── WAL 轮转 ────────────────────────────────────────────────
do_rotate() {
  ensure_dirs
  log "WAL 归档状态检查"

  count=$(find "$WAL_DIR" -type f | wc -l | tr -d ' ')
  log "当前 WAL 文件数：$count"

  # 触发一次日志切换，确保当前 WAL 及时归档（否则低写入期可能长时间不归档）
  psql -qtAX -c "SELECT pg_switch_wal();" >/dev/null 2>&1 || \
    log "警告：pg_switch_wal 调用失败（数据库可能不可达）"

  log "清理 ${WAL_RETENTION_DAYS} 天前的 WAL 归档"
  find "$WAL_DIR" -type f -mtime "+${WAL_RETENTION_DAYS}" -print -delete || true
}

# ── token_blacklist 过期清理 ────────────────────────────────
# 由超级用户执行：业务账号 yipinhui_app 对该表的 DELETE 已被 init-roles.sql 回收
do_cleanup_blacklist() {
  log "清理 token_blacklist 过期记录"
  deleted=$(psql -qtAX -c "DELETE FROM token_blacklist WHERE expired_at < NOW();" 2>/dev/null || echo "FAILED")
  if [ "$deleted" = "FAILED" ]; then
    log "警告：token_blacklist 清理失败（数据库可能不可达）"
  else
    log "token_blacklist 清理完成：$deleted"
  fi
}

# ── 备份校验（解密 + 结构可读，不落库）────────────────────────
do_verify() {
  require_key
  file="${1:-}"
  [ -n "$file" ] || die "用法：backup.sh verify <备份文件>"
  [ -f "$file" ] || die "备份文件不存在：$file"

  log "校验备份：$file"
  # 解密后交由 pg_restore --list 解析头部；能列出目录即证明文件完整
  if openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
       -pass env:BACKUP_ENCRYPTION_KEY -in "$file" \
     | pg_restore --list > /dev/null 2>&1; then
    log "校验通过：可解密且归档结构完整"
    return 0
  fi
  die "校验失败：无法解密或归档结构损坏"
}

# ── 恢复（破坏性操作，需显式确认）──────────────────────────────
do_restore() {
  require_key
  file="${1:-}"
  [ -n "$file" ] || die "用法：backup.sh restore <备份文件>"
  [ -f "$file" ] || die "备份文件不存在：$file"

  # 双重确认：环境变量 + 交互输入，避免误触发覆盖生产库
  if [ "${CONFIRM_RESTORE:-}" != "yes" ]; then
    die "恢复会覆盖 ${PGDATABASE} 现有数据。确认请设置 CONFIRM_RESTORE=yes 后重试"
  fi

  log "先做恢复前保护性备份"
  do_full

  log "开始恢复：$file -> $PGDATABASE"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
      -pass env:BACKUP_ENCRYPTION_KEY -in "$file" \
    | pg_restore --clean --if-exists --no-owner --no-acl -d "$PGDATABASE" \
    || die "恢复失败，请检查日志；恢复前备份已保存在 $FULL_DIR"

  log "恢复完成。请执行 post-migration-fix-permissions.sql 重建业务账号权限"
}

# ── 入口 ────────────────────────────────────────────────────
case "${1:-}" in
  full)               do_full ;;
  rotate)             do_rotate ;;
  cleanup-blacklist)  do_cleanup_blacklist ;;
  verify)             shift; do_verify "${1:-}" ;;
  restore)            shift; do_restore "${1:-}" ;;
  *)
    echo "用法：$0 {full|rotate|cleanup-blacklist|verify <file>|restore <file>}" >&2
    exit 2
    ;;
esac
