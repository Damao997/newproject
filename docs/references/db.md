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

## 数据删除规则

### 分类与删除方式

| 数据类型 | 代表表 | 删除方式 | 理由 |
|----------|--------|----------|------|
| 基础数据 | Company、AccountSubject | 仅软删除（status→inactive） | 被事实表、用户、汇总映射、指标公式引用，物理删除破坏引用完整性与口径可追溯性 |
| 业务配置数据 | Metric、User、Role、Counterparty、SubjectAnalysis | 软删除 + 物理删除（需先停用） | 停用后无引用时可彻底清理，数据可重建 |
| 业务流水数据 | FactOperating、FactStatic、FactBudget、TransactionDetail、InventoryRecord、ImportBatch | 物理删除 | 可重新导入的流水数据，无长期引用关系 |
| 关系配置表 | CompanyAggregationMap | 物理删除 | 纯关系映射，无状态字段，可随时重建 |

### 软删除机制

- Prisma extension（`server/src/middleware/soft-delete.ts`）对 STATUS_MODELS 的读操作自动注入 `status='active'`
- 调用方显式传入 `status` 条件时中间件不干预（如后台查看 inactive）
- API 层通过 `?includeInactive=true` 查询参数显式声明，绕过自动过滤

### 软删除数据的恢复

- 通过 `PUT /data/companies/:id` 或 `PUT /data/subjects/:id` 将 `status` 更新为 `active`
- 前端在已停用列表中提供「重新启用」按钮（↩ 图标）

### 物理删除的安全机制

适用于指标（Metric）和导入批次（ImportBatch）的物理删除：

1. **前置条件**：必须先停用（status=inactive）或归档（lifecycleStatus=archived）
2. **引用保护**：删除前检查是否存在关联数据引用
3. **输入确认**：前端要求用户输入实体编码/文件名才能点击确认按钮（`requireInput` 机制）
4. **审计日志**：所有删除操作写入 audit_log，记录操作人、时间、目标
5. **权限控制**：物理删除需要专用权限码（`data:metric:purge`、`data:import:purge`），仅 superadmin 持有

## 详细参考

- 完整表结构、编码规则 → Read `docs/plans/数据模型规范.md`
- Prisma schema → `server/prisma/schema.prisma`
- 种子数据 → `server/prisma/seed.ts`
