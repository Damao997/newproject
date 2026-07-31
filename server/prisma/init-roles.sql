-- ============================================================
-- init-roles.sql
-- 浙江壹品慧财年经营数据分析平台 — 数据库账号与最小权限初始化
--
-- 执行方式：由 init-roles.sh 调用，必须传入 psql 变量 app_password
--   psql -v ON_ERROR_STOP=1 -v app_password="$DB_APP_PASSWORD" -f init-roles.sql
-- 不要直接放入 /docker-entrypoint-initdb.d/ —— entrypoint 不会传递变量。
--
-- 幂等：可重复执行。
--
-- 与《部署运维规范》§4.1 的差异（规范原文无法执行，此处已修正）：
--   1. 规范在 DO $$ ... $$ 内使用 :'DB_APP_PASSWORD' —— psql 客户端变量不会
--      插值进服务端 PL/pgSQL 代码块，会被当作字面量导致语法错误。
--      改为在 DO 块外用 :'app_password' 拼接后经 format(%L) 转义执行。
--   2. 规范末尾在顶层使用 RAISE NOTICE —— RAISE 仅存在于 PL/pgSQL，
--      顶层裸写是语法错误。改为包进 DO 块。
--   3. 规范对 token_blacklist 回收 DELETE，但过期记录需要清理。
--      本脚本保持回收（应用账号不得删），清理改由 backup.sh 以超级用户执行。
-- ============================================================

\set ON_ERROR_STOP on

-- ── 1. 创建业务账号 yipinhui_app（仅 LOGIN，无 SUPERUSER/CREATEDB/CREATEROLE）
DO $do$
DECLARE
  pwd TEXT := :'app_password';
BEGIN
  IF pwd IS NULL OR length(pwd) < 12 THEN
    RAISE EXCEPTION 'DB_APP_PASSWORD 缺失或过短（要求 ≥12 字符）';
  END IF;

  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'yipinhui_app') THEN
    -- format(%L) 负责字面量转义，避免密码含引号时被注入
    EXECUTE format('CREATE ROLE yipinhui_app WITH LOGIN PASSWORD %L', pwd);
    RAISE NOTICE '业务账号 yipinhui_app 创建成功';
  ELSE
    EXECUTE format('ALTER ROLE yipinhui_app WITH LOGIN PASSWORD %L', pwd);
    RAISE NOTICE '业务账号 yipinhui_app 已存在，密码已同步';
  END IF;
END
$do$;

-- ── 2. 连接与 schema 使用权
GRANT CONNECT ON DATABASE yipinhui TO yipinhui_app;
GRANT USAGE ON SCHEMA public TO yipinhui_app;

-- ── 3. 显式收回 DDL 能力（public schema 默认允许建表，必须撤销）
REVOKE CREATE ON SCHEMA public FROM yipinhui_app;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO yipinhui_app;

-- ── 4. 现有对象授予 DML（不含 TRUNCATE/REFERENCES/TRIGGER）
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO yipinhui_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO yipinhui_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO yipinhui_app;

-- ── 5. 防篡改表：仅 INSERT + SELECT
--    首次初始化时这些表尚未由 Prisma 迁移创建，故做存在性判断；
--    迁移之后须执行 post-migration-fix-permissions.sql 补齐。
DO $do$
BEGIN
  IF EXISTS (SELECT FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'audit_log') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM yipinhui_app;
    RAISE NOTICE 'audit_log 防篡改权限已设置（仅 INSERT + SELECT）';
  ELSE
    RAISE NOTICE 'audit_log 尚未创建，防篡改权限待 migration 后由 post-migration 脚本设置';
  END IF;

  IF EXISTS (SELECT FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'token_blacklist') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON token_blacklist FROM yipinhui_app;
    RAISE NOTICE 'token_blacklist 权限已设置（仅 INSERT + SELECT）';
  ELSE
    RAISE NOTICE 'token_blacklist 尚未创建，权限待 post-migration 脚本设置';
  END IF;
END
$do$;

-- ── 6. 默认权限：对将来由 postgres 创建的对象自动生效
--    FOR ROLE postgres 是必要的 —— 默认权限按创建者绑定，
--    迁移由超级用户执行，故须声明其为创建者。
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO yipinhui_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO yipinhui_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO yipinhui_app;

-- ── 7. 结果自检
DO $do$
DECLARE
  tbl_count INTEGER;
BEGIN
  SELECT count(DISTINCT table_name) INTO tbl_count
    FROM information_schema.table_privileges
   WHERE grantee = 'yipinhui_app' AND table_schema = 'public';
  RAISE NOTICE '========================================';
  RAISE NOTICE '数据库初始化完成';
  RAISE NOTICE '业务账号：yipinhui_app（仅 DML，无 DDL）';
  RAISE NOTICE '已授权表数量：%', tbl_count;
  RAISE NOTICE '迁移后请执行 post-migration-fix-permissions.sql';
  RAISE NOTICE '========================================';
END
$do$;
