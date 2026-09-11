-- 恢复事业部相关字段：company.business_unit、user.org_scope_bu（与 schema.prisma 对齐）
-- AlterTable
ALTER TABLE "company" ADD COLUMN IF NOT EXISTS "business_unit" TEXT;

-- AlterTable
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "org_scope_bu" JSONB;
