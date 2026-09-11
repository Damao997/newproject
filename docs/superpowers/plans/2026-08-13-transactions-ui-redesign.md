# 往来分析模块 UI 优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按设计文档 `docs/superpowers/specs/2026-08-13-transactions-ui-redesign-design.md` 优化往来分析模块 5 处页面/组件 UI/UX，并扩展催收计划后端（业务员表、已开票未收款金额、状态说明、统计与选项接口）。

**Architecture:** 前端遵循项目 Radix + Shadcn + Tailwind + Design Token 体系（`frontend-design-proposal.md` v3.6）；后端沿用现有 `TransactionService`/`CollectionService` 分层 + `routes/transactions.ts` 权限门 + 审计记录模式。总览卡片与账龄堆叠条抽为 `shared.tsx` 共享组件（overview 与分析抽屉复用）。催收计划页新增两个 SheetShell 抽屉（已开票金额、业务员）。

**Tech Stack:** React 18 + TypeScript + Vite + Tailwind + React Query + Zustand；Node + Express + Prisma + PostgreSQL；Vitest（前后端）；oxlint。

**关键约定（贯穿全程）**：
- 后端测试用真实 DB 模式（`beforeAll` 探测 `SELECT 1`，失败置 `dbReady=false` 整组跳过；独立测试编码隔离，`afterAll` 清理）——参考 `server/src/services/CollectionService.test.ts`
- 前端验证：`cd web && npm run lint && npm run build`（构建含 `tsc -b` 类型检查）
- 提交信息用 conventional commits（`feat:`/`fix:`）；husky pre-commit 会自动跑 lint-staged，提交前须保证 lint 通过
- PowerShell 环境，命令用 `;` 分隔，不用 `&&`
- 禁止 hex 色值与 Tailwind 调色板类（`bg-blue-500` 等）；数字一律 `font-num`；表头居中

---

## 阶段一：后端扩展（TDD）

### Task 1: Prisma 模型扩展（业务员表 + 催收计划新字段）

**Files:**
- Modify: `server/prisma/schema.prisma`
- 产物：`server/prisma/migrations/<timestamp>_collection_plan_salesman_extend/`

- [ ] **Step 1: 修改 schema.prisma 新增业务员模型**

在 `model CollectionPlan`（约 554 行）之前插入：

```prisma
// 5.6 业务员表（催收计划归属业务员，按公司隔离）
model Salesman {
  id          String   @id @default(uuid())
  companyCode String   @map("company_code")
  name        String
  phone       String?  @map("phone")
  remark      String?
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([companyCode])
  @@map("salesman")
}
```

- [ ] **Step 2: 修改 CollectionPlan 模型增加三个字段**

在 `model CollectionPlan` 的 `remark String?` 与 `createdAt DateTime @default(now()) @map("created_at")` 之间插入：

```prisma
  billedUncollectedAmount Decimal?  @map("billed_uncollected_amount") @db.Decimal(18, 2)
  salesmanId              String?   @map("salesman_id")
  statusNote              String?   @map("status_note")
```

- [ ] **Step 3: 生成迁移并验证**

```powershell
cd server
npx prisma migrate dev --name collection_plan_salesman_extend
npx prisma generate
npm run typecheck
```

Expected: 迁移成功（创建 `salesman` 表 + `collection_plan` 新增 3 列）；typecheck 无输出（通过）。

- [ ] **Step 4: Commit**

```powershell
git add server/prisma/schema.prisma server/prisma/migrations; git commit -m "feat(prisma): add salesman model and collection plan extension fields"
```

---

### Task 2: CollectionService DTO 与 update 扩展（TDD）

**Files:**
- Modify: `server/src/services/CollectionService.ts`
- Test: `server/src/services/CollectionService.test.ts`

- [ ] **Step 1: 写失败测试（新字段校验与写入）**

在 `server/src/services/CollectionService.test.ts` 的 `describe('CollectionService（真实 DB）', () => {` 内追加两个用例（放在「手工创建计划」用例之后）：

```ts
  it('update 扩展字段：已开票未收款金额/状态说明/业务员（含校验）', async () => {
    if (!dbReady) return
    const page = await CollectionService.list({ companyCodes: [TEST_COMPANY] })
    const planId = page.items[0].id

    // 负数非法
    await expect(CollectionService.update(planId, { billedUncollectedAmount: -1 }, ctx)).rejects.toThrow('已开票未收款金额')
    // 状态说明超长非法
    await expect(CollectionService.update(planId, { statusNote: 'x'.repeat(501) }, ctx)).rejects.toThrow('500')
    // 业务员不存在非法
    await expect(CollectionService.update(planId, { salesmanId: '00000000-0000-0000-0000-000000000000' }, ctx)).rejects.toThrow('业务员不存在')

    // 合法写入
    const s1 = await CollectionService.update(planId, { billedUncollectedAmount: 300.5, statusNote: '客户承诺月底回款 300' }, ctx)
    expect(s1.billedUncollectedAmount).toBe(300.5)
    expect(s1.statusNote).toBe('客户承诺月底回款 300')

    // 业务员：先创建再挂接；其他公司业务员不可挂接
    const sm = await CollectionService.createSalesman({ companyCode: TEST_COMPANY, name: '张三', phone: '13800000000' }, ctx)
    const other = await CollectionService.createSalesman({ companyCode: 'EN999902', name: '李四' }, ctx)
    await expect(CollectionService.update(planId, { salesmanId: other.id }, ctx)).rejects.toThrow('不属于该公司')
    const s2 = await CollectionService.update(planId, { salesmanId: sm.id }, ctx)
    expect(s2.salesmanId).toBe(sm.id)
    expect(s2.salesmanName).toBe('张三')

    // 清空业务员
    const s3 = await CollectionService.update(planId, { salesmanId: null }, ctx)
    expect(s3.salesmanId).toBeNull()
  })

  it('list 返回状态统计 stats（按状态计数 + 逾期金额合计）', async () => {
    if (!dbReady) return
    const page = await CollectionService.list({ companyCodes: [TEST_COMPANY] })
    expect(page.stats).toBeDefined()
    expect(typeof page.stats.byStatus.pending).toBe('number')
    expect(page.stats.byStatus.pending).toBeGreaterThanOrEqual(1)
    expect(page.stats.totalOverdue).toBeGreaterThan(0)
  })
```

- [ ] **Step 2: 运行测试确认失败**

```powershell
cd server
npx vitest run src/services/CollectionService.test.ts
```

Expected: FAIL —— `createSalesman` 不存在、`billedUncollectedAmount`/`statusNote`/`salesmanId`/`salesmanName`/`stats` 类型或字段缺失。

- [ ] **Step 3: 扩展 CollectionPlanDto 与 toPlanDto**

`server/src/services/CollectionService.ts`：

- `CollectionPlanDto` 接口在 `remark: string | null` 后追加：

```ts
  billedUncollectedAmount: number | null
  salesmanId: string | null
  salesmanName: string | null
  statusNote: string | null
```

- `buildNameMaps` 签名与实现改为（整体替换函数）：

```ts
async function buildNameMaps(plans: Array<{ companyCode: string; counterpartyCode: string; salesmanId?: string | null }>) {
  const companyCodes = [...new Set(plans.map((p) => p.companyCode))]
  const counterpartyCodes = [...new Set(plans.map((p) => p.counterpartyCode))]
  const salesmanIds = [...new Set(plans.map((p) => p.salesmanId).filter((x): x is string => !!x))]
  const [companies, counterparties, salesmen] = await Promise.all([
    companyCodes.length ? prisma.company.findMany({ where: { code: { in: companyCodes } }, select: { code: true, name: true } }) : [],
    counterpartyCodes.length ? prisma.counterparty.findMany({ where: { code: { in: counterpartyCodes } }, select: { code: true, name: true } }) : [],
    salesmanIds.length ? prisma.salesman.findMany({ where: { id: { in: salesmanIds } }, select: { id: true, name: true } }) : [],
  ])
  return {
    companyName: new Map(companies.map((c) => [c.code, c.name])),
    counterpartyName: new Map(counterparties.map((c) => [c.code, c.name])),
    salesmanName: new Map(salesmen.map((s) => [s.id, s.name])),
  }
}
```

- `toPlanDto` 签名与返回改为（整体替换函数）：

```ts
function toPlanDto(
  p: Record<string, unknown>,
  names: { companyName: Map<string, string>; counterpartyName: Map<string, string>; salesmanName: Map<string, string> },
): CollectionPlanDto {
  return {
    id: p.id as string,
    companyCode: p.companyCode as string,
    companyName: names.companyName.get(p.companyCode as string) ?? null,
    counterpartyCode: p.counterpartyCode as string,
    counterpartyName: names.counterpartyName.get(p.counterpartyCode as string) ?? null,
    accountCode: p.accountCode as string,
    overdueAmount: toNumber(p.overdueAmount),
    plannedDate: (p.plannedDate as Date).toISOString().slice(0, 10),
    collectorId: p.collectorId as string | null,
    method: p.method as string,
    expectedAmount: p.expectedAmount === null || p.expectedAmount === undefined ? null : toNumber(p.expectedAmount),
    actualAmount: p.actualAmount === null || p.actualAmount === undefined ? null : toNumber(p.actualAmount),
    status: p.status as string,
    remark: p.remark as string | null,
    billedUncollectedAmount: p.billedUncollectedAmount === null || p.billedUncollectedAmount === undefined ? null : toNumber(p.billedUncollectedAmount),
    salesmanId: p.salesmanId as string | null,
    salesmanName: p.salesmanId ? (names.salesmanName.get(p.salesmanId as string) ?? null) : null,
    statusNote: p.statusNote as string | null,
    createdAt: (p.createdAt as Date).toISOString(),
  }
}
```

- [ ] **Step 4: 扩展 update 方法**

`CollectionService.update` 的 `patch` 类型改为：

```ts
async update(id: string, patch: { status?: string; actualAmount?: number; expectedAmount?: number; plannedDate?: string; method?: string; collectorId?: string; remark?: string; billedUncollectedAmount?: number; salesmanId?: string | null; statusNote?: string }, ctx: Ctx) {
```

在 `if (patch.remark !== undefined) data.remark = patch.remark || null` 之后插入：

```ts
    if (patch.billedUncollectedAmount !== undefined) {
      const v = Number(patch.billedUncollectedAmount)
      if (!Number.isFinite(v) || v < 0) throw errors.badRequest('已开票未收款金额不合法')
      data.billedUncollectedAmount = Number(v.toFixed(2))
    }
    if (patch.salesmanId !== undefined) {
      if (patch.salesmanId === null || patch.salesmanId === '') {
        data.salesmanId = null
      } else {
        const salesman = await prisma.salesman.findUnique({ where: { id: patch.salesmanId } })
        if (!salesman) throw errors.badRequest('业务员不存在')
        if (salesman.companyCode !== plan.companyCode) throw errors.badRequest('业务员不属于该公司')
        data.salesmanId = salesman.id
      }
    }
    if (patch.statusNote !== undefined) {
      const note = (patch.statusNote || '').trim()
      if (note.length > 500) throw errors.badRequest('催收状态说明不能超过 500 字')
      data.statusNote = note || null
    }
```

- [ ] **Step 5: 新增 listSalesmen / createSalesman 方法（供 update 测试使用，完整实现在 Task 4 复用）**

在 `CollectionService` 对象内 `create` 方法之前插入：

```ts
  /**
   * 业务员列表（按公司过滤）
   */
  async listSalesmen(params: { companyCodes?: string[] }) {
    const where: Record<string, unknown> = {}
    if (params.companyCodes) where.companyCode = { in: params.companyCodes }
    const rows = await prisma.salesman.findMany({ where, orderBy: { createdAt: 'desc' } })
    return rows.map((s) => ({ id: s.id, companyCode: s.companyCode, name: s.name, phone: s.phone, remark: s.remark }))
  },

  /**
   * 新建业务员（姓名必填，联系方式选填）
   */
  async createSalesman(input: { companyCode: string; name: string; phone?: string; remark?: string }, ctx: Ctx) {
    if (!input.companyCode) throw errors.badRequest('公司必填')
    const name = (input.name || '').trim()
    if (!name) throw errors.badRequest('业务员姓名必填')
    if (name.length > 50) throw errors.badRequest('业务员姓名不能超过 50 字')
    const phone = (input.phone || '').trim()
    if (phone.length > 30) throw errors.badRequest('联系方式不能超过 30 字')
    const salesman = await prisma.salesman.create({
      data: { companyCode: input.companyCode, name, phone: phone || null, remark: input.remark?.trim() || null },
    })
    await recordAudit({ userId: ctx.userId, module: 'transactions', action: 'create', targetId: salesman.id, detail: { action: 'create-salesman' } }, ctx.traceId)
    return { id: salesman.id, companyCode: salesman.companyCode, name: salesman.name, phone: salesman.phone, remark: salesman.remark }
  },
```

- [ ] **Step 6: 扩展 list 返回 stats**

`CollectionService.list` 中 `const [items, total] = await Promise.all([...])` 整体替换为：

```ts
    const [items, total, statusRows] = await Promise.all([
      prisma.collectionPlan.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' } }),
      prisma.collectionPlan.count({ where }),
      prisma.collectionPlan.groupBy({ by: ['status'], where, _count: { id: true }, _sum: { overdueAmount: true } }),
    ])
    const names = await buildNameMaps(items)
    const stats = {
      byStatus: Object.fromEntries(COLLECTION_STATUSES.map((s) => [s, 0])) as Record<string, number>,
      totalOverdue: 0,
    }
    for (const r of statusRows) {
      stats.byStatus[r.status] = r._count.id
      stats.totalOverdue += toNumber(r._sum.overdueAmount)
    }
    return {
      items: items.map((p) => toPlanDto(p as unknown as Record<string, unknown>, names)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      stats,
    }
```

- [ ] **Step 7: 运行测试确认通过**

```powershell
cd server
npx vitest run src/services/CollectionService.test.ts
```

Expected: PASS（含新增 2 用例；如 DB 不可用则整组跳过，需在可用 DB 环境确认）。

- [ ] **Step 8: Commit**

```powershell
git add server/src/services/CollectionService.ts server/src/services/CollectionService.test.ts; git commit -m "feat(collection): extend plan update with billed amount, salesman and status note; add list stats"
```

---

### Task 3: 业务员与客商选项接口 + 路由（TDD）

**Files:**
- Modify: `server/src/services/CollectionService.ts`
- Modify: `server/src/routes/transactions.ts`
- Test: `server/src/services/CollectionService.test.ts`

- [ ] **Step 1: 写失败测试（业务员/客商选项）**

在 `server/src/services/CollectionService.test.ts` 的 describe 内追加：

```ts
  it('业务员与客商选项接口', async () => {
    if (!dbReady) return
    // 关键词过滤客商
    const cps = await CollectionService.listCounterparties({ companyCodes: [TEST_COMPANY], keyword: TEST_CP.slice(0, 8) })
    expect(cps.length).toBeGreaterThanOrEqual(1)
    expect(cps.some((c) => c.code === TEST_CP)).toBe(true)
    // 关键词无匹配返回空
    const none = await CollectionService.listCounterparties({ companyCodes: [TEST_COMPANY], keyword: '__NOT_EXIST_CP__' })
    expect(none.length).toBe(0)
    // 业务员列表按公司过滤
    const sms = await CollectionService.listSalesmen({ companyCodes: [TEST_COMPANY] })
    expect(sms.some((s) => s.name === '张三')).toBe(true)
    // 创建校验：姓名必填
    await expect(CollectionService.createSalesman({ companyCode: TEST_COMPANY, name: '  ' }, ctx)).rejects.toThrow('必填')
  })
```

- [ ] **Step 2: 运行测试确认失败**

```powershell
cd server
npx vitest run src/services/CollectionService.test.ts
```

Expected: FAIL —— `listCounterparties` 不存在。

- [ ] **Step 3: 实现 listCounterparties**

在 `CollectionService` 对象内（`createSalesman` 之后）插入：

```ts
  /**
   * 客商选项（按公司过滤 + 关键词模糊匹配 code/name，供编辑抽屉选择）
   */
  async listCounterparties(params: { companyCodes?: string[]; keyword?: string }) {
    const where: Record<string, unknown> = {}
    if (params.companyCodes) where.companyCode = { in: params.companyCodes }
    if (params.keyword) {
      where.OR = [
        { code: { contains: params.keyword, mode: 'insensitive' } },
        { name: { contains: params.keyword, mode: 'insensitive' } },
      ]
    }
    const rows = await prisma.counterparty.findMany({ where, take: 100, orderBy: { name: 'asc' } })
    return rows.map((c) => ({ code: c.code, name: c.name, companyCode: c.companyCode, partyType: c.partyType, isInternal: c.isInternal }))
  },
```

- [ ] **Step 4: 注册路由**

`server/src/routes/transactions.ts` 的催收管理段落（`router.get('/collections', ...)` 之前）插入：

```ts
// ===== 业务员与客商选项 =====
router.get('/salesmen', requirePermission('transactions:view', 'view'), asyncHandler(async (req, res) => {
  const companyCodes = await normalizeCompanies(req.authUser as AuthUserContext, req.query.companyCode)
  const data = await CollectionService.listSalesmen({ companyCodes })
  sendOk(res, data)
}))

router.post('/salesmen', requirePermission('transactions:update', 'update'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const body = req.body ?? {}
  // 业务员归属单体公司：汇总主体归一化后取第一个成员
  const companyCodes = await normalizeCompanies(authUser, body.companyCode)
  const companyCode = companyCodes?.[0] ?? ''
  const data = await CollectionService.createSalesman({ companyCode, name: body.name, phone: body.phone, remark: body.remark }, { userId: authUser.userId, traceId: req.traceId })
  sendOk(res, data)
}))

router.get('/counterparties', requirePermission('transactions:view', 'view'), asyncHandler(async (req, res) => {
  const companyCodes = await normalizeCompanies(req.authUser as AuthUserContext, req.query.companyCode)
  const data = await CollectionService.listCounterparties({ companyCodes, keyword: req.query.keyword ? String(req.query.keyword) : undefined })
  sendOk(res, data)
}))
```

- [ ] **Step 5: 运行测试确认通过 + 路由类型检查**

```powershell
cd server
npx vitest run src/services/CollectionService.test.ts
npm run typecheck
```

Expected: PASS；typecheck 无输出。

- [ ] **Step 6: Commit**

```powershell
git add server/src/services/CollectionService.ts server/src/routes/transactions.ts server/src/services/CollectionService.test.ts; git commit -m "feat(collection): add salesman and counterparty option endpoints"
```

---

## 阶段二：前端基础

### Task 4: 前端类型 / API / hooks 扩展

**Files:**
- Modify: `web/src/types/index.ts`
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/hooks/api-queries.ts`

- [ ] **Step 1: 扩展类型定义**

`web/src/types/index.ts`：
- `CollectionPlanItem`（716 行附近）在 `remark: string | null` 与 `createdAt: string` 之间插入：

```ts
  billedUncollectedAmount: number | null
  salesmanId: string | null
  salesmanName: string | null
  statusNote: string | null
```

- 在 `CollectionLogItem` 定义（734 行附近）之后追加：

```ts
export interface SalesmanItem {
  id: string
  companyCode: string
  name: string
  phone: string | null
  remark: string | null
}

export interface CounterpartyOption {
  code: string
  name: string
  companyCode: string
  partyType: string
  isInternal: boolean
}

export interface CollectionStats {
  byStatus: Record<CollectionStatus, number>
  totalOverdue: number
}

/** 催收计划分页响应（列表 + 状态统计） */
export type CollectionListResponse = PaginatedResponse<CollectionPlanItem> & { stats: CollectionStats }
```

（`PaginatedResponse<T>` 已在 `web/src/types/index.ts` 定义，确认其字段为 `items/total/page/pageSize/totalPages`。）

- [ ] **Step 2: 扩展 api.ts**

`web/src/lib/api.ts` 的催收管理段落（`getCollections` 之前）插入：

```ts
  // 业务员与客商选项
  async getSalesmen(params: Record<string, unknown>) {
    return this.request({ method: 'GET', url: '/transactions/salesmen', params })
  }

  async createSalesman(data: Record<string, unknown>) {
    return this.request({ method: 'POST', url: '/transactions/salesmen', data })
  }

  async getCounterparties(params: Record<string, unknown>) {
    return this.request({ method: 'GET', url: '/transactions/collections/counterparties', params })
  }
```

- [ ] **Step 3: 扩展 api-queries.ts**

`web/src/hooks/api-queries.ts` 的催收管理段落（`useCollections` 之前）插入：

```ts
export function useSalesmen(companyCode?: string) {
  return useQuery({
    queryKey: ['transactions', 'salesmen', companyCode ?? 'all'] as const,
    queryFn: () => api.getSalesmen(companyCode ? { companyCode } : {}) as Promise<SalesmanItem[]>,
  })
}

export function useCreateSalesman() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createSalesman(data) as Promise<SalesmanItem>,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions', 'salesmen'] }),
  })
}

export function useCounterparties(companyCode: string | undefined, keyword: string) {
  return useQuery({
    queryKey: ['transactions', 'counterparties', companyCode ?? 'all', keyword] as const,
    queryFn: () => api.getCounterparties({ companyCode, keyword: keyword || undefined }) as Promise<CounterpartyOption[]>,
    enabled: !!companyCode,
  })
}
```

- `useCollections` 的返回类型改为：

```ts
    queryFn: () => api.getCollections(params as Record<string, unknown>) as Promise<CollectionListResponse>,
```

- 文件顶部类型导入（`import type { ... } from '@/types'`）增加 `SalesmanItem, CounterpartyOption, CollectionListResponse`。

- [ ] **Step 4: 验证**

```powershell
cd web
npm run lint
npm run build
```

Expected: lint 无错误；build 成功（tsc + vite）。

- [ ] **Step 5: Commit**

```powershell
git add web/src/types/index.ts web/src/lib/api.ts web/src/hooks/api-queries.ts; git commit -m "feat(collection): frontend types and hooks for salesman, counterparty and stats"
```

---

## 阶段三：前端页面

### Task 5: 共享账龄组件（AgingStackBar + agingRisk）

**Files:**
- Modify: `web/src/pages/transactions/shared.tsx`

- [ ] **Step 1: 实现共享组件**

在 `web/src/pages/transactions/shared.tsx` 的 `PartyTypeTag` 之后插入（文件已有 `AGING_GROUPS`、`cn`、`formatMoneyWan` 导入）：

```tsx
/** 8 段账龄堆叠条色阶：绿→青→蓝→紫→黄→橙→红（success/info/warning/destructive 系，同系两段深浅区分） */
export const AGING_BAR_COLORS = [
  'bg-success', 'bg-success/60',
  'bg-info', 'bg-info/60',
  'bg-warning', 'bg-warning/60',
  'bg-destructive/60', 'bg-destructive',
] as const

/** 账龄堆叠条：按 8 段占比渲染（总余额 ≤0 时不渲染）；各段 title 显示段名与金额（万） */
export function AgingStackBar({ aging, closingBalance, className }: { aging: Record<string, number>; closingBalance: number; className?: string }) {
  const total = closingBalance > 0 ? closingBalance : Object.values(aging).reduce((s, v) => s + (v ?? 0), 0)
  if (total <= 0) return null
  return (
    <div className={cn('flex h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      {AGING_GROUPS.map((g, i) => {
        const v = aging[g] ?? 0
        if (v <= 0) return null
        return (
          <div
            key={g}
            className={AGING_BAR_COLORS[i]}
            style={{ width: `${Math.max((v / total) * 100, 1)}%` }}
            title={`${g}：${formatMoneyWan(v / 10000)} 万`}
          />
        )
      })}
    </div>
  )
}

/** 账龄风险分档（供总览卡片/分析抽屉复用）：danger=3年+>20%、watch=3年+≥5%、good=其余；余额≤0 返回 null */
export function agingRisk(aging: Record<string, number>, closingBalance: number): { level: 'danger' | 'watch' | 'good'; text: string } | null {
  if (closingBalance <= 0) return null
  const total = closingBalance
  const pct = (b: string) => ((aging[b] ?? 0) / total) * 100
  const threePlus = pct('3年以上')
  if (threePlus > 20) return { level: 'danger', text: `3 年以上账龄占 ${threePlus.toFixed(1)}%，存在高逾期风险` }
  if (threePlus >= 5) return { level: 'watch', text: `3 年以上账龄占 ${threePlus.toFixed(1)}%，建议关注回收` }
  const in1y = AGING_GROUPS.slice(0, 5).reduce((s, b) => s + pct(b), 0)
  return { level: 'good', text: `账龄结构良好，1 年内占 ${in1y.toFixed(1)}%` }
}
```

- [ ] **Step 2: 验证**

```powershell
cd web
npm run lint
npm run build
```

Expected: 无错误。

- [ ] **Step 3: Commit**

```powershell
git add web/src/pages/transactions/shared.tsx; git commit -m "feat(transactions): shared aging stack bar and risk level helpers"
```

---

### Task 6: 总览页六大往来类型卡片（A+B 组合）

**Files:**
- Modify: `web/src/pages/transactions/overview.tsx`

- [ ] **Step 1: 替换六大类型卡片渲染**

`web/src/pages/transactions/overview.tsx`：

1. 顶部导入追加（现有导入基础上）：

```tsx
import { useNavigate } from 'react-router-dom'
import { AgingStackBar, agingRisk } from './shared'
```

2. 组件内追加 `const navigate = useNavigate()`（放在 `const { can } = usePermission()` 之后）。

3. 「六大往来分类卡片」区块（`list.map((item) => { ... })` 整体）替换为：

```tsx
              {/* 六大往来分类卡片：信息增强 + 账龄堆叠条 + 风险提示，点击钻取账龄分析 */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {list.map((item) => {
                  // 方向标记按会计性质：贷方性质（预收/应付/其他应付）= AP，其余 = AR
                  const isCredit = CREDIT_NATURE_TYPES.includes(item.transactionType)
                  const risk = agingRisk(item.aging, item.totalClosingBalance)
                  // 较期初变动率：期初为 0 时隐藏该项
                  const changePct =
                    item.totalOpeningBalance !== 0
                      ? ((item.totalClosingBalance - item.totalOpeningBalance) / Math.abs(item.totalOpeningBalance)) * 100
                      : null
                  return (
                    <Card
                      key={item.transactionType}
                      className="cursor-pointer transition-shadow duration-200 ease-brand hover:shadow-md"
                      onClick={() => {
                        // 预选该类型并跳转账龄分析（pageStateStore 持久化，刷新后仍生效）
                        setTransactionsTab('aging', { type: item.transactionType })
                        navigate('/transactions/aging')
                      }}
                    >
                      <CardContent className="p-4">
                        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <span className={cn('inline-block h-3.5 w-1 rounded-full', isCredit ? 'bg-destructive' : 'bg-info')} />
                          {item.transactionType}
                        </p>
                        {item.totalClosingBalance !== 0 ? (
                          <>
                            <p className="mt-2 font-num text-2xl font-bold text-foreground">{formatAmount(item.totalClosingBalance)}</p>
                            <div className="mt-2">
                              <AgingStackBar aging={item.aging} closingBalance={item.totalClosingBalance} />
                            </div>
                            <p className="mt-1.5 flex justify-between font-num text-[11px] text-muted-foreground">
                              <span>1年内 {agingPct(item.aging, item.totalClosingBalance, 0, 5)}%</span>
                              <span>1-3年 {agingPct(item.aging, item.totalClosingBalance, 5, 7)}%</span>
                              <span className={risk?.level === 'danger' ? 'text-destructive' : risk?.level === 'watch' ? 'text-warning-strong' : 'text-muted-foreground'}>
                                3年+ {agingPct(item.aging, item.totalClosingBalance, 7, 8)}%
                              </span>
                            </p>
                            <div className="mt-2 flex flex-wrap gap-3 border-t border-dashed border-border pt-2 text-[11px] text-muted-foreground">
                              {changePct !== null && (
                                <span className={cn('font-medium', getChangeColor(changePct))}>
                                  {changePct > 0 ? '↑' : changePct < 0 ? '↓' : ''} {Math.abs(changePct).toFixed(1)}% 较期初
                                </span>
                              )}
                              <span>{item.recordCount} 笔</span>
                              <span>内 {item.internalCount} / 外 {item.externalCount}</span>
                            </div>
                            {risk && (
                              <p className={cn('mt-1.5 flex items-center gap-1.5 text-[11px]', risk.level === 'danger' ? 'text-destructive' : risk.level === 'watch' ? 'text-warning-strong' : 'text-success-strong')}>
                                <span className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', risk.level === 'danger' ? 'bg-destructive' : risk.level === 'watch' ? 'bg-warning' : 'bg-success')} />
                                {risk.text}
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="mt-2 text-sm text-muted-foreground">暂无余额</p>
                        )}
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
```

4. 组件内追加辅助函数（放在 `return (` 之前、组件函数体内）：

```tsx
  // 账龄分段占比（按 AGING_GROUPS 下标区间求和，返回百分比字符串）
  const agingPct = (aging: Record<string, number>, total: number, from: number, to: number): string => {
    if (total <= 0) return '0.0'
    const sum = AGING_GROUPS.slice(from, to).reduce((s, b) => s + (aging[b] ?? 0), 0)
    return ((sum / total) * 100).toFixed(1)
  }
```

5. 顶部导入追加 `AGING_GROUPS` 与 `getChangeColor`（合并到现有导入行）：

```tsx
import { CREDIT_NATURE_TYPES, useDefaultCompanyCode, formatAmount, AGING_GROUPS } from './shared'
// 原 `import { cn } from '@/lib/utils'` 改为：
import { cn, getChangeColor } from '@/lib/utils'
```

- [ ] **Step 2: 验证**

```powershell
cd web
npm run lint
npm run build
```

Expected: 无错误。

- [ ] **Step 3: 手动验证（可选，需 dev server）**

启动前后端后访问 `/transactions/overview`：六卡显示账龄堆叠条/占比/信息行/风险提示；零余额卡灰态「暂无余额」；点击卡片跳转 `/transactions/aging` 且类型已预选。

- [ ] **Step 4: Commit**

```powershell
git add web/src/pages/transactions/overview.tsx; git commit -m "feat(transactions): enrich overview type cards with aging bar and risk hints"
```

---

### Task 7: 账龄分析页（筛选分区 + 表格风险着色）

**Files:**
- Modify: `web/src/pages/transactions/aging.tsx`

- [ ] **Step 1: 添加账龄段底色映射常量**

`web/src/pages/transactions/aging.tsx` 的 `AgingRenderRow` 类型定义之后插入：

```ts
/** 账龄列风险底色（浅色，账龄越深越偏红）；0 值不着色 */
const AGING_CELL_BG: Record<string, string> = {
  '1个月': 'bg-success/[0.06]',
  '2个月': 'bg-success/[0.06]',
  '3个月': 'bg-info/[0.06]',
  '4-6月': 'bg-info/[0.06]',
  '半年以上': 'bg-warning/[0.08]',
  '1年至2年': 'bg-warning/[0.08]',
  '2年至3年': 'bg-destructive/[0.06]',
  '3年以上': 'bg-destructive/[0.06]',
}
```

- [ ] **Step 2: 数据行账龄单元格着色**

数据行渲染中账龄循环（`AGING_GROUPS.map((b) => (...))`，约 294 行）替换为：

```tsx
                            {AGING_GROUPS.map((b) => {
                              const v = row.aging[b] || 0
                              return (
                                <td key={b} className={cn('px-2 py-2 text-right font-num text-xs whitespace-nowrap', v !== 0 && AGING_CELL_BG[b], b === '3年以上' && v !== 0 && 'font-medium text-destructive')}>
                                  {v !== 0 ? v.toLocaleString('zh-CN', { minimumFractionDigits: 2 }) : '-'}
                                </td>
                              )
                            })}
```

- [ ] **Step 3: 筛选卡拆两行**

筛选卡内 `flex flex-wrap items-center gap-3` 容器整体替换为两行结构：

```tsx
        <Card className="rounded-card p-4">
          {/* 行 1：核心筛选 + 高频操作 */}
          <div className="flex flex-wrap items-center gap-3">
            <CompanySelect value={companyFilter} onChange={setCompanyFilter} />
            <Select value={period ?? ''} onValueChange={setPeriodFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="期间" />
              </SelectTrigger>
              <SelectContent>
                {(periods || []).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v === 'all' ? '' : v); setAccountFilter([]) }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="往来类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部类型</SelectItem>
                {TRANSACTION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={groupBy} onValueChange={setGroupBy}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="分组方式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="type">按往来类型</SelectItem>
                <SelectItem value="counterparty">按往来对象</SelectItem>
              </SelectContent>
            </Select>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {can('transactions', 'export') && (
                <Button variant="outline" size="sm" disabled={!period || exporting} onClick={handleExport}>
                  <Download className="mr-1 h-4 w-4" />
                  {exporting ? (exportProgress > 0 ? `导出中 ${exportProgress}%` : '生成中…') : '导出 Excel'}
                </Button>
              )}
              {can('reports', 'create') && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!period}
                  onClick={() => setAnalysisTarget({
                    transactionType: typeFilter || '',
                    period: period as string,
                    defaultCompanyCode: companyFilter !== 'all' ? companyFilter : undefined,
                  })}
                >
                  <FileText className="mr-1 h-4 w-4" /> 撰写单项分析
                </Button>
              )}
              {can('reports', 'view') && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate('/reports/analyses')}
                >
                  <Eye className="mr-1 h-4 w-4" /> 查看分析
                </Button>
              )}
            </div>
          </div>
          {/* 行 2：明细筛选 */}
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-dashed border-border pt-3">
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">明细筛选</span>
            <AccountMultiSelect value={accountFilter} onChange={setAccountFilter} transactionType={typeFilter || undefined} />
            <PartyTypeSelect value={partyFilter} onChange={setPartyFilter} />
            <Input
              placeholder="搜索往来对象..."
              className="w-[200px]"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <Switch id="aging-subtotal-only" checked={subtotalOnly} onCheckedChange={setSubtotalOnly} disabled={rows.length === 0} />
              <span className="cursor-pointer text-xs text-muted-foreground select-none" onClick={() => setSubtotalOnly(!subtotalOnly)}>仅显示小计</span>
            </div>
          </div>
        </Card>
```

- [ ] **Step 4: 验证**

```powershell
cd web
npm run lint
npm run build
```

Expected: 无错误。

- [ ] **Step 5: Commit**

```powershell
git add web/src/pages/transactions/aging.tsx; git commit -m "feat(transactions): split aging filter into two rows and color aging cells by risk"
```

---

### Task 8: 分析抽屉（可折叠快照）

**Files:**
- Modify: `web/src/pages/transactions/analysis-drawer.tsx`

- [ ] **Step 1: 快照区改为可折叠结构**

`web/src/pages/transactions/analysis-drawer.tsx`：

1. 导入追加：

```tsx
import { ChevronDown, ChevronUp } from 'lucide-react'
import { AgingStackBar, agingRisk } from './shared'
```

2. `TransactionDrawerBody` 组件内（`const [txnType, setTxnType] = useState(...)` 之后）追加折叠状态：

```tsx
  const [agingExpanded, setAgingExpanded] = useState(false)
```

3. 快照展示区块（`{companyCode && txnType && (snapshot ? (...) : (...))}` 整体）替换为：

```tsx
          {companyCode && txnType && (
            snapshot ? (
              <div className="rounded-md border bg-muted/30 p-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-[11px] text-muted-foreground">期末余额</span>
                  <span className="font-num text-lg font-bold text-foreground">
                    {formatMoneyWan(snapshot.closingBalance / 10000)}<span className="ml-0.5 text-xs font-normal text-muted-foreground">万</span>
                  </span>
                </div>
                <div className="mt-2">
                  <AgingStackBar aging={snapshot.aging} closingBalance={snapshot.closingBalance} />
                </div>
                {(() => {
                  const risk = agingRisk(snapshot.aging, snapshot.closingBalance)
                  const total = snapshot.closingBalance > 0 ? snapshot.closingBalance : 0
                  // 分段占比：与总览卡片口径一致（1年内 = 前 5 段、1-3年 = 5-7 段、3年+ = 末段）
                  const pct = (from: number, to: number) =>
                    total > 0 ? ((AGING_GROUPS.slice(from, to).reduce((s, b) => s + (snapshot.aging[b] ?? 0), 0) / total) * 100).toFixed(1) : '0.0'
                  return (
                    <>
                      <p className="mt-1.5 flex justify-between font-num text-[11px] text-muted-foreground">
                        <span>1年内 {pct(0, 5)}%</span>
                        <span>1-3年 {pct(5, 7)}%</span>
                        <span className={risk?.level === 'danger' ? 'text-destructive' : risk?.level === 'watch' ? 'text-warning-strong' : 'text-muted-foreground'}>
                          3年+ {pct(7, 8)}%
                        </span>
                      </p>
                      <button
                        type="button"
                        onClick={() => setAgingExpanded((v) => !v)}
                        className="mt-2 flex w-full items-center justify-center gap-1 rounded py-0.5 text-xs text-primary transition-colors hover:bg-muted"
                      >
                        {agingExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                        {agingExpanded ? '收起账龄明细' : '展开账龄明细'}
                      </button>
                    </>
                  )
                })()}
                {agingExpanded && (
                  <div className="mt-2 grid grid-cols-4 gap-1.5 border-t border-border pt-2">
                    {AGING_GROUPS.map((g) => {
                      const v = snapshot.aging[g] ?? 0
                      const isDanger = g === '3年以上' && v > 0
                      return (
                        <div key={g} className={cn('rounded-md border px-1.5 py-1 text-center', isDanger ? 'border-destructive/30 bg-destructive/[0.06]' : 'border-border bg-background')}>
                          <p className="text-[10px] text-muted-foreground">{g}</p>
                          <p className={cn('font-num text-xs', isDanger ? 'font-medium text-destructive' : 'text-foreground')}>
                            {v !== 0 ? formatMoneyWan(v / 10000) : '-'}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">该公司在 {target.period} 无{txnType}数据（仍可撰写分析）</p>
            )
          )}
```

4. 顶部导入追加 `cn`（`@/lib/utils`；文件已有 `formatMoneyWan` 导入，合并）。

- [ ] **Step 2: 验证**

```powershell
cd web
npm run lint
npm run build
```

Expected: 无错误。

- [ ] **Step 3: Commit**

```powershell
git add web/src/pages/transactions/analysis-drawer.tsx; git commit -m "feat(transactions): collapsible aging snapshot in analysis drawer"
```

---

### Task 9: 科目过滤页（搜索 + 计数徽章 + 图例）

**Files:**
- Modify: `web/src/pages/transactions/account-filter-tab.tsx`

- [ ] **Step 1: 添加搜索过滤与计数徽章**

`web/src/pages/transactions/account-filter-tab.tsx`：

1. 顶部导入追加：

```tsx
import { useState } from 'react'
import { Search, Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
```

（原导入为 `import { useCallback, useMemo } from 'react'`，改为 `import { useCallback, useMemo, useState } from 'react'`。）

2. 组件内（`const canUpdate = ...` 之后）追加：

```tsx
  const [keyword, setKeyword] = useState('')
```

3. `grouped` 的 useMemo 改为先按关键词过滤：

```tsx
  const grouped = useMemo(() => {
    const kw = keyword.trim()
    const filtered = kw ? list.filter((a) => a.name.includes(kw) || a.code.includes(kw)) : list
    const visible = showAll ? filtered : filtered.filter((a) => a.hasData || a.status === 'inactive')
    const map = new Map<string, ManageAccountItem[]>()
    for (const a of visible) {
      if (!map.has(a.transactionType)) map.set(a.transactionType, [])
      map.get(a.transactionType)!.push(a)
    }
    return TYPE_ORDER.filter((t) => map.has(t)).map((t) => ({ type: t, items: map.get(t)! }))
  }, [list, showAll, keyword])
```

（注意：搜索时「显示全部/收起」按钮的显示逻辑基于 `visibleCount < list.length`，搜索态下该按钮仍可用，行为合理无需改动。）

4. 卡头（`border-b` 行）统计区后追加搜索框与说明 Tooltip（替换原说明段落 `p.pb-3` 的位置——该段落整体删除）：

```tsx
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <FilterX className="h-4 w-4" />
              科目过滤
            </h3>
            <span className="text-xs text-muted-foreground">
              已纳入 <span className="font-medium text-success-strong">{activeCount}</span> 个 · 已排除 <span className="font-medium text-warning-strong">{excludedCount}</span> 个
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="科目过滤规则说明" className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="max-w-[260px] text-xs">点击标签即可排除/恢复该科目：排除后账龄分析将自动剔除其数据，且不再出现在科目筛选下拉中。</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索科目..."
              className="h-8 w-[180px] pl-8 text-sm"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
        </div>
```

（原「点击标签即可排除/恢复…」`<p>` 段落删除；`Input` 需导入 `@/components/ui/input`。）

5. 组标题行追加计数徽章（替换 `{g.type}` 标题行）：

```tsx
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    {g.type}
                    <span className="text-xs font-normal text-muted-foreground">{g.items.length} 个科目</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      纳入 {g.items.filter((a) => a.status === 'active').length} · 排除 {g.items.filter((a) => a.status === 'inactive').length}
                    </span>
                  </div>
```

6. 底部「显示全部」按钮之后、容器结束前追加图例行：

```tsx
              <div className="flex items-center gap-4 border-t border-border pt-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-success" /> 有数据</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-warning" /> 已排除</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full border border-dashed border-muted-foreground/60" /> 暂无数据</span>
              </div>
```

- [ ] **Step 2: 验证**

```powershell
cd web
npm run lint
npm run build
```

Expected: 无错误（确认 `@/components/ui/tooltip` 的 TooltipContent 支持 `side` prop，与项目现有用法一致）。

- [ ] **Step 3: Commit**

```powershell
git add web/src/pages/transactions/account-filter-tab.tsx; git commit -m "feat(transactions): account filter search, group badges and legend"
```

---

### Task 10: 催收计划页重构

**Files:**
- Modify: `web/src/components/layout/nav-items.ts`
- Modify: `web/src/pages/transactions/collections/plans.tsx`
- Modify: `web/src/pages/transactions/collections-tab.tsx`

- [ ] **Step 1: 导航与页面标题更名**

1. `web/src/components/layout/nav-items.ts`：将「催收管理」目录项（第 64-70 行）替换为叶子项：

```ts
      { path: '/transactions/collections/plans', label: '催收计划' },
```

2. `web/src/pages/transactions/collections/plans.tsx` 与 `web/src/pages/transactions/collections-tab.tsx` 头部注释中「催收管理」统一改为「催收计划」。

- [ ] **Step 2: 金额分级着色工具 + 状态/方式映射微调**

`web/src/pages/transactions/collections-tab.tsx` 的 `fmtAmount` 之后插入：

```ts
/** 金额分级着色：≥100万 红、≥10万 橙、其余默认 */
function amountTone(v: number | null): string {
  if (v === null || v === undefined) return ''
  if (v >= 1000000) return 'text-destructive font-semibold'
  if (v >= 100000) return 'text-warning-strong font-medium'
  return ''
}
```

- [ ] **Step 3: 表格列重写（列名/着色/hover 文字按钮/新字段）**

`planColumns` useMemo（整体替换）为：

```tsx
  const planColumns: DataTableColumn<CollectionPlanItem>[] = useMemo(() => [
    {
      key: 'companyCode', header: '公司',
      render: (row) => <span title={row.companyName || row.companyCode}>{getDisplayName(row.companyCode, row.companyName)}</span>,
    },
    {
      key: 'counterpartyName', header: '客商',
      render: (row) => (
        <>
          <div>{row.counterpartyName || '-'}</div>
          <div className="text-xs text-muted-foreground">{row.counterpartyCode}</div>
        </>
      ),
    },
    { key: 'accountCode', header: '科目', render: (row) => <span className="text-xs">{row.accountCode}</span> },
    {
      key: 'overdueAmount', header: '金额', align: 'right', cellClassName: 'font-num',
      render: (row) => <span className={amountTone(row.overdueAmount)}>{fmtAmount(row.overdueAmount)}</span>,
    },
    {
      key: 'billedUncollectedAmount', header: '已开票未收款', align: 'right', cellClassName: 'font-num group/billed',
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          {fmtAmount(row.billedUncollectedAmount)}
          {canUpdate && (
            <button
              type="button"
              className="invisible rounded px-1 text-xs text-primary group-hover/billed:visible hover:underline"
              onClick={() => setBilledPlan(row)}
            >
              编辑
            </button>
          )}
        </span>
      ),
    },
    {
      key: 'salesmanName', header: '业务员', cellClassName: 'group/salesman',
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          {row.salesmanName || '-'}
          {canUpdate && (
            <button
              type="button"
              className="invisible rounded px-1 text-xs text-primary group-hover/salesman:visible hover:underline"
              onClick={() => setSalesmanPlan(row)}
            >
              编辑
            </button>
          )}
        </span>
      ),
    },
    {
      key: 'plannedDate', header: '计划日期',
      render: (row) => {
        const overdue = row.plannedDate < new Date().toISOString().slice(0, 10) && row.status !== 'full' && row.status !== 'bad_debt'
        return (
          <span className={cn('text-xs whitespace-nowrap', overdue && 'font-medium text-destructive')} title={overdue ? '已逾期' : undefined}>
            {row.plannedDate}
            {overdue && <span className="ml-1 text-[10px] font-normal text-muted-foreground">已逾期</span>}
          </span>
        )
      },
    },
    { key: 'method', header: '方式', render: (row) => <span className="text-xs">{METHOD_LABELS[row.method] || row.method}</span> },
    { key: 'actualAmount', header: '实际回收', align: 'right', cellClassName: 'font-num', render: (row) => fmtAmount(row.actualAmount) },
    {
      key: 'status', header: '状态',
      render: (row) => (
        <span className={cn('rounded px-1.5 py-0.5 text-xs', STATUS_STYLES[row.status])} title={row.statusNote ?? undefined}>
          {STATUS_LABELS[row.status]}
        </span>
      ),
    },
    {
      key: 'actions', header: '操作', cellClassName: 'group/ops whitespace-nowrap',
      render: (row) => (
        <span className="invisible inline-flex gap-1 group-hover/ops:visible">
          {canUpdate && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setUpdatingPlan(row)}>
              更新
            </Button>
          )}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setLogsPlan(row)}>
            记录
          </Button>
        </span>
      ),
    },
  ], [getDisplayName, canUpdate, setUpdatingPlan, setLogsPlan, setBilledPlan, setSalesmanPlan])
```

- [ ] **Step 4: 组件状态与统计条**

`CollectionsTab` 内（`const [logsPlan, setLogsPlan] = useState<CollectionPlanItem | null>(null)` 之后）追加：

```tsx
  const [billedPlan, setBilledPlan] = useState<CollectionPlanItem | null>(null)
  const [salesmanPlan, setSalesmanPlan] = useState<CollectionPlanItem | null>(null)
```

列表数据解构处改为：

```tsx
  const items = data?.items || []
  const total = data?.total || 0
  const stats = data?.stats
```

筛选卡内（筛选行之后、`</Card>` 之前）插入状态统计条：

```tsx
      {stats && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-dashed border-border pt-2.5 text-xs">
          {(Object.keys(STATUS_LABELS) as CollectionStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => { setStatusFilter(statusFilter === s ? '' : s); setPage(1) }}
              className={cn('flex items-center gap-1.5', statusFilter === s && 'font-semibold text-foreground')}
              title={`点击${statusFilter === s ? '清除' : '筛选'}「${STATUS_LABELS[s]}」`}
            >
              <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[s])} />
              {STATUS_LABELS[s]} <span className="font-num">{stats.byStatus[s] ?? 0}</span>
            </button>
          ))}
          <span className="ml-auto text-muted-foreground">
            金额合计 <span className="font-num font-medium text-destructive">{fmtAmount(stats.totalOverdue)}</span>
          </span>
        </div>
      )}
```

- 常量区（`METHOD_LABELS` 之后）插入状态圆点色映射：

```ts
/** 状态统计条圆点色（对齐 STATUS_STYLES 语义） */
const STATUS_DOT: Record<CollectionStatus, string> = {
  pending: 'bg-muted-foreground',
  collecting: 'bg-info',
  partial: 'bg-warning',
  full: 'bg-success',
  bad_debt: 'bg-destructive',
}
```

- [ ] **Step 5: 分页并入表格卡底部**

原独立分区块（`{total > 0 && (<div className="rounded-card border bg-card px-4 py-2.5">...)}`）删除；表格卡内 `</Card>` 之前（`pt-4` 内容区之后）插入：

```tsx
      {/* 分页：并入表格卡底部 border-t 行 */}
      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5">
          <span className="text-xs text-muted-foreground">共 {total} 条</span>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            summary={`共 ${total} 条`}
          />
        </div>
      )}
```

（`Pagination` 组件保留 summary 传参，视觉上左侧统计与分页 summary 重复时以左侧为准——`Pagination` 的 summary 可留空字符串，避免重复显示。）

- [ ] **Step 6: 已开票未收款金额编辑抽屉**

`GenerateDialog` 定义之后插入新组件（抽屉以 target 键重挂载，`useState` 惰性初始化：默认值与「金额」（逾期金额）一致）：

```tsx
// ===== 已开票未收款金额编辑抽屉 =====
function BilledAmountDrawer({ plan, onClose }: { plan: CollectionPlanItem | null; onClose: () => void }) {
  const [value, setValue] = useState(plan ? String(plan.billedUncollectedAmount ?? plan.overdueAmount) : '')
  const [errorMsg, setErrorMsg] = useState('')
  const updateMutation = useUpdateCollection()

  const handleSave = async () => {
    if (!plan) return
    setErrorMsg('')
    const v = value.trim() === '' ? plan.overdueAmount : Number(value)
    if (!Number.isFinite(v) || v < 0) { setErrorMsg('金额不合法'); return }
    try {
      await updateMutation.mutateAsync({ id: plan.id, data: { billedUncollectedAmount: v } })
      onClose()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <SheetShell
      onClose={onClose}
      title="编辑已开票未收款金额"
      description={plan ? `${plan.companyName || plan.companyCode} · ${plan.counterpartyName || plan.counterpartyCode} · ${plan.accountCode}` : undefined}
      footer={(
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={updateMutation.isPending}>取消</Button>
          <Button size="sm" disabled={updateMutation.isPending || value.trim() === ''} onClick={handleSave}>
            保存
          </Button>
        </div>
      )}
    >
      <div className="space-y-3 p-5">
        <div className="space-y-1.5">
          <Label htmlFor="billed-amount-input">已开票未收款金额（元）</Label>
          <Input id="billed-amount-input" type="number" min={0} step="0.01" placeholder={`默认 ${plan?.overdueAmount ?? ''}`} value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">默认值与「金额」（逾期金额）一致，可手动修改。</p>
        {errorMsg && <FlashMessage type="error">{errorMsg}</FlashMessage>}
      </div>
    </SheetShell>
  )
}
```

在 `CollectionsTab` 渲染末尾（现有三个对话框之后）挂载：

```tsx
      <BilledAmountDrawer plan={billedPlan} onClose={() => setBilledPlan(null)} />
```

- [ ] **Step 7: 业务员编辑抽屉**

`BilledAmountDrawer` 之后插入：

```tsx
// ===== 业务员编辑抽屉（选择现有 / 新建） =====
function SalesmanDrawer({ plan, onClose }: { plan: CollectionPlanItem | null; onClose: () => void }) {
  const companyCode = plan?.companyCode
  const { data: salesmen } = useSalesmen(companyCode)
  const createMutation = useCreateSalesman()
  const updateMutation = useUpdateCollection()
  const [selectedId, setSelectedId] = useState(plan?.salesmanId ?? '')
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const handleAdd = async () => {
    if (!companyCode) return
    setErrorMsg('')
    if (!newName.trim()) { setErrorMsg('请输入业务员姓名'); return }
    try {
      const created = await createMutation.mutateAsync({ companyCode, name: newName.trim(), phone: newPhone.trim() || undefined })
      setSelectedId(created.id)
      setNewName('')
      setNewPhone('')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '添加失败')
    }
  }

  const handleSave = async () => {
    if (!plan) return
    setErrorMsg('')
    try {
      await updateMutation.mutateAsync({ id: plan.id, data: { salesmanId: selectedId || null } })
      onClose()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <SheetShell
      onClose={onClose}
      title="业务员"
      description={plan ? `${plan.companyName || plan.companyCode} · ${plan.counterpartyName || plan.counterpartyCode}` : undefined}
      footer={(
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={updateMutation.isPending || createMutation.isPending}>取消</Button>
          <Button size="sm" disabled={updateMutation.isPending || createMutation.isPending} onClick={handleSave}>保存</Button>
        </div>
      )}
    >
      <div className="space-y-4 p-5">
        <div className="space-y-1.5">
          <Label htmlFor="salesman-select">选择现有业务员</Label>
          <Select value={selectedId} onValueChange={setSelectedId}>
            <SelectTrigger id="salesman-select" className="w-full">
              <SelectValue placeholder="未指定业务员（选填）" />
            </SelectTrigger>
            <SelectContent>
              {(salesmen || []).map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}{s.phone ? ` · ${s.phone}` : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs font-medium text-foreground">新建业务员</p>
          <div className="space-y-1.5">
            <Label htmlFor="salesman-name">姓名（必填）</Label>
            <Input id="salesman-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="业务员姓名" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="salesman-phone">联系方式（选填）</Label>
            <Input id="salesman-phone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="手机号/电话" />
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="outline" disabled={createMutation.isPending} onClick={handleAdd}>
              {createMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              添加
            </Button>
          </div>
        </div>
        {errorMsg && <FlashMessage type="error">{errorMsg}</FlashMessage>}
      </div>
    </SheetShell>
  )
}
```

挂载（`BilledAmountDrawer` 之后）：

```tsx
      <SalesmanDrawer plan={salesmanPlan} onClose={() => setSalesmanPlan(null)} />
```

- [ ] **Step 8: 状态更新对话框增强（状态说明 + Label 无障碍）**

`UpdateStatusDialog` 整体替换为：

```tsx
function UpdateStatusDialog({ plan, onClose }: { plan: CollectionPlanItem | null; onClose: () => void }) {
  const [status, setStatus] = useState('')
  const [actualAmount, setActualAmount] = useState('')
  const [statusNote, setStatusNote] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const updateMutation = useUpdateCollection()

  const allowed = plan ? STATUS_TRANSITIONS[plan.status] : []

  const handleSubmit = async () => {
    if (!plan) return
    setErrorMsg('')
    const data: Record<string, unknown> = {}
    if (status) data.status = status
    if (actualAmount !== '') {
      const v = Number(actualAmount)
      if (!Number.isFinite(v) || v < 0) {
        setErrorMsg('实际回收金额不合法')
        return
      }
      data.actualAmount = v
    }
    if (statusNote.trim()) data.statusNote = statusNote.trim()
    if (Object.keys(data).length === 0) {
      setErrorMsg('请选择新状态、填写实际回收金额或催收状态说明')
      return
    }
    try {
      await updateMutation.mutateAsync({ id: plan.id, data })
      handleClose()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '更新失败')
    }
  }

  const handleClose = () => {
    setStatus('')
    setActualAmount('')
    setStatusNote('')
    setErrorMsg('')
    onClose()
  }

  return (
    <Dialog open={!!plan} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>更新催收状态</DialogTitle>
          <DialogDescription>
            {plan?.counterpartyName || plan?.counterpartyCode} · 金额 {fmtAmount(plan?.overdueAmount ?? null)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="update-status-select">新状态（当前：{plan ? STATUS_LABELS[plan.status] : '-'}）</Label>
            {allowed.length === 0 ? (
              <p className="text-sm text-muted-foreground">当前为终态，不可再流转（仍可补录实际回收金额）</p>
            ) : (
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="update-status-select">
                  <SelectValue placeholder="保持不变" />
                </SelectTrigger>
                <SelectContent>
                  {allowed.map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="update-actual-amount">实际回收金额</Label>
            <Input id="update-actual-amount" type="number" placeholder="选填" value={actualAmount} onChange={(e) => setActualAmount(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="update-status-note">催收状态说明（≤500 字）</Label>
            <Textarea id="update-status-note" rows={3} placeholder="如：客户承诺月底回款，逾期部分已开票待付款…" value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />
          </div>
          {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>取消</Button>
          <Button disabled={updateMutation.isPending} onClick={handleSubmit}>
            {updateMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 9: 催收记录对话框 Label 修复**

`LogsDialog` 中 Textarea 的容器（`<div className="space-y-2">` 内）改为：

```tsx
          {canUpdate && (
            <div className="space-y-2">
              <Label htmlFor="collection-log-content">催收记录内容</Label>
              <Textarea id="collection-log-content" placeholder="记录本次催收情况..." value={content} onChange={(e) => setContent(e.target.value)} rows={3} />
              {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
              <div className="flex justify-end">
                <Button size="sm" disabled={addMutation.isPending} onClick={handleAdd}>
                  {addMutation.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                  添加记录
                </Button>
              </div>
            </div>
          )}
```

- [ ] **Step 10: 导入补充与验证**

`collections-tab.tsx` 顶部导入追加：

```tsx
import { SheetShell } from '@/components/ui/sheet-shell'
import { Label } from '@/components/ui/label'
import { FlashMessage } from '@/components/ui/flash-message'
import { useSalesmen, useCreateSalesman } from '@/hooks/api-queries'
```

（`Textarea`、`Loader2`、`cn`、`Pagination`、`Dialog*` 已导入；确认 `STATUS_LABELS`/`STATUS_STYLES`/`METHOD_LABELS` 均在文件中存在。）

```powershell
cd web
npm run lint
npm run build
```

Expected: 无错误。若 oxlint 报未使用变量/类型不匹配，按报错修正。

- [ ] **Step 11: 手动验证（需 dev server 与后端迁移后 DB）**

- 列表：金额分级着色（≥100万 红 / ≥10万 橙）；已开票未收款与业务员列 hover 显示「编辑」；操作列 hover 显示「更新 / 记录」
- 已开票金额抽屉：默认值 = 金额；保存后列表刷新
- 业务员抽屉：选择现有 / 新建（姓名必填）；新建成功后自动选中
- 状态更新对话框：说明文字随状态保存；状态胶囊 title 显示说明
- 统计条：点击过滤、再次点击清除；金额合计正确
- 分页在表格卡底部；无权限（view-only）角色下 hover 按钮不出现

- [ ] **Step 12: Commit**

```powershell
git add web/src/components/layout/nav-items.ts web/src/pages/transactions/collections/plans.tsx web/src/pages/transactions/collections-tab.tsx; git commit -m "feat(collection): rebuild collection plans page with drawers, stats bar and hover actions"
```

---

## 自审记录

- **Spec 覆盖**：总览卡片（Task 6 + Task 5 共享组件）、账龄页（Task 7）、分析抽屉（Task 8）、科目过滤（Task 9）、催收重构含后端扩展（Task 1-4、Task 10）、无障碍（Task 10 Step 8/9 Label 关联、hover 按钮 aria 语义）、导航更名（Task 10 Step 1）、范围外项未纳入（internal/coverage/KPI/趋势图不动）。
- **占位符检查**：所有步骤含具体代码与命令；无 TBD。
- **类型一致性**：`AgingStackBar`/`agingRisk`（Task 5 定义，Task 6/8 使用）；`CollectionListResponse`（Task 4 定义，Task 10 使用）；DTO 字段名 `billedUncollectedAmount`/`salesmanName`/`statusNote`（Task 2 定义，Task 10 前端消费）前后一致；`setBilledPlan`/`setSalesmanPlan` 在 Step 3 列定义中引用、Step 4 中声明。
- **已知待确认点**：`Pagination` 组件 `summary` prop 存在（现有代码已用）；`TooltipContent` `side` prop 与项目用法一致（Task 9 验证步骤已提示）；`useCounterparties`（Task 4）为 Task 10 预留，当前抽屉需求未直接使用（YAGNI 权衡：保留 hook 供客商下拉后续使用，或实现时删除——以 lint 无未用告警为准）。
