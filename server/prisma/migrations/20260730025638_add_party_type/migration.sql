-- AlterTable
ALTER TABLE "counterparty" ADD COLUMN     "party_type" TEXT NOT NULL DEFAULT 'external';

-- AlterTable
ALTER TABLE "transaction_detail" ADD COLUMN     "party_type" TEXT NOT NULL DEFAULT 'external';

-- CreateIndex
CREATE INDEX "transaction_detail_party_type_idx" ON "transaction_detail"("party_type");
