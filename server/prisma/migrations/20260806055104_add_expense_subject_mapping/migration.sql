-- CreateTable
CREATE TABLE "expense_subject_mapping" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject_codes" TEXT[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_subject_mapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expense_subject_mapping_code_key" ON "expense_subject_mapping"("code");

-- CreateIndex
CREATE INDEX "expense_subject_mapping_status_idx" ON "expense_subject_mapping"("status");

-- RenameIndex
ALTER INDEX "consolidation_adjustment_summary_template_period_account_idx" RENAME TO "consolidation_adjustment_summary_company_code_template_type_idx";
