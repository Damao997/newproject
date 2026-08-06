-- 重分类记录失效标记：当相关数据批次被替换/归档/清除导致快照引用的行或批次不再有效时，
-- 由批次变更流程（激活/回滚/归档/清除）联动标记，撤销入口与回溯差额层据此显式跳过。
ALTER TABLE "reclassification_log" ADD COLUMN "invalidated_at" TIMESTAMP(3);
ALTER TABLE "reclassification_log" ADD COLUMN "invalidated_by" TEXT;
ALTER TABLE "reclassification_log" ADD COLUMN "invalidated_reason" TEXT; -- rows_replaced | batch_inactive

CREATE INDEX "reclassification_log_invalidated_at_idx" ON "reclassification_log"("invalidated_at");

-- DropIndex（原属 add_expense_subject_mapping，按时间序后移至此：先建后删，保证 shadow 重放自洽）
DROP INDEX "reclassification_log_invalidated_at_idx";
