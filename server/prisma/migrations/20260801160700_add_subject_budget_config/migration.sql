-- CreateTable
CREATE TABLE "subject_budget_config" (
    "id" TEXT NOT NULL,
    "company_code" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subject_budget_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subject_budget_config_company_code_key" ON "subject_budget_config"("company_code");

-- CreateIndex
CREATE INDEX "subject_budget_config_status_idx" ON "subject_budget_config"("status");
