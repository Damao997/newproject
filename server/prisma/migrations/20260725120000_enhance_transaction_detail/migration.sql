-- AlterTable: 增强 transaction_detail 表，支持六大往来账龄分析与内部往来标记
-- 先删除旧表重建（该表此前无生产数据）
DROP TABLE IF EXISTS "transaction_detail";

CREATE TABLE "transaction_detail" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT,
    "company_code" TEXT NOT NULL,
    "company_name" TEXT,
    "transaction_type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "cutoff_date" TEXT,
    "counterparty_code" TEXT NOT NULL,
    "counterparty_name" TEXT,
    "account_code" TEXT NOT NULL,
    "account_desc" TEXT,
    "sub_code" TEXT,
    "sub_name" TEXT,
    "source_type" TEXT,
    "document_no" TEXT,
    "document_line_no" TEXT,
    "booking_date" TEXT,
    "due_date" TEXT,
    "internal_area" TEXT,
    "product" TEXT,
    "product_desc" TEXT,
    "project" TEXT,
    "project_desc" TEXT,
    "remark" TEXT,
    "aging_days" INTEGER,
    "opening_balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "debit_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "closing_balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "aging_1m" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "aging_2m" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "aging_3m" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "aging_4m" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "aging_5m" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "aging_6m" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "aging_6m_to_1y" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "aging_1y_to_2y" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "aging_2y_to_3y" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "aging_3y_plus" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "aging_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "is_internal" BOOLEAN NOT NULL DEFAULT false,
    "internal_type" TEXT,
    "internal_peer_code" TEXT,
    "is_eliminated" BOOLEAN NOT NULL DEFAULT false,
    "is_settled" BOOLEAN NOT NULL DEFAULT false,
    "source_file" TEXT,
    "period" TEXT,
    "raw_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transaction_detail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transaction_detail_company_code_transaction_type_idx" ON "transaction_detail"("company_code", "transaction_type");
CREATE INDEX "transaction_detail_counterparty_code_idx" ON "transaction_detail"("counterparty_code");
CREATE INDEX "transaction_detail_batch_id_idx" ON "transaction_detail"("batch_id");
CREATE INDEX "transaction_detail_is_internal_internal_type_idx" ON "transaction_detail"("is_internal", "internal_type");
