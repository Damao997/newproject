-- B3：audit_log 新增 user_agent（安全取证：区分同 IP 不同客户端）
-- 可空 + 512 上限，由 recordAudit 截断后写入。
ALTER TABLE "audit_log" ADD COLUMN IF NOT EXISTS "user_agent" VARCHAR(512);

-- B5：permission.action 由 VARCHAR 收紧为库级枚举 PermissionAction
-- 值域与 prisma/seed.ts 的 PERMISSIONS 一一对应；防止拼写错误的权限记录
-- 静默成为永不命中的死权限（requirePermission 按 resource+action 精确匹配）。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PermissionAction') THEN
    CREATE TYPE "PermissionAction" AS ENUM ('view', 'create', 'update', 'delete', 'export', 'import', 'approve');
  END IF;
END
$$;

-- 转换前置校验：存量数据若含枚举外的值，立即报错中止迁移（而非静默丢数据）
DO $$
DECLARE
  bad_count INTEGER;
  bad_values TEXT;
BEGIN
  SELECT COUNT(*), string_agg(DISTINCT "action", ', ')
    INTO bad_count, bad_values
    FROM "permission"
   WHERE "action" NOT IN ('view', 'create', 'update', 'delete', 'export', 'import', 'approve');

  IF bad_count > 0 THEN
    RAISE EXCEPTION 'permission.action 存在 % 条枚举外的值：%。请先修正数据再迁移。', bad_count, bad_values;
  END IF;
END
$$;

-- USING 显式转换，保留存量行（勿用 Prisma 默认的 drop+add，会清空权限表）
ALTER TABLE "permission"
  ALTER COLUMN "action" TYPE "PermissionAction"
  USING "action"::"PermissionAction";
