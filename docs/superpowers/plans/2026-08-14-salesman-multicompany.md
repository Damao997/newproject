# 业务员多公司归属 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 业务员从单公司归属改为多公司归属（多对多关联表），后端查询/写入/挂接校验/数据范围守卫同步改造，前端表单多选与列表多值展示。

**Architecture:** 新增 `SalesmanCompany` 关联表（salesmanId + companyCode 复合唯一），Salesman 删除 companyCode 字段（迁移含 INSERT...SELECT 回填）；后端公司过滤改为 `salesmanCompany: { some }`、写入改关联表批量操作、挂接校验改"归属包含"语义、数据范围守卫改"全部归属公司在范围内"；前端表单用 CompanyMultiSelect、列表多值展示。

**Tech Stack:** Node + Express + Prisma + PostgreSQL；React + TypeScript；Vitest；oxlint。

**关键约定**：
- 后端测试真实 DB 模式（dbReady 跳过、独立编码隔离、afterAll 清理）
- 前端验证：`cd web && npm run lint && npm run build`
- PowerShell 用 `;` 分隔
- 工作区有大量无关未提交改动，**每个任务只 git add 指定文件**

---

## 阶段一：数据模型

### Task 1: Prisma SalesmanCompany 表 + 迁移（回填 + 删列）

**Files:**
- Modify: `server/prisma/schema.prisma`

- [ ] **Step 1: 修改 schema.prisma**

1. `model Salesman` 删除 `companyCode` 字段（保留 id/name/phone/remark/status/createdAt）：

```prisma
// 5.3a 业务员表（催收计划归属业务员，按公司隔离；status=inactive 为停用软删除）
model Salesman {
  id          String       @id @default(uuid())
  name        String
  phone       String?
  remark      String?
  status      RecordStatus @default(active)   // active / inactive（停用）
  createdAt   DateTime     @default(now()) @map("created_at")

  @@index([status])
  @@map("salesman")
}
```

2. `model Salesman` 之后插入：

```prisma
// 5.3c 业务员-公司关联表（一个业务员可归属多个公司）
model SalesmanCompany {
  id          String   @id @default(uuid())
  salesmanId  String   @map("salesman_id")
  companyCode String   @map("company_code")
  createdAt   DateTime @default(now()) @map("created_at")

  @@unique([salesmanId, companyCode])
  @@index([companyCode])
  @@map("salesman_company")
}
```

- [ ] **Step 2: 生成迁移并补回填 SQL**

```powershell
cd d:\flies\pj3\server
npx prisma migrate dev --name salesman_multicompany
```

Expected: 迁移生成（CREATE TABLE salesman_company + ALTER TABLE salesman DROP COLUMN company_code）。**关键**：Prisma 默认不会生成回填语句——打开生成的 `migration.sql`，在 CREATE TABLE 之后、DROP COLUMN 之前插入回填：

```sql
-- 回填现有业务员的单公司归属
INSERT INTO "salesman_company" ("id", "salesman_id", "company_code", "created_at")
SELECT gen_random_uuid(), "id", "company_code", "created_at" FROM "salesman"
WHERE "company_code" IS NOT NULL;
```

（若 gen_random_uuid() 不可用（非 pgcrypto），用 `md5(random()::text || clock_timestamp()::text)::uuid` 替代。）

修改后重跑：`npx prisma migrate dev`（会应用修改后的 SQL）。然后：

```powershell
npx prisma generate
npm run typecheck
```

Expected: 迁移应用成功（salesman_company 表含回填数据；salesman 表 company_code 列已删）；typecheck 通过。

- [ ] **Step 3: Commit**

```powershell
git add server/prisma/schema.prisma server/prisma/migrations; git commit -m "feat(prisma): salesman multi-company association with data backfill"
```

---

## 阶段二：后端逻辑（TDD）

### Task 2: CollectionService 多公司改造

**Files:**
- Modify: `server/src/services/CollectionService.ts`
- Modify: `server/src/services/CollectionService.test.ts`

- [ ] **Step 1: 改造现有测试调用（先跑红）**

`server/src/services/CollectionService.test.ts` 中现有 `createSalesman({ companyCode: X, ... })` 调用（约 6 处）全部改为 `{ companyCodes: [X], ... }`。同时挂接校验相关断言保持（跨公司业务员挂接仍应失败）。运行测试确认失败：

```powershell
cd d:\flies\pj3\server
npx vitest run src/services/CollectionService.test.ts
```

Expected: FAIL —— createSalesman 签名变更导致类型/运行时错误。

- [ ] **Step 2: 新增多公司测试用例**

在 describe 内追加：

```ts
  it('业务员多公司归属：创建多公司、按任一公司过滤、编辑公司集合、挂接校验包含语义', async () => {
    if (!dbReady) return
    // 创建归属两公司的业务员
    const multi = await CollectionService.createSalesman({ companyCodes: [TEST_COMPANY, 'EN999902'], name: '跨公司甲', phone: '13700000001' }, ctx)
    expect(multi.companyCodes).toEqual([TEST_COMPANY, 'EN999902'])
    // 按任一公司过滤均命中
    const byA = await CollectionService.listSalesmen({ companyCodes: [TEST_COMPANY] })
    expect(byA.some((s) => s.id === multi.id)).toBe(true)
    const byB = await CollectionService.listSalesmen({ companyCodes: ['EN999902'] })
    expect(byB.some((s) => s.id === multi.id)).toBe(true)
    const manageA = await CollectionService.listSalesmenManage({ companyCodes: [TEST_COMPANY], pageSize: 50 })
    expect(manageA.items.some((s) => s.id === multi.id)).toBe(true)
    // 编辑公司集合：替换为仅 TEST_COMPANY
    const edited = await CollectionService.updateSalesman(multi.id, { companyCodes: [TEST_COMPANY] }, ctx)
    expect(edited.companyCodes).toEqual([TEST_COMPANY])
    const afterEdit = await CollectionService.listSalesmen({ companyCodes: ['EN999902'] })
    expect(afterEdit.some((s) => s.id === multi.id)).toBe(false)
    // 挂接校验：归属含计划公司的业务员可挂接（通过 update 计划挂接验证）
    const plan = await CollectionService.create({ companyCode: TEST_COMPANY, counterpartyCode: TEST_CP, accountCode: TEST_ACCOUNT, overdueAmount: 10, plannedDate: '2099-03-01' }, ctx)
    const linked = await CollectionService.update(plan.id, { salesmanId: multi.id }, ctx)
    expect(linked.salesmanId).toBe(multi.id)
    // 挂接校验：归属不含目标公司的业务员不可挂接（李四归属 EN999902）
    const other = await CollectionService.createSalesman({ companyCodes: ['EN999902'], name: '外部乙' }, ctx)
    await expect(CollectionService.update(plan.id, { salesmanId: other.id }, ctx)).rejects.toThrow('不属于该公司')
    // 清理
    await basePrisma.salesmanCompany.deleteMany({ where: { salesmanId: { in: [multi.id, other.id] } } }).catch(() => undefined)
    await basePrisma.salesman.deleteMany({ where: { id: { in: [multi.id, other.id] } } }).catch(() => undefined)
  })
```

- [ ] **Step 3: 实现 CollectionService 改造**

1. **listSalesmen**：

```ts
  async listSalesmen(params: { companyCodes?: string[] }) {
    const where: Record<string, unknown> = { status: 'active' }
    if (params.companyCodes) where.salesmanCompany = { some: { companyCode: { in: params.companyCodes } } }
    const rows = await prisma.salesman.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { salesmanCompany: true },
    })
    return rows.map((s) => ({ id: s.id, companyCodes: s.salesmanCompany.map((c) => c.companyCode), name: s.name, phone: s.phone, remark: s.remark }))
  },
```

2. **createSalesman**：

```ts
  async createSalesman(input: { companyCodes: string[]; name: string; phone?: string; remark?: string }, ctx: Ctx) {
    const companyCodes = [...new Set(input.companyCodes ?? [])]
    if (companyCodes.length === 0) throw errors.badRequest('请选择所属公司')
    // 数据范围守卫：全部归属公司必须在当前用户数据范围内
    await assertCompaniesInScope(companyCodes, undefined, '新增业务员')
    const name = (input.name || '').trim()
    if (!name) throw errors.badRequest('业务员姓名必填')
    if (name.length > 50) throw errors.badRequest('业务员姓名不能超过 50 字')
    const phone = (input.phone || '').trim()
    if (phone.length > 30) throw errors.badRequest('联系方式不能超过 30 字')
    const salesman = await prisma.salesman.create({
      data: { name, phone: phone || null, remark: input.remark?.trim() || null },
    })
    await prisma.salesmanCompany.createMany({
      data: companyCodes.map((c) => ({ salesmanId: salesman.id, companyCode: c })),
    })
    await recordAudit({ userId: ctx.userId, module: 'transactions', action: 'create', targetId: salesman.id, detail: { action: 'create-salesman', companyCodes } }, ctx.traceId)
    return { id: salesman.id, companyCodes, name: salesman.name, phone: salesman.phone, remark: salesman.remark }
  },
```

3. **listSalesmenManage**：公司过滤同上（`salesmanCompany: { some }`）；返回 `companyCodes` 数组（findMany include salesmanCompany）：

```ts
    const [items, total] = await Promise.all([
      prisma.salesman.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: { salesmanCompany: true },
      }),
      prisma.salesman.count({ where }),
    ])
    return {
      items: items.map((s) => ({
        id: s.id,
        companyCodes: s.salesmanCompany.map((c) => c.companyCode),
        name: s.name,
        phone: s.phone,
        remark: s.remark,
        status: s.status,
        createdAt: s.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
```

4. **updateSalesman**（整体替换；公司集合可编辑，守卫覆盖现有与目标集合）：

```ts
  async updateSalesman(id: string, patch: { name?: string; phone?: string; remark?: string; companyCodes?: string[] }, ctx: Ctx) {
    const salesman = await prisma.salesman.findUnique({ where: { id }, include: { salesmanCompany: true } })
    if (!salesman) throw errors.notFound('业务员不存在')
    // 数据范围守卫：现有归属公司必须在当前用户数据范围内（修改影响该业务员全部关联）
    await assertCompaniesInScope(salesman.salesmanCompany.map((c) => c.companyCode), undefined, '修改业务员')
    const data: Record<string, unknown> = {}
    if (patch.name !== undefined) {
      const name = (patch.name || '').trim()
      if (!name) throw errors.badRequest('业务员姓名必填')
      if (name.length > 50) throw errors.badRequest('业务员姓名不能超过 50 字')
      data.name = name
    }
    if (patch.phone !== undefined) {
      const phone = (patch.phone || '').trim()
      if (phone.length > 30) throw errors.badRequest('联系方式不能超过 30 字')
      data.phone = phone || null
    }
    if (patch.remark !== undefined) data.remark = (patch.remark || '').trim() || null
    if (patch.companyCodes !== undefined) {
      const companyCodes = [...new Set(patch.companyCodes)]
      if (companyCodes.length === 0) throw errors.badRequest('请选择所属公司')
      await assertCompaniesInScope(companyCodes, undefined, '修改业务员')
      data.salesmanCompany = { deleteMany: {}, create: companyCodes.map((c) => ({ companyCode: c })) }
    }
    if (Object.keys(data).length === 0) throw errors.badRequest('无可更新字段')
    const updated = await prisma.salesman.update({
      where: { id },
      data: data as never,
      include: { salesmanCompany: true },
    })
    await recordAudit({ userId: ctx.userId, module: 'transactions', action: 'update', targetId: id, detail: { action: 'update-salesman', fields: Object.keys(data) } }, ctx.traceId)
    return {
      id: updated.id,
      companyCodes: updated.salesmanCompany.map((c) => c.companyCode),
      name: updated.name,
      phone: updated.phone,
      remark: updated.remark,
      status: updated.status,
    }
  },
```

5. **setSalesmanStatus**：守卫改为全部归属公司在范围内（findUnique include salesmanCompany）：

```ts
    const salesman = await prisma.salesman.findUnique({ where: { id }, include: { salesmanCompany: true } })
    if (!salesman) throw errors.notFound('业务员不存在')
    await assertCompaniesInScope(salesman.salesmanCompany.map((c) => c.companyCode), undefined, '停用/启用业务员')
```

6. **update 挂接校验**（约 L460-463，`if (patch.salesmanId !== undefined)` 块内）：

```ts
        const salesmanCompanies = await prisma.salesmanCompany.findMany({
          where: { salesmanId: patch.salesmanId },
          select: { companyCode: true },
        })
        if (salesmanCompanies.length === 0) throw errors.badRequest('业务员不存在')
        if (!salesmanCompanies.some((c) => c.companyCode === plan.companyCode)) throw errors.badRequest('业务员不属于该公司')
```

- [ ] **Step 4: 运行测试确认通过**

```powershell
cd d:\flies\pj3\server
npx vitest run src/services/CollectionService.test.ts
npm run typecheck
```

Expected: PASS（既有用例适配后 + 新增多公司用例）。注意：既有「update 扩展字段」用例（L144-146）中 `createSalesman({ companyCode: 'EN999902', ... })` 改为 `{ companyCodes: ['EN999902'], ... }` 后挂接校验仍应失败（归属不含 TEST_COMPANY）。

- [ ] **Step 5: Commit**

```powershell
git add server/src/services/CollectionService.ts server/src/services/CollectionService.test.ts; git commit -m "feat(collection): salesman multi-company association support"
```

---

### Task 3: CustomerLedgerService 挂接校验 + 路由 POST /salesmen

**Files:**
- Modify: `server/src/services/CustomerLedgerService.ts`
- Modify: `server/src/routes/transactions.ts`
- Modify: `server/src/services/CustomerLedgerService.test.ts`（如涉及挂接断言）

- [ ] **Step 1: CustomerLedgerService 挂接校验**

`upsertCustomerExt` 中（约 L231-233）：

```ts
        const salesman = await prisma.salesman.findUnique({ where: { id: patch.salesmanId } })
        if (!salesman) throw errors.badRequest('业务员不存在')
        if (salesman.companyCode !== companyCode) throw errors.badRequest('业务员不属于该公司')
```

替换为：

```ts
        const salesmanCompanies = await prisma.salesmanCompany.findMany({
          where: { salesmanId: patch.salesmanId },
          select: { companyCode: true },
        })
        if (salesmanCompanies.length === 0) throw errors.badRequest('业务员不存在')
        if (!salesmanCompanies.some((c) => c.companyCode === companyCode)) throw errors.badRequest('业务员不属于该公司')
```

- [ ] **Step 2: 路由 POST /salesmen 多公司归一化**

`server/src/routes/transactions.ts`（约 L268-276）：

```ts
router.post('/salesmen', requirePermission('transactions:salesmen:create', 'create'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const body = req.body ?? {}
  // 多公司归属：body.companyCodes 数组逐个归一化（汇总主体展开成员），去重后交服务层做范围校验
  const raw = Array.isArray(body.companyCodes) ? body.companyCodes : []
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

- [ ] **Step 3: 验证**

```powershell
cd d:\flies\pj3\server
npm run typecheck
npx vitest run src/services/CollectionService.test.ts src/services/CustomerLedgerService.test.ts
```

Expected: typecheck 通过；测试全绿（CollectionService 11 + CustomerLedger 7 = 18）。注意 CustomerLedgerService.test.ts 的 upsert 用例（挂接「张三」）——张三由 beforeAll 创建（companyCodes: [TEST_COMPANY] 适配后），some 匹配 TEST_COMPANY 仍通过。

- [ ] **Step 4: Commit**

```powershell
git add server/src/services/CustomerLedgerService.ts server/src/routes/transactions.ts server/src/services/CustomerLedgerService.test.ts; git commit -m "feat(collection): multi-company attach validation and route normalization"
```

---

## 阶段三：前端

### Task 4: 前端类型与页面改造

**Files:**
- Modify: `web/src/types/index.ts`
- Modify: `web/src/pages/transactions/collections/salesmen.tsx`
- Modify: `web/src/pages/transactions/collections-tab.tsx`（核对）

- [ ] **Step 1: 类型改造**

`web/src/types/index.ts`：`SalesmanItem` / `SalesmanManageItem` / `SalesmanMutationItem` 的 `companyCode: string` 改为 `companyCodes: string[]`（三处）。

- [ ] **Step 2: 业务员管理页（salesmen.tsx）**

1. 导入 `CompanyMultiSelect`（`@/components/filters/company-select` 导出——先确认其 props：value/onChange 数组语义）：

```tsx
import { CompanyMultiSelect } from '@/components/filters/company-select'
```

2. 表单 state 改为数组：

```tsx
  const [companyCodes, setCompanyCodes] = useState<string[]>(target?.companyCodes ?? [])
```

3. 表单公司字段（新增/编辑均多选可编辑）：

```tsx
        <div className="space-y-1.5">
          <Label htmlFor="salesman-form-company">所属公司（可多选）</Label>
          <CompanyMultiSelect value={companyCodes} onChange={setCompanyCodes} id="salesman-form-company" />
        </div>
```

4. 保存校验与提交：

```tsx
    if (!target && companyCodes.length === 0) { setErrorMsg('请选择所属公司'); return }
    ...
      if (target) {
        await updateMutation.mutateAsync({ id: target.id, data: { name: name.trim(), phone: phone.trim() || undefined, remark: remark.trim() || undefined, companyCodes } })
      } else {
        await createMutation.mutateAsync({ companyCodes, name: name.trim(), phone: phone.trim() || undefined, remark: remark.trim() || undefined })
      }
```

5. 列表「所属公司」列多值：

```tsx
    {
      key: 'companyCodes', header: '所属公司',
      render: (row) => (
        <span className="text-xs" title={row.companyCodes.join('、')}>
          {row.companyCodes.map((c) => getDisplayName(c, undefined)).join('、') || '-'}
        </span>
      ),
    },
```

6. 抽屉描述：

```tsx
      description={target ? `${target.name} · ${target.companyCodes.join('、')}` : '录入业务员主数据（所属公司可多选）'}
```

- [ ] **Step 3: 核对催收计划页（collections-tab.tsx）**

`SalesmanDrawer` 使用 `target.companyCode`（LedgerTarget 的字段）与 `useSalesmen(companyCode)`——LedgerTarget 是 Pick<CustomerLedgerItem, ...> 不含 Salesman 类型，不受 SalesmanItem 类型变更影响。**核对**：`useSalesmen`/`useCreateSalesman` 返回类型（SalesmanItem/SalesmanMutationItem 含 companyCodes）在 SalesmanDrawer 中是否使用 companyCode 字段——若使用了 `.companyCode` 需改为 `.companyCodes`。grep 确认后按需调整。

- [ ] **Step 4: 验证**

```powershell
cd d:\flies\pj3\web
npm run lint
npm run build
```

Expected: 无错误。若 `CompanyMultiSelect` 的 props 与实际签名不符（value 类型、onChange、id 透传），以实际签名为准调整并记录。

- [ ] **Step 5: Commit**

```powershell
git add web/src/types/index.ts web/src/pages/transactions/collections/salesmen.tsx; git commit -m "feat(collection): salesman multi-company form and list display"
```

（若 Step 3 需要改 collections-tab.tsx 则一并 add。）

---

## 自审记录

- **Spec 覆盖**：SalesmanCompany 表 + 回填迁移（Task 1）；CollectionService 6 处（list×2/create/update/status/挂接校验）（Task 2）；CustomerLedgerService 挂接 + 路由多公司归一化（Task 3）；前端类型 3 处 + 表单多选 + 列表多值 + 抽屉核对（Task 4）。
- **占位符检查**：所有步骤含具体代码；无 TBD。
- **类型一致性**：`companyCodes: string[]` 贯穿后端 DTO ↔ 前端类型；`SalesmanCompany` 模型字段 salesmanId/companyCode；`CompanyMultiSelect` props 以实际签名为准（已知：project 中 company-select.tsx 导出 CompanyMultiSelect，value: string[]、onChange: (v: string[]) => void）。
- **已知确认点**：迁移回填 SQL 的 uuid 生成（pgcrypto 可用性）；`updateSalesman` 的 `data.salesmanCompany` 嵌套写（Prisma 支持嵌套 deleteMany + create）；CompanyMultiSelect 的 id 透传。实现时如与描述不符，以实际为准并记录。
- **测试注意**：既有「update 扩展字段」用例的跨公司业务员（EN999902 李四）挂接校验语义保持（归属不含 TEST_COMPANY → 仍拒绝）；afterAll 清理需覆盖 salesmanCompany（按 salesmanId 或按公司清理——测试文件 afterAll 已有 `salesman.deleteMany({ where: { companyCode: TEST_COMPANY } })`，需改为先删 salesmanCompany 再删 salesman，或按 id 清理新增数据）。
