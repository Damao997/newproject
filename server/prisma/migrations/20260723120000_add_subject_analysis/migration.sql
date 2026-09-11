-- AlterTable: report_section 增加对单项分析的实时引用列
ALTER TABLE "report_section" ADD COLUMN "analysis_id" TEXT;

-- CreateTable: 单项分析表（公司 × 科目 × 期间）
CREATE TABLE "subject_analysis" (
    "id" TEXT NOT NULL,
    "company_code" TEXT NOT NULL,
    "subject_code" TEXT NOT NULL,
    "subject_type" "SubjectType" NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metric_context" JSONB,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subject_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subject_analysis_company_code_subject_code_period_key" ON "subject_analysis"("company_code", "subject_code", "period");

-- CreateIndex
CREATE INDEX "subject_analysis_company_code_period_idx" ON "subject_analysis"("company_code", "period");

-- CreateIndex
CREATE INDEX "subject_analysis_subject_code_idx" ON "subject_analysis"("subject_code");

-- CreateIndex
CREATE INDEX "subject_analysis_status_idx" ON "subject_analysis"("status");

-- CreateIndex
CREATE INDEX "report_section_analysis_id_idx" ON "report_section"("analysis_id");
