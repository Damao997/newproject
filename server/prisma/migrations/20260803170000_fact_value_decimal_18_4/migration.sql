-- 事实表金额精度提升：Decimal(18,2) → Decimal(18,4)
-- 支持导入时元单位 ÷10000 转万元的无损存储（如 12345 元 = 1.2345 万）；
-- 精度提升为无损转换，展示层两位小数格式化不受影响。
ALTER TABLE "fact_operating" ALTER COLUMN "value" SET DATA TYPE DECIMAL(18,4);
ALTER TABLE "fact_static" ALTER COLUMN "value" SET DATA TYPE DECIMAL(18,4);
ALTER TABLE "fact_budget" ALTER COLUMN "value" SET DATA TYPE DECIMAL(18,4);
