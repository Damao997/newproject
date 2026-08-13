-- CreateTable
CREATE TABLE "customer_ext" (
    "id" TEXT NOT NULL,
    "company_code" TEXT NOT NULL,
    "counterparty_code" TEXT NOT NULL,
    "billed_uncollected_amount" DECIMAL(18,2),
    "salesman_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_ext_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_ext_company_code_idx" ON "customer_ext"("company_code");

-- CreateIndex
CREATE UNIQUE INDEX "customer_ext_company_code_counterparty_code_key" ON "customer_ext"("company_code", "counterparty_code");
