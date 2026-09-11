-- 重分类记录表：记录跨公司/科目归类调整操作，供审计追溯与历史查询
CREATE TABLE "reclassification_log" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "template_type" TEXT,
    "source_company" TEXT,
    "target_company" TEXT,
    "source_subject" TEXT,
    "target_subject" TEXT,
    "period_from" TEXT,
    "period_to" TEXT,
    "affected_rows" INTEGER NOT NULL DEFAULT 0,
    "operated_by" TEXT NOT NULL,
    "detail" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reclassification_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "reclassification_log_type_created_at_idx" ON "reclassification_log"("type", "created_at");
