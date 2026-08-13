# 催收计划页扩展为应收款客商台账 — 设计文档

> **版本**: 1.0
> **日期**: 2026-08-13
> **状态**: 已与用户逐节确认（方案 A：新表 + 聚合接口）
> **范围**: 催收计划页（collections/plans）数据语义重构 + 后端扩展

---

## 1. 背景与目标

当前催收计划页仅展示**已创建催收计划的逾期应收款**（数据源 `collection_plan` 表）。需求：页面扩展为**完整应收款客商台账**——默认展示所有应收账款客商（余额>0），未创建计划的客商同样可见，可补录业务员/已开票未收款（独立存储、不建计划）。

**用户已确认的决策**：
- 状态以**计划状态为主**：未创建计划显示「未计划」；已创建显示计划状态（待催收/催收中/部分回收/全额回收/坏账）
- **独立存储不建计划**：未计划行可编辑业务员/已开票未收款，存储于新增客商扩展表
- 行粒度：**公司 × 客商**，仅展示**应收账款**类型
- 不显示零余额客商（`closingBalance > 0` 过滤）
- **删除逾期金额列**（表格不展示；接口字段保留）
- **移除「生成催收建议」按钮**与 `GenerateDialog`（后端接口保留）
- 与应收账款计划关联时**仅限应收账款科目**（其他往来类型的计划不显示）

---

## 2. 后端设计

### 2.1 数据模型：新增 `CustomerExt` 客商扩展表

`server/prisma/schema.prisma`（注释编号 5.3b，位于 CollectionPlan 之后）：

```prisma
// 5.3b 客商扩展表（应收款台账：未创建催收计划时仍可补录业务员/已开票未收款）
model CustomerExt {
  id                      String   @id @default(uuid())
  companyCode             String   @map("company_code")
  counterpartyCode        String   @map("counterparty_code")
  billedUncollectedAmount Decimal? @map("billed_uncollected_amount") @db.Decimal(18, 2)
  salesmanId              String?  @map("salesman_id")
  createdAt               DateTime @default(now()) @map("created_at")
  updatedAt               DateTime @updatedAt @map("updated_at")

  @@unique([companyCode, counterpartyCode])
  @@index([companyCode])
  @@map("customer_ext")
}
```

迁移：`npx prisma migrate dev --name customer_ext` + `prisma generate`。

**存储职责划分**：
- `customer_ext`：业务员（salesmanId）、已开票未收款金额——**客商维度字段统一存于此**（未计划与已计划客商行为一致，单一来源无优先级歧义）
- `collection_plan`：计划专属字段（overdueAmount/plannedDate/method/status/actualAmount/statusNote/remark）——不动
- 后端 `PATCH /collections/:id` 的 `billedUncollectedAmount/salesmanId` 参数**保留兼容**（既有测试与 API 契约不破坏），前端编辑入口改调新接口后不再使用

### 2.2 聚合查询：`GET /transactions/collections/customers`

**参数**：`companyCode`（`normalizeCompanies` 归一化 + scopeContext 数据范围）· `status`（`unplanned` 或 5 个计划状态之一，空=全部）· `counterpartyKeyword`（code/name 模糊）· `page` · `pageSize`

**聚合逻辑**（**决策：新增独立服务 `CustomerLedgerService.ts`**，职责：台账聚合 + 扩展表 upsert；科目集合查询与名称联查在服务内自包含实现，不依赖 CollectionService）：

1. 应收账款科目编码集合（JOIN 计划时限定用）：
   `prisma.transactionAccount.findMany({ where: { transactionType: '应收账款' }, select: { code } })`（含 inactive？——**剔除 inactive**：`status: 'active'` 的应收账款科目；inactive 科目数据本身已在聚合时剔除）
2. `transaction_detail` 聚合：
   - 过滤：`transactionType='应收账款'`、`direction='AR'`、`isInternal=false`、`isEliminated=false`、`closingBalance > 0`、`accountCode notIn inactiveCodes`、`companyCode in 数据范围`
   - groupBy `companyCode + counterpartyCode`：`_sum.closingBalance` + 10 个 aging 字段（归并为 8 段展示口径）
3. 计划关联：查 `collection_plan` where `companyCode in 范围 AND accountCode in 应收账款科目集`，取每 (companyCode, counterpartyCode) 组 **createdAt desc 首条**作为最新计划（内存分组取首，数据量可控）
4. 扩展表关联：`customer_ext` where `companyCode in 范围`（联查 Salesman 名称）
5. 组装行 + 分页 + 统计

**行字段**（DTO `CustomerLedgerItem`）：

```ts
{
  companyCode: string
  counterpartyCode: string
  counterpartyName: string | null
  closingBalance: number            // 应收余额合计（元）
  overdueAmount: number             // 逾期合计（半年以上起 4 段，接口保留供排序/扩展，页面不展示）
  aging: Record<string, number>     // 8 段账龄合计
  billedUncollectedAmount: number | null   // customer_ext
  salesmanId: string | null
  salesmanName: string | null
  planId: string | null             // 最新计划
  planStatus: string | null         // null = 未计划
  plannedDate: string | null
  method: string | null
  actualAmount: number | null
  statusNote: string | null
}
```

**status 过滤**：`unplanned` → `planStatus IS NULL`；计划状态 → `planStatus = X`
**stats**：`byStatus: { unplanned, pending, collecting, partial, full, bad_debt }`（与列表同过滤条件，不含 status）+ `totalBalance`（应收余额合计，元）

**多计划规则**：一客商多科目计划时，取**最新创建计划**（createdAt desc 首条）的状态/字段展示。

### 2.3 编辑接口：`PATCH /transactions/collections/customers/:companyCode/:counterpartyCode`

- 请求体：`{ billedUncollectedAmount?: number; salesmanId?: string | null }`（upsert：存在则更新，不存在则创建）
- 校验：`billedUncollectedAmount` ≥ 0（toFixed(2)）；`salesmanId` 存在且 `companyCode` 匹配（复用 CollectionService.update 同款校验逻辑）；`companyCode`/`counterpartyCode` 路径参数必填且归一化后存在
- 权限：`transactions:update`
- 审计：`recordAudit({ action: 'update-customer-ext' })`

### 2.4 路由注册（`server/src/routes/transactions.ts`，催收段落）

```ts
router.get('/collections/customers', requirePermission('transactions:view', 'view'), ...)    // 台账列表
router.patch('/collections/customers/:companyCode/:counterpartyCode', requirePermission('transactions:update', 'update'), ...)  // upsert 扩展
```

注意 Express 路由顺序：`/collections/customers` 必须注册在 `PATCH /collections/:id` **之前**（否则 `:id` 会吞掉 `customers`），`GET /collections/customers` 与 `GET /collections/:id/logs` 不冲突（`customers` 非 `:id/logs` 形态）。**验证：GET/PATCH 均注册于现有 `/collections` 段前部。**

### 2.5 移除前端入口（后端接口保留）

- `POST /collections/generate` 接口与 `CollectionService.generateSuggestions` **保留**（不删除，避免破坏既有测试与潜在其他调用方）
- 前端移除按钮与对话框（见 §3.4）

---

## 3. 前端设计

### 3.1 表格列（行粒度：公司 × 客商，科目合并）

| 列 | 内容 | 交互 |
|----|------|------|
| 公司 | `getDisplayName`（现有） | — |
| 客商 | 名称 + 编码双行（现有） | — |
| **应收金额** | `closingBalance` 合计，`font-num` 右对齐，分级着色（≥100万 `text-destructive font-semibold` / ≥10万 `text-warning-strong font-medium`） | 只读 |
| **已开票未收款** | `billedUncollectedAmount`（null 显示「-」） | hover「编辑」→ BilledAmountDrawer（改调新接口） |
| **业务员** | `salesmanName`（null 显示「-」） | hover「编辑」→ SalesmanDrawer（改调新接口） |
| 计划日期 | 最新计划 `plannedDate`；逾期（`< 今天` 且 `planStatus` 非 full/bad_debt）标红 + 「已逾期」 | 只读 |
| 方式 | 最新计划 method（`METHOD_LABELS`） | 只读 |
| 实际回收 | 最新计划 `actualAmount` | 只读 |
| 状态 | `unplanned` → 胶囊 `bg-muted text-muted-foreground`「未计划」；有计划 → 现有 `STATUS_STYLES` 胶囊 + `title=statusNote` | — |
| 操作 | hover 文字按钮 | 有计划：`编辑` + `更新` + `记录`；未计划：仅 `编辑` |

- **逾期金额列不渲染**；**科目列移除**（公司×客商粒度）
- 催收记录对话框按 `planId`（最新计划）——仅计划行可用

### 3.2 状态统计条与筛选

- 统计条：**未计划**（灰点 `bg-muted-foreground`）+ 待催收 + 催收中 + 部分回收 + 全额回收 + 坏账（现有语义色）+ 右侧**应收金额合计**（万，`formatMoneyWan(totalBalance / 10000)` + 「万」小号后缀）
- 点击状态项 → 设置 `statusFilter` 并 `setPage(1)`（`unplanned` 同样可点选）
- 状态筛选下拉：`全部客商`（默认）/ `未计划` / 5 个计划状态
- 公司筛选（CompanySelect）、客商搜索、分页保留

### 3.3 编辑抽屉改造

- `BilledAmountDrawer` / `SalesmanDrawer` 目标类型从 `CollectionPlanItem` 改为客商键 `{ companyCode: string; counterpartyCode: string }`
- 保存调用 `PATCH /collections/customers/:companyCode/:counterpartyCode`（`useUpdateCustomerExt` 新 hook）
- `SalesmanDrawer`「选择现有业务员」仍用 `useSalesmen(companyCode)`
- 抽屉初始值：`billedUncollectedAmount ?? ''`、`salesmanId ?? ''`（来自行数据）
- 无 `transactions:update` 权限时：hover 按钮不渲染（现状）

### 3.4 移除项

- 「生成催收建议」按钮、`GenerateDialog` 组件、`useGenerateCollections` 调用（hook 定义保留或删除——**决策：连同 `api.generateCollections` 一并从前端删除**，接口已无消费方；后端保留）
- `STATUS_LABELS` 增加 `unplanned: '未计划'` 映射（仅用于统计条/筛选）

### 3.5 数据层与类型

- `web/src/types/index.ts`：新增 `CustomerLedgerItem`、`CustomerLedgerResponse`（`PaginatedResponse<CustomerLedgerItem> & { stats: { byStatus: Record<'unplanned' | CollectionStatus, number>; totalBalance: number } }`）
- `web/src/lib/api.ts`：`getCustomerLedger(params)`、`updateCustomerExt(companyCode, counterpartyCode, data)`；删除 `generateCollections`
- `web/src/hooks/api-queries.ts`：`useCustomerLedger(params)`、`useUpdateCustomerExt()`（onSuccess invalidate `['transactions','collections','customers']`）；删除 `useGenerateCollections`
- `collections-tab.tsx`：数据层改 `useCustomerLedger`；`stats` 来源改新响应

### 3.6 权限与回归

- 权限：查看 `transactions:view`、编辑 `transactions:update`——与现状一致；数据范围经 `normalizeCompanies` + scopeContext 不变
- 回归面：账龄分析/总览/科目过滤不受影响；`GET /collections`、`POST /collections`、催收记录接口保留（催收记录对话框仍按 planId）；`PATCH /collections/:id` 的 billedUncollectedAmount/salesmanId 兼容保留
- 导航：`/transactions/collections/plans`「催收计划」不动

---

## 4. 测试要点

**后端**（真实 DB 模式，独立测试编码）：
- 聚合：只含应收账款类型（其他应收款的明细不计入）；余额>0 过滤；inactive 科目剔除；公司×客商合并正确
- 计划关联：该客商最新计划（createdAt desc 首条）状态/字段；其他科目类型（其他应收款）的计划不关联
- 状态过滤：`unplanned` 只回无计划行；计划状态只回匹配行
- stats：unplanned 计数 + 5 状态计数 + 应收余额合计；不含 status 过滤条件
- upsert：首次创建、二次更新、金额负数/业务员跨公司校验、权限与审计
- 回归：既有 CollectionService 测试全部通过（generate/update 兼容保留）

**前端**：lint + build；手动验证（列结构、统计条、未计划行编辑、无权限时按钮隐藏）

---

## 5. 涉及文件清单

**后端**：
- `server/prisma/schema.prisma` + migration（CustomerExt 表）
- `server/src/services/CustomerLedgerService.ts`（新建：台账聚合 + 扩展表 upsert；复用 `getInactiveAccountCodes` 模式、scopeContext 数据范围；名称联查自包含）
- `server/src/routes/transactions.ts`（2 条新路由）
- `server/src/services/CollectionService.ts`（不动，兼容保留）

**前端**：
- `web/src/types/index.ts`
- `web/src/lib/api.ts`
- `web/src/hooks/api-queries.ts`
- `web/src/pages/transactions/collections-tab.tsx`（列/统计条/抽屉/移除项）

---

## 6. 范围外

- 不改造其他往来类型（其他应收款等）的台账展示
- 不删除后端 generate 接口与 CollectionService 测试
- 不引入"未计划行创建计划"入口（用户已确认不建计划）
- 不展示零余额客商
