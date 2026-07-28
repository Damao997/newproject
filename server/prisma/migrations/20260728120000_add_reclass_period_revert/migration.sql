-- 重分类记录：单月期间字段 + 撤销留痕字段
ALTER TABLE "reclassification_log" ADD COLUMN "period" TEXT;
ALTER TABLE "reclassification_log" ADD COLUMN "reverted_at" TIMESTAMP(3);
ALTER TABLE "reclassification_log" ADD COLUMN "reverted_by" TEXT;
