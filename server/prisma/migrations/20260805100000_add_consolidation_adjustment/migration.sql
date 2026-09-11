-- 汇总抵消调整表：在汇总主体（如 ET0001）聚合口径上按科目/期间叠加抵消金额，
-- 解决内部公司间交易（如集团内现金流）在汇总层面的重复计算；单体报表不受影响。
-- 软删除（deleted_at）即撤销抵消，聚合查询只取未删除记录。
CREATE TABLE "consolidation_adjustment" (
    "id" TEXT NOT NULL,
    "template_type" TEXT NOT NULL,
    "summary_company_code" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),
    "updated_by" TEXT,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "consolidation_adjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "consolidation_adjustment_summary_template_period_account_idx"
    ON "consolidation_adjustment"("summary_company_code", "template_type", "period", "account_code");
