-- AlterTable
ALTER TABLE "salesman" ADD COLUMN     "status" "RecordStatus" NOT NULL DEFAULT 'active';

-- CreateIndex
CREATE INDEX "salesman_status_idx" ON "salesman"("status");
