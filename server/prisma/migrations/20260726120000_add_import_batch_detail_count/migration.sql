-- 导入批次新增「入库明细数」列（unpivot 后的事实记录数，区别于科目行数 row_count）
ALTER TABLE "import_batch" ADD COLUMN "detail_count" INTEGER NOT NULL DEFAULT 0;

-- 历史数据回填：以解析行数近似（旧批次无精确明细数）
UPDATE "import_batch" SET "detail_count" = "row_count";
