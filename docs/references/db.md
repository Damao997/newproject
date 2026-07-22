# 数据库设计规范（模块 6）

## 技术栈（以项目现有为准）

- **关系型**：PostgreSQL 15+（生产）/ SQLite（仅本地开发）
- **ORM**：Prisma v5（relationMode = "prisma" SQLite / 默认 PostgreSQL）
- **迁移工具**：Prisma Migrate

## 设计原则

### 三大范式
1. **1NF 字段原子化**：禁止合并多信息到一个字段（如"2025-06本月实际"→ 拆为 period + period_dim_code）
2. **2NF 消除部分依赖**：事实表 value 完全依赖 (公司+科目+期间+期间维度+批次)
3. **3NF 消除传递依赖**：名称类字段放维度表，事实表仅存 code 外键

### 反范式例外
- `transaction_detail.closing_balance`：高频查询字段（= 期初 + 借方 - 贷方）
- 需有明确业务理由 + 评估一致性风险

### 软删除
- 所有带 `status` 字段的表，业务查询**必须过滤 `status = 'active'`**
- 通过 Prisma extension（softDelete.ts）统一注入，禁止遗漏

### 宽表→长表转换（unpivot）
- xlsx 宽表在后端 ImportService 执行 unpivot
- 三张事实表：`fact_operating` / `fact_static` / `fact_budget`

### 批次生命周期
- `import_batch.lifecycle_status`：`draft` → `active` → `archived` → `purged`
- 新批次激活自动归档同 data_type 旧 active 批次
- 查询默认只取 active

## 命名规范

- 数据库列：snake_case（Prisma `@map`）
- 表名：snake_case 单数（Prisma `@@map`）
- 唯一约束/索引命名：Prisma 自动生成

## 详细参考

- 完整表结构、编码规则 → Read `docs/plans/数据模型规范.md`
- Prisma schema → `server/prisma/schema.prisma`
- 种子数据 → `server/prisma/seed.ts`
