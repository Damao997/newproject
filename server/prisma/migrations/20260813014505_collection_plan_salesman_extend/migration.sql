-- AlterTable
ALTER TABLE "collection_plan" ADD COLUMN     "billed_uncollected_amount" DECIMAL(18,2),
ADD COLUMN     "salesman_id" TEXT,
ADD COLUMN     "status_note" TEXT;

-- CreateTable
CREATE TABLE "salesman" (
    "id" TEXT NOT NULL,
    "company_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "remark" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salesman_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "salesman_company_code_idx" ON "salesman"("company_code");
