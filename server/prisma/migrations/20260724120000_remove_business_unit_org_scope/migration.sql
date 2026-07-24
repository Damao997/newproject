-- 移除事业部维度模块：删除 company.business_unit、user.org_scope_bu、user.business_unit 及相关索引
-- DropIndex
DROP INDEX IF EXISTS "company_business_unit_idx";

-- AlterTable
ALTER TABLE "company" DROP COLUMN IF EXISTS "business_unit";

-- AlterTable
ALTER TABLE "user" DROP COLUMN IF EXISTS "org_scope_bu";
ALTER TABLE "user" DROP COLUMN IF EXISTS "business_unit";
