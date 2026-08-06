-- 运营费用映射编码规范化：用户手工创建的违规编码 cost001 迁移为 EXP_ 前缀规范编码
-- （归并/自定义映射编码规则：EXP_ 前缀 + 小写英文/数字/下划线）
UPDATE "expense_subject_mapping" SET "code" = 'EXP_rd_expense', "updated_at" = NOW() WHERE "code" = 'cost001';
