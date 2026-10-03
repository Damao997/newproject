-- 仅增加个人资料字段与账号偏好表，不修改业务数据。
ALTER TABLE "user" ADD COLUMN "phone" TEXT, ADD COLUMN "department" TEXT, ADD COLUMN "job_title" TEXT, ADD COLUMN "avatar_key" TEXT;
CREATE TABLE "user_preference" (
  "user_id" TEXT NOT NULL,
  "preferences" JSONB NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_preference_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "user_preference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
