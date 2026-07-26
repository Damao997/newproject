-- AlterTable
ALTER TABLE "company" ADD COLUMN     "business_unit" TEXT;

-- AlterTable
ALTER TABLE "user" ADD COLUMN     "org_scope_bu" JSONB;
