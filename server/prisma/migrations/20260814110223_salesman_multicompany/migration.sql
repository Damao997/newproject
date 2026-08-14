-- CreateTable
CREATE TABLE "salesman_company" (
    "id" TEXT NOT NULL,
    "salesman_id" TEXT NOT NULL,
    "company_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "salesman_company_pkey" PRIMARY KEY ("id")
);

-- 回填现有业务员的单公司归属
INSERT INTO "salesman_company" ("id", "salesman_id", "company_code", "created_at")
SELECT gen_random_uuid(), "id", "company_code", "created_at" FROM "salesman"
WHERE "company_code" IS NOT NULL;

-- DropIndex
DROP INDEX "salesman_company_code_idx";

-- AlterTable
ALTER TABLE "salesman" DROP COLUMN "company_code";

-- CreateIndex
CREATE INDEX "salesman_company_company_code_idx" ON "salesman_company"("company_code");

-- CreateIndex
CREATE UNIQUE INDEX "salesman_company_salesman_id_company_code_key" ON "salesman_company"("salesman_id", "company_code");
