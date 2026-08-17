# 业务员多公司归属 — 设计文档

> **版本**: 1.0
> **日期**: 2026-08-14
> **状态**: 用户需求「所属公司可以是多个」；模型层破坏性变更
> **范围**: Salesman 多对多公司归属（新关联表 + 后端 7 处逻辑 + 前端 3 处 + 测试改造）

---

## 1. 背景与目标

当前 `Salesman.companyCode`（单值 String）限定业务员归属单一公司。需求：一个业务员可属于多个公司。影响：数据模型、业务员管理页（表单多选/列表多值）、催收计划页业务员选项与挂接校验、数据范围守卫。

---

## 2. 数据模型（多对多关联表）

### 2.1 新表 `SalesmanCompany`

`server/prisma/schema.prisma`（Salesman 模型之后）：

```prisma
// 5.3c 业务员-公司关联表（一个业务员可归属多个公司）
model SalesmanCompany {
  id             String   @id @default(uuid())
  salesmanId     String   @map("salesman_id")
  companyCode    String   @map("company_code")
  createdAt      DateTime @default(now()) @map("created_at")

  @@unique([salesmanId, companyCode])
  @@index([companyCode])
  @@map("salesman_company")
}
```

### 2.2 Salesman 模型变更

移除 `companyCode` 字段（保留 id/name/phone/remark/status/createdAt）。迁移策略（单次 migration 内完成）：

1. `CREATE TABLE salesman_company`（如上）
2. 回填：`INSERT INTO salesman_company (salesman_id, company_code) SELECT id, company_code FROM salesman`
3. `ALTER TABLE salesman DROP COLUMN company_code`

迁移 SQL 需手写回填语句（Prisma migrate dev 生成的默认 SQL 无回填，需在 migration.sql 中补充 INSERT...SELECT）。

---

## 3. 后端逻辑（CollectionService + CustomerLedgerService）

### 3.1 查询过滤（读侧）

`listSalesmen` / `listSalesmenManage` 的公司过滤从 `where.companyCode = { in }` 改为**任一归属公司命中**：

```ts
// listSalesmen（仅 active 选项）
const where: Record<string, unknown> = { status: 'active' }
if (params.companyCodes) {
  where.salesmanCompany = { some: { companyCode: { in: params.companyCodes } } }
}
```

`listSalesmenManage` 同样处理；返回结构 `companyCode` 改为 `companyCodes: string[]`（联查关联表聚合）。

### 3.2 写路径

**createSalesman**（input 改 `companyCodes: string[]`）：

```ts
async createSalesman(input: { companyCodes: string[]; name: string; phone?: string; remark?: string }, ctx: Ctx) {
  if (!input.companyCodes || input.companyCodes.length === 0) throw errors.badRequest('请选择所属公司')
  // 去重 + 校验每个公司在数据范围内（写侧守卫）
  const companyCodes = [...new Set(input.companyCodes)]
  await assertCompaniesInScope(companyCodes, undefined, '新增业务员')
  const name = (input.name || '').trim()
  if (!name) throw errors.badRequest('业务员姓名必填')
  if (name.length > 50) throw errors.badRequest('业务员姓名不能超过 50 字')
  const phone = (input.phone || '').trim()
  if (phone.length > 30) throw errors.badRequest('联系方式不能超过 30 字')
  const salesman = await prisma.salesman.create({ data: { name, phone: phone || null, remark: input.remark?.trim() || null } })
  await prisma.salesmanCompany.createMany({
    data: companyCodes.map((c) => ({ salesmanId: salesman.id, companyCode: c })),
  })
  await recordAudit({ ... detail: { action: 'create-salesman', companyCodes } }, ctx.traceId)
  return { id: salesman.id, companyCodes, name: salesman.name, phone: salesman.phone, remark: salesman.remark }
}
```

**updateSalesman**（支持公司集合编辑；原「公司不可修改」决策随多公司需求解除）：

```ts
async updateSalesman(id: string, patch: { name?: string; phone?: string; remark?: string; companyCodes?: string[] }, ctx: Ctx) {
  const salesman = await prisma.salesman.findUnique({ where: { id }, include: { salesmanCompany: true } })
  if (!salesman) throw errors.notFound('业务员不存在')
  // 数据范围守卫：现有归属与目标归属的全部公司都必须在范围内（修改影响该业务员全部关联）
  await assertCompaniesInScope(salesman.salesmanCompany.map((c) => c.companyCode), undefined, '修改业务员')
  const data: Record<string, unknown> = {}
  // ...name/phone/remark 校验同现状...
  if (patch.companyCodes !== undefined) {
    const companyCodes = [...new Set(patch.companyCodes)]
    if (companyCodes.length === 0) throw errors.badRequest('请选择所属公司')
    await assertCompaniesInScope(companyCodes, undefined, '修改业务员')
    data.salesmanCompany = { deleteMany: {}, create: companyCodes.map((c) => ({ companyCode: c })) }
  }
  if (Object.keys(data).length === 0) throw errors.badRequest('无可更新字段')
  const updated = await prisma.salesman.update({ where: { id }, data: data as never, include: { salesmanCompany: true } })
  await recordAudit(...)
  return { id: updated.id, companyCodes: updated.salesmanCompany.map((c) => c.companyCode), name: updated.name, phone: updated.phone, remark: updated.remark, status: updated.status }
}
```

**setSalesmanStatus**：守卫改为全部归属公司在范围内：

```ts
const salesman = await prisma.salesman.findUnique({ where: { id }, include: { salesmanCompany: true } })
if (!salesman) throw errors.notFound('业务员不存在')
await assertCompaniesInScope(salesman.salesmanCompany.map((c) => c.companyCode), undefined, '停用/启用业务员')
```

### 3.3 挂接校验（业务员属于计划/扩展公司）

两处 `salesman.companyCode !== X` 单值校验改为**归属包含**：

- `CollectionService.update`（L460-463，PATCH /collections/:id 的 salesmanId 校验）：
  ```ts
  const salesmanCompanies = await prisma.salesmanCompany.findMany({ where: { salesmanId: patch.salesmanId }, select: { companyCode: true } })
  if (salesmanCompanies.length === 0) throw errors.badRequest('业务员不存在')
  if (!salesmanCompanies.some((c) => c.companyCode === plan.companyCode)) throw errors.badRequest('业务员不属于该公司')
  ```
- `CustomerLedgerService.upsertCustomerExt`（L231-233）同理（some 匹配 companyCode）

### 3.4 路由

`POST /salesmen`（L272-274）：body 从单值 `companyCode` 改为数组 `companyCodes`：

```ts
router.post('/salesmen', requirePermission('transactions:salesmen:create', 'create'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const body = req.body ?? {}
  const raw = Array.isArray(body.companyCodes) ? body.companyCodes : []
  // 每个公司归一化（汇总主体展开成员）；全量归一化后交服务层做范围校验
  const normalized: string[] = []
  for (const c of raw) {
    const codes = await normalizeCompanies(authUser, c)
    if (codes) normalized.push(...codes)
  }
  const data = await CollectionService.createSalesman(
    { companyCodes: [...new Set(normalized)], name: body.name, phone: body.phone, remark: body.remark },
    { userId: authUser.userId, traceId: req.traceId },
  )
  sendOk(res, data)
}))
```

（归一化后交服务层 `assertCompaniesInScope` 做最终守卫——越权公司归一化降级为空即被「请选择所属公司」拒绝。）

---

## 4. 前端改动

### 4.1 类型（types/index.ts）

`SalesmanItem` / `SalesmanManageItem` / `SalesmanMutationItem` 的 `companyCode: string` → `companyCodes: string[]`。

### 4.2 业务员管理页（salesmen.tsx）

1. **表单**：`CompanySelect`（单选）→ `CompanyMultiSelect`（`@/components/filters/company-select` 导出），state `companyCodes: string[]`，必选校验 `companyCodes.length === 0`；编辑态公司从只读 Input 改为**可多选编辑**（多公司需求下公司集合可维护）
2. **列表"所属公司"列**：`companyCodes.map((c) => getDisplayName(c, undefined)).join('、')`（title 显示完整编码）
3. **抽屉描述**：编辑态显示 `companyCodes.join('、')`

### 4.3 催收计划页（collections-tab.tsx）

`SalesmanDrawer` 的 `useSalesmen(companyCode)` 与保存逻辑**不变**（选项接口语义变为"属于该公司即返回"，后端已处理；LedgerTarget 不含 companyCodes 字段，不受类型变更影响——核对后确认）。

### 4.4 CustomerLedgerService 响应

`CustomerLedgerItem.salesmanName` 联查不变（salesmanId → salesman 名称，无公司字段依赖）。

---

## 5. 测试改造与新增

`server/src/services/CollectionService.test.ts`：
- 现有 `createSalesman({ companyCode: X, ... })` 调用全部改为 `{ companyCodes: [X], ... }`（约 6 处）
- 挂接校验用例（L144-146）：跨公司业务员挂接语义保持（`some` 匹配）
- 新增用例「多公司归属」：
  - 创建归属 [TEST_COMPANY, 'EN999902'] 的业务员 → 按任一公司过滤均命中
  - 编辑 companyCodes 替换 → 旧关联清除、新关联生效
  - 挂接校验：归属含计划公司时可挂接
  - 数据范围守卫：全部公司不在范围时（无 scope 上下文测试跳过守卫，仅验证服务层逻辑）

`CustomerLedgerService.test.ts`：upsert 挂接用例适配（`some` 语义）。

---

## 6. 涉及文件清单

**后端**：
- `server/prisma/schema.prisma` + migration（SalesmanCompany 表 + 回填 + 删列）
- `server/src/services/CollectionService.ts`（listSalesmen/listSalesmenManage/createSalesman/updateSalesman/setSalesmanStatus/update 挂接校验）
- `server/src/services/CustomerLedgerService.ts`（upsert 挂接校验）
- `server/src/routes/transactions.ts`（POST /salesmen 多公司归一化）
- `server/src/services/CollectionService.test.ts` / `CustomerLedgerService.test.ts`（适配 + 新增）

**前端**：
- `web/src/types/index.ts`（3 个类型 companyCodes）
- `web/src/pages/transactions/collections/salesmen.tsx`（表单多选 + 列表多值）
- `web/src/pages/transactions/collections-tab.tsx`（核对 SalesmanDrawer 不受影响）

---

## 7. 范围外

- 不引入"主公司/默认公司"概念（YAGNI）
- 不改动 Salesman.status 软删除与权限体系
- 不动 CustomerExt/CollectionPlan 的 salesmanId 引用结构（挂接校验语义更新即可）
- 前端不新增多公司筛选器（管理页公司筛选仍为单值下拉，任一归属命中即显示）
