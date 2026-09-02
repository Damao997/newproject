-- AlterTable
ALTER TABLE "user" ADD COLUMN     "persistent_login_created_at" TIMESTAMP(3),
ADD COLUMN     "persistent_login_expires_at" TIMESTAMP(3),
ADD COLUMN     "persistent_login_token_hash" TEXT;

-- CreateIndex
CREATE INDEX "user_persistent_login_token_hash_idx" ON "user"("persistent_login_token_hash");
