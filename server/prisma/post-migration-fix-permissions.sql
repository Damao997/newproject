-- ============================================================
-- post-migration-fix-permissions.sql
-- 每次 Prisma migration 之后执行（迁移由超级用户 postgres 完成，
-- 新建的表默认不带 yipinhui_app 的授权，须在此补齐）。
--
-- 执行：
--   docker compose exec -T postgres \
--     psql -U postgres -d yipinhui -f /opt/init/post-migration-fix-permissions.sql
--
-- 幂等：可重复执行。
-- ============================================================

\set ON_ERROR_STOP on

-- 1. 新表/序列补授 DML
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO yipinhui_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO yipinhui_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO yipinhui_app;

-- 2. 确认业务账号无 DDL 能力（迁移可能重置 schema 级权限）
REVOKE CREATE ON SCHEMA public FROM yipinhui_app;

-- 3. 防篡改表回收写权限（每次迁移后可能被上一步的 ALL TABLES 重新放开）
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM yipinhui_app;
REVOKE UPDATE, DELETE, TRUNCATE ON token_blacklist FROM yipinhui_app;

-- 审计日志按月分区时，子分区需单独回收（父表授权不自动下传到已存在分区）
DO $do$
DECLARE
  part RECORD;
BEGIN
  FOR part IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname LIKE 'audit_log_%'
       AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('GRANT SELECT, INSERT ON %I TO yipinhui_app', part.relname);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM yipinhui_app', part.relname);
    RAISE NOTICE '分区 % 权限已修正（仅 INSERT + SELECT）', part.relname;
  END LOOP;
END
$do$;

-- 4. 自检：列出仍持有 UPDATE/DELETE 的防篡改表（应为空）
DO $do$
DECLARE
  leaked TEXT;
BEGIN
  SELECT string_agg(DISTINCT table_name || ':' || privilege_type, ', ')
    INTO leaked
    FROM information_schema.table_privileges
   WHERE grantee = 'yipinhui_app'
     AND table_schema = 'public'
     AND (table_name = 'audit_log' OR table_name LIKE 'audit_log_%' OR table_name = 'token_blacklist')
     AND privilege_type IN ('UPDATE', 'DELETE', 'TRUNCATE');

  IF leaked IS NOT NULL THEN
    RAISE EXCEPTION '防篡改校验失败，仍存在写权限：%', leaked;
  END IF;

  RAISE NOTICE '========================================';
  RAISE NOTICE '迁移后权限修复完成';
  RAISE NOTICE 'audit_log / token_blacklist 已确认仅 INSERT + SELECT';
  RAISE NOTICE '========================================';
END
$do$;
