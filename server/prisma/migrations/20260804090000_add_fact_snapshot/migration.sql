-- 批次回滚支撑：新增导入数据快照表（fact_snapshot）
-- 激活覆盖旧批次时将被物理删除的事实行先备份至此，回滚时恢复；
-- 仅 operating/static/budget 三类（transaction 明细行级回滚 v1 不支持）。
CREATE TABLE "fact_snapshot" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "archived_by_batch_id" TEXT,
    "template" "ImportDataType" NOT NULL,
    "company_code" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "period" TEXT,
    "snapshot_date" DATE,
    "fiscal_year" TEXT,
    "period_dim_code" TEXT,
    "value" DECIMAL(18,4) NOT NULL,
    "raw_json" JSONB,
    "archived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fact_snapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fact_snapshot_batch_id_template_idx" ON "fact_snapshot"("batch_id", "template");
CREATE INDEX "fact_snapshot_archived_by_batch_id_idx" ON "fact_snapshot"("archived_by_batch_id");
