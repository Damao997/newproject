-- 用户多选数据范围：新增 data_scope_codes JSONB（公司编码数组，可混合 EN 单体与 ET 汇总）
ALTER TABLE "user" ADD COLUMN "data_scope_codes" JSONB;

-- 回填历史数据：已绑定单体公司的用户，数据范围初始化为 [company_code]
UPDATE "user" SET "data_scope_codes" = jsonb_build_array("company_code") WHERE "company_code" IS NOT NULL;
