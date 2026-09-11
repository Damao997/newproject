-- 多会话支持：refresh_token_jti 单值 → refresh_token_jti_list 数组（既有会话无损迁移）
ALTER TABLE "user" ADD COLUMN "refresh_token_jti_list" JSONB;
UPDATE "user" SET "refresh_token_jti_list" = jsonb_build_array("refresh_token_jti") WHERE "refresh_token_jti" IS NOT NULL;
ALTER TABLE "user" DROP COLUMN "refresh_token_jti";
