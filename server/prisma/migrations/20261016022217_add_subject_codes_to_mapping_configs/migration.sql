-- AlterTable
ALTER TABLE "key_metrics_product" ADD COLUMN     "subject_codes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "product_category" ADD COLUMN     "subject_codes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "user_preference" ALTER COLUMN "updated_at" DROP DEFAULT;
