-- 邮箱重置密码：user.email 加唯一约束（可空列唯一索引允许多个 NULL，未绑定邮箱不受影响）
-- 开发库已核查（2026-10-05）：存量 email 无重复（6 用户全部为 NULL）

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateTable
CREATE TABLE "password_reset_code" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_code_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "password_reset_code_user_id_idx" ON "password_reset_code"("user_id");

-- CreateIndex
CREATE INDEX "password_reset_code_expires_at_idx" ON "password_reset_code"("expires_at");

-- AddForeignKey
ALTER TABLE "password_reset_code" ADD CONSTRAINT "password_reset_code_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
