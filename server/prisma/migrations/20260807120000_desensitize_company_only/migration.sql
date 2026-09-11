-- 脱敏策略调整：仅公司名称动态映射脱敏；金额/百分比/趋势等数值数据不脱敏
-- 1) 既有 amount（金额分档）规则一律禁用
UPDATE ai_desensitize_config
SET enabled = false, updated_at = NOW()
WHERE config_type = 'amount';

-- 2) 表为空时插入 amount 禁用声明（id 无 DB 默认值，显式 gen_random_uuid；PG13+ 内置）
INSERT INTO ai_desensitize_config (id, config_type, pattern, replacement, enabled, priority, created_at, updated_at)
SELECT gen_random_uuid(), 'amount', '', '', false, 0, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM ai_desensitize_config WHERE config_type = 'amount');
