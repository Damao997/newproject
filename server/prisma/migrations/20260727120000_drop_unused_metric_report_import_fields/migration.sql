-- 清理零引用/只写不读字段（调研见 2026-07-27 字段清理计划）：
--   metric: direction/is_derived/description/owner/ai_suggested（is_derived 语义由 data_type='calc' 表达）
--   report.template_id、report_section.auto_data、import_batch.mapping_scheme_id、import_batch.period 均从未读写
-- AlterTable
ALTER TABLE "metric" DROP COLUMN IF EXISTS "direction";
ALTER TABLE "metric" DROP COLUMN IF EXISTS "is_derived";
ALTER TABLE "metric" DROP COLUMN IF EXISTS "description";
ALTER TABLE "metric" DROP COLUMN IF EXISTS "owner";
ALTER TABLE "metric" DROP COLUMN IF EXISTS "ai_suggested";

-- AlterTable
ALTER TABLE "report" DROP COLUMN IF EXISTS "template_id";

-- AlterTable
ALTER TABLE "report_section" DROP COLUMN IF EXISTS "auto_data";

-- AlterTable
ALTER TABLE "import_batch" DROP COLUMN IF EXISTS "mapping_scheme_id";
ALTER TABLE "import_batch" DROP COLUMN IF EXISTS "period";
