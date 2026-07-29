-- CreateTable
CREATE TABLE "transaction_account" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transaction_type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "note" TEXT,
    "order_no" INTEGER NOT NULL DEFAULT 0,
    "status" "RecordStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_account_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "transaction_account_transaction_type_idx" ON "transaction_account"("transaction_type");
