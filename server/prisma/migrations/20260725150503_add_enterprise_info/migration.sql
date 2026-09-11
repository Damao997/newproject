-- CreateTable
CREATE TABLE "enterprise_info" (
    "id" TEXT NOT NULL,
    "credit_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legal_person" TEXT,
    "registered_capital" TEXT,
    "establish_date" TEXT,
    "status" TEXT,
    "company_type" TEXT,
    "industry" TEXT,
    "registered_address" TEXT,
    "business_scope" TEXT,
    "raw" JSONB,
    "provider" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enterprise_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enterprise_query_log" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "matched_name" TEXT,
    "from_cache" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enterprise_query_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "enterprise_info_credit_code_key" ON "enterprise_info"("credit_code");

-- CreateIndex
CREATE INDEX "enterprise_info_name_idx" ON "enterprise_info"("name");

-- CreateIndex
CREATE INDEX "enterprise_info_expires_at_idx" ON "enterprise_info"("expires_at");

-- CreateIndex
CREATE INDEX "enterprise_query_log_user_id_created_at_idx" ON "enterprise_query_log"("user_id", "created_at");
