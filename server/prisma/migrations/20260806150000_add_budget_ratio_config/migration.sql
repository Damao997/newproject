-- CreateTable
CREATE TABLE "budget_ratio_config" (
    "id" TEXT NOT NULL,
    "fiscal_year" TEXT NOT NULL,
    "ratios" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_ratio_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "budget_ratio_config_fiscal_year_key" ON "budget_ratio_config"("fiscal_year");
