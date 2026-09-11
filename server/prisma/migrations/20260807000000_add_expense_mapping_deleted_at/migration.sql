-- AlterTable
ALTER TABLE "expense_subject_mapping" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "expense_subject_mapping_deleted_at_idx" ON "expense_subject_mapping"("deleted_at");
