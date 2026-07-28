-- CreateEnum
CREATE TYPE "ValueType" AS ENUM ('amount', 'quantity', 'ratio');

-- AlterTable
ALTER TABLE "account_subject" ADD COLUMN     "value_type" "ValueType" NOT NULL DEFAULT 'amount';
