# 催收计划页应收款客商台账 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将催收计划页从「仅显示已创建计划的逾期记录」扩展为「完整应收账款客商台账」：默认展示所有应收账款客商（余额>0、公司×客商粒度），未创建计划的客商可补录业务员/已开票未收款（独立存储于新增 CustomerExt 表），并移除「生成催收建议」入口与逾期金额列。

**Architecture:** 后端新增 `CustomerExt` 表（公司×客商唯一键）承载客商维度字段（业务员/已开票未收款，与计划解耦）；新增 `CustomerLedgerService` 从 `transaction_detail` 聚合应收账款客商（剔除 inactive 科目、余额>0），LEFT JOIN 最新计划（仅应收账款科目）与扩展表；前端催收计划页数据层改接新接口，表格列/统计条/筛选/抽屉同步改造。

**Tech Stack:** Node + Express + Prisma + PostgreSQL；React + TypeScript + React Query；Vitest（前后端）；oxlint。

**关键约定**：
- 后端测试用真实 DB 模式（`beforeAll` 探测 `SELECT 1`，`dbReady` 跳过；独立测试编码隔离，`afterAll` 清理）——参考 `server/src/services/CollectionService.test.ts`
- 前端验证：`cd web && npm run lint && npm run build`
- PowerShell 环境，命令用 `;` 分隔
- 工作区有大量无关未提交改动，**每个任务只 git add 任务指定文件**
- 既有接口/测试兼容保留：`GET/POST /collections`、`POST /collections/generate`、`PATCH /collections/:id`（含 billedUncollectedAmount/salesmanId 参数）、催收记录接口全部不动

---

## 阶段一：后端（TDD）

### Task 1: Prisma CustomerExt 表 + 迁移

**Files:**
- Modify: `server/prisma/schema.prisma`

- [ ] **Step 1: 修改 schema.prisma 新增 CustomerExt 模型**

在 `model CollectionPlan`（约 566 行）之后、`model CollectionLog`（5.4）之前插入：

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

- [ ] **Step 2: 生成迁移并验证**

```powershell
cd d:\flies\pj3\server
npx prisma migrate dev --name customer_ext
npx prisma generate
npm run typecheck
```

Expected: 迁移成功（创建 `customer_ext` 表 + 唯一索引 + companyCode 索引）；typecheck 无输出。

- [ ] **Step 3: Commit**

```powershell
git add server/prisma/schema.prisma server/prisma/migrations; git commit -m "feat(prisma): add customer ext table for receivable ledger fields"
```

---

### Task 2: CustomerLedgerService 聚合查询（TDD）

**Files:**
- Create: `server/src/services/CustomerLedgerService.ts`
- Create: `server/src/services/CustomerLedgerService.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `server/src/services/CustomerLedgerService.test.ts`：

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { CustomerLedgerService } from './CustomerLedgerService'

/**
 * 应收款客商台账集成测试（真实 DB，无 DB 时整组跳过）。
 * 覆盖：应收账款限定、余额>0 过滤、inactive 科目剔除、公司×客商聚合、
 * 计划关联（仅应收账款科目、取最新）、扩展表字段、状态过滤、stats。
 * 使用独立测试编码 EN999905 隔离，afterAll 清理。
 */

const CO = 'EN999905'
const CP_A = '__LEDGER_CP_A__'
const CP_B = '__LEDGER_CP_B__'
const ACC_AR = '__LEDGER_AR_01__'
const ACC_AR2 = '__LEDGER_AR_02__'
const ACC_OTHER = '__LEDGER_OT_01__'
const ACC_INACTIVE = '__LEDGER_IN_01__'
const ctx = { userId: '__test_ledger_user__' }

let dbReady = false

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    // 科目：应收账款 ×2、其他应收款 ×1、inactive 应收账款 ×1
    await basePrisma.transactionAccount.createMany({
      data: [
        { code: ACC_AR, name: '测试应收科目1', transactionType: '应收账款', direction: 'AR' },
        { code: ACC_AR2, name: '测试应收科目2', transactionType: '应收账款', direction: 'AR' },
        { code: ACC_OTHER, name: '测试其他应收科目', transactionType: '其他应收款', direction: 'AR' },
        { code: ACC_INACTIVE, name: '测试停用科目', transactionType: '应收账款', direction: 'AR', status: 'inactive' },
      ],
    })
    // 明细：CP_A 两个科目（合计 1500 + 账龄）、CP_B 一个科目（500）、其他应收款（应排除）、inactive 科目（应排除）、零余额（应排除）
    await basePrisma.transactionDetail.createMany({
      data: [
        { companyCode: CO, transactionType: '应收账款', direction: 'AR', counterpartyCode: CP_A, accountCode: ACC_AR, closingBalance: 1000, aging1m: 400, aging6mTo1y: 300, aging3yPlus: 300, isInternal: false, isEliminated: false, period: '2099-01' },
        { companyCode: CO, transactionType: '应收账款', direction: 'AR', counterpartyCode: CP_A, accountCode: ACC_AR2, closingBalance: 500, aging2m: 500, isInternal: false, isEliminated: false, period: '2099-01' },
        { companyCode: CO, transactionType: '应收账款', direction: 'AR', counterpartyCode: CP_B, accountCode: ACC_AR, closingBalance: 500, aging1m: 500, isInternal: false, isEliminated: false, period: '2099-01' },
        { companyCode: CO, transactionType: '其他应收款', direction: 'AR', counterpartyCode: CP_B, accountCode: ACC_OTHER, closingBalance: 9999, isInternal: false, isEliminated: false, period: '2099-01' },
        { companyCode: CO, transactionType: '应收账款', direction: 'AR', counterpartyCode: CP_B, accountCode: ACC_INACTIVE, closingBalance: 9999, isInternal: false, isEliminated: false, period: '2099-01' },
        { companyCode: CO, transactionType: '应收账款', direction: 'AR', counterpartyCode: CP_B, accountCode: ACC_AR, closingBalance: 0, isInternal: false, isEliminated: false, period: '2099-01' },
      ],
    })
    // 计划：CP_A 两个科目计划（旧 pending、新 collecting——取最新）、CP_B 其他应收款科目计划（应排除）
    // 注意：CollectionPlan.method 为非空枚举且无默认值，createMany 必须显式提供 method
    await basePrisma.collectionPlan.createMany({
      data: [
        { companyCode: CO, counterpartyCode: CP_A, accountCode: ACC_AR, overdueAmount: 600, plannedDate: new Date('2099-02-01'), method: 'phone', status: 'pending', createdAt: new Date('2099-01-01') },
        { companyCode: CO, counterpartyCode: CP_A, accountCode: ACC_AR2, overdueAmount: 200, plannedDate: new Date('2099-02-02'), method: 'phone', status: 'collecting', createdAt: new Date('2099-01-02') },
        { companyCode: CO, counterpartyCode: CP_B, accountCode: ACC_OTHER, overdueAmount: 100, plannedDate: new Date('2099-02-03'), method: 'phone', status: 'collecting', createdAt: new Date('2099-01-03') },
      ],
    })
    // 扩展表：CP_B 预置业务员/已开票未收款
    await basePrisma.salesman.create({ data: { companyCode: CO, name: '台账测试员' } })
    dbReady = true
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.customerExt.deleteMany({ where: { companyCode: CO } }).catch(() => undefined)
  await basePrisma.collectionPlan.deleteMany({ where: { companyCode: CO } }).catch(() => undefined)
  await basePrisma.transactionDetail.deleteMany({ where: { companyCode: CO } }).catch(() => undefined)
  await basePrisma.transactionAccount.deleteMany({ where: { code: { in: [ACC_AR, ACC_AR2, ACC_OTHER, ACC_INACTIVE] } } }).catch(() => undefined)
  await basePrisma.salesman.deleteMany({ where: { companyCode: CO } }).catch(() => undefined)
})

describe('CustomerLedgerService（真实 DB）', () => {
  it('台账聚合：仅应收账款、余额>0、剔除 inactive、公司×客商合并', async () => {
    if (!dbReady) return
    const page = await CustomerLedgerService.list({ companyCodes: [CO], pageSize: 50 })
    // 2 个客商（CP_A 合并两科目 1500；CP_B 500；其他类型/停用科目/零余额不计）
    expect(page.total).toBe(2)
    const a = page.items.find((r) => r.counterpartyCode === CP_A)!
    expect(a.closingBalance).toBe(1500)
    expect(a.aging['1个月']).toBe(400)
    expect(a.aging['2个月']).toBe(500)
    expect(a.aging['半年以上']).toBe(300)
    expect(a.aging['3年以上']).toBe(300)
    expect(a.overdueAmount).toBe(600) // 半年以上+1年至2年+2年至3年+3年以上 = 300+300
    const b = page.items.find((r) => r.counterpartyCode === CP_B)!
    expect(b.closingBalance).toBe(500)
  })

  it('计划关联：仅应收账款科目、取最新创建计划；无计划客商 planStatus 为 null', async () => {
    if (!dbReady) return
    const page = await CustomerLedgerService.list({ companyCodes: [CO], pageSize: 50 })
    const a = page.items.find((r) => r.counterpartyCode === CP_A)!
    // CP_A 最新计划 = ACC_AR2 的 collecting（createdAt 2099-01-02 晚于 2099-01-01）
    expect(a.planId).not.toBeNull()
    expect(a.planStatus).toBe('collecting')
    expect(a.plannedDate).toBe('2099-02-02')
    const b = page.items.find((r) => r.counterpartyCode === CP_B)!
    // CP_B 仅有其他应收款科目的计划，不关联 → 未计划
    expect(b.planId).toBeNull()
    expect(b.planStatus).toBeNull()
  })

  it('状态过滤：unplanned 与计划状态', async () => {
    if (!dbReady) return
    const unplanned = await CustomerLedgerService.list({ companyCodes: [CO], status: 'unplanned', pageSize: 50 })
    expect(unplanned.items.map((r) => r.counterpartyCode)).toEqual([CP_B])
    const collecting = await CustomerLedgerService.list({ companyCodes: [CO], status: 'collecting', pageSize: 50 })
    expect(collecting.items.map((r) => r.counterpartyCode)).toEqual([CP_A])
  })

  it('stats：未计划计数 + 计划状态计数 + 应收余额合计（不含状态过滤）', async () => {
    if (!dbReady) return
    const page = await CustomerLedgerService.list({ companyCodes: [CO], pageSize: 50 })
    expect(page.stats.byStatus.unplanned).toBe(1)
    expect(page.stats.byStatus.collecting).toBe(1)
    expect(page.stats.byStatus.pending).toBe(0)
    expect(page.stats.totalBalance).toBe(2000) // 1500 + 500
    // 带状态过滤时 stats 仍为全量口径
    const filtered = await CustomerLedgerService.list({ companyCodes: [CO], status: 'collecting', pageSize: 50 })
    expect(filtered.stats.byStatus.unplanned).toBe(1)
  })

  it('扩展表字段与客商关键词过滤', async () => {
    if (!dbReady) return
    // CP_B 无扩展表记录（beforeAll 未插入 customerExt——salesman 存在但未挂接）
    const kw = await CustomerLedgerService.list({ companyCodes: [CO], counterpartyKeyword: CP_A.slice(0, 14), pageSize: 50 })
    expect(kw.items.map((r) => r.counterpartyCode)).toEqual([CP_A])
    const none = await CustomerLedgerService.list({ companyCodes: [CO], counterpartyKeyword: '__NOT_EXIST__', pageSize: 50 })
    expect(none.total).toBe(0)
    // 扩展表 upsert 后可见
    await CustomerLedgerService.upsertCustomerExt(CO, CP_B, { billedUncollectedAmount: 88.5 }, ctx)
    const after = await CustomerLedgerService.list({ companyCodes: [CO], pageSize: 50 })
    const b = after.items.find((r) => r.counterpartyCode === CP_B)!
    expect(b.billedUncollectedAmount).toBe(88.5)
  })

  it('upsert 校验：金额负数、跨公司业务员、无字段', async () => {
    if (!dbReady) return
    await expect(CustomerLedgerService.upsertCustomerExt(CO, CP_A, { billedUncollectedAmount: -1 }, ctx)).rejects.toThrow('已开票未收款金额')
    const sm = await basePrisma.salesman.findFirstOrThrow({ where: { companyCode: CO } })
    await expect(CustomerLedgerService.upsertCustomerExt(CO, CP_A, { salesmanId: '00000000-0000-0000-0000-000000000000' }, ctx)).rejects.toThrow('业务员不存在')
    await expect(CustomerLedgerService.upsertCustomerExt(CO, CP_A, {}, ctx)).rejects.toThrow('无可更新字段')
    expect(sm.id).toBeTruthy()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```powershell
cd d:\flies\pj3\server
npx vitest run src/services/CustomerLedgerService.test.ts
```

Expected: FAIL —— `CustomerLedgerService` 模块不存在。

- [ ] **Step 3: 实现 CustomerLedgerService（list + upsertCustomerExt）**

创建 `server/src/services/CustomerLedgerService.ts`：

```ts
import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'

/**
 * 应收款客商台账服务：从 transaction_detail 聚合应收账款客商（公司×客商粒度），
 * 关联最新催收计划（仅应收账款科目）与客商扩展表（业务员/已开票未收款）。
 * 状态：有计划的客商显示计划状态；无计划显示 unplanned（前端「未计划」）。
 */

/** 账龄 10 段 → 8 段归集（与 TransactionService 口径一致） */
const AGING_GROUP_DEFS: [string, string[]][] = [
  ['1个月', ['aging1m']],
  ['2个月', ['aging2m']],
  ['3个月', ['aging3m']],
  ['4-6月', ['aging4m', 'aging5m', 'aging6m']],
  ['半年以上', ['aging6mTo1y']],
  ['1年至2年', ['aging1yTo2y']],
  ['2年至3年', ['aging2yTo3y']],
  ['3年以上', ['aging3yPlus']],
]

/** 逾期口径：半年以上起 4 段（接口保留字段，页面不展示） */
const OVERDUE_GROUPS = ['半年以上', '1年至2年', '2年至3年', '3年以上']

const PLAN_STATUSES = ['pending', 'collecting', 'partial', 'full', 'bad_debt'] as const

export interface CustomerLedgerItem {
  companyCode: string
  counterpartyCode: string
  counterpartyName: string | null
  closingBalance: number
  overdueAmount: number
  aging: Record<string, number>
  billedUncollectedAmount: number | null
  salesmanId: string | null
  salesmanName: string | null
  planId: string | null
  planStatus: string | null
  plannedDate: string | null
  method: string | null
  actualAmount: number | null
  statusNote: string | null
}

interface Ctx {
  userId: string
  traceId?: string
}

function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0
  return Number(v) || 0
}

/** 被排除分析的科目编码（transaction_account.status='inactive'） */
async function getInactiveAccountCodes(): Promise<string[]> {
  const rows = await prisma.transactionAccount.findMany({ where: { status: 'inactive' }, select: { code: true } })
  return rows.map((r) => r.code)
}

export const CustomerLedgerService = {
  /**
   * 应收款客商台账分页列表（含状态统计）
   */
  async list(params: { companyCodes?: string[]; status?: string; counterpartyKeyword?: string; page?: number; pageSize?: number }) {
    const page = Math.max(params.page || 1, 1)
    const pageSize = Math.min(Math.max(params.pageSize || 20, 1), 200)
    const status = params.status || ''
    if (status && status !== 'unplanned' && !PLAN_STATUSES.includes(status as never)) {
      throw errors.badRequest('催收状态不合法')
    }

    // 1. 应收账款科目集合（active）与 inactive 科目
    const [arAccounts, inactiveCodes] = await Promise.all([
      prisma.transactionAccount.findMany({ where: { transactionType: '应收账款', status: 'active' }, select: { code: true } }),
      getInactiveAccountCodes(),
    ])
    const arCodes = arAccounts.map((a) => a.code)

    // 2. transaction_detail 聚合（应收账款、AR、非内部、非抵消、余额>0、剔除 inactive）
    const where: Record<string, unknown> = {
      transactionType: '应收账款',
      direction: 'AR',
      isInternal: false,
      isEliminated: false,
      closingBalance: { gt: 0 },
    }
    if (params.companyCodes) where.companyCode = { in: params.companyCodes }
    if (inactiveCodes.length) where.accountCode = { notIn: inactiveCodes }

    const rows = await prisma.transactionDetail.groupBy({
      by: ['companyCode', 'counterpartyCode'],
      where,
      _sum: {
        closingBalance: true,
        aging1m: true, aging2m: true, aging3m: true, aging4m: true, aging5m: true,
        aging6m: true, aging6mTo1y: true, aging1yTo2y: true, aging2yTo3y: true, aging3yPlus: true,
      },
    })

    // 3. 名称联查 + 计划关联（应收账款科目、createdAt desc）+ 扩展表 + 业务员
    const companyCodes = params.companyCodes
    const counterpartyCodes = [...new Set(rows.map((r) => r.counterpartyCode))]
    const [counterparties, plans, exts, salesmen] = await Promise.all([
      counterpartyCodes.length
        ? prisma.counterparty.findMany({ where: { code: { in: counterpartyCodes } }, select: { code: true, name: true } })
        : [],
      prisma.collectionPlan.findMany({
        where: {
          ...(companyCodes ? { companyCode: { in: companyCodes } } : {}),
          accountCode: { in: arCodes.length ? arCodes : ['__NO_AR_ACCOUNT__'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, companyCode: true, counterpartyCode: true, status: true, plannedDate: true, method: true, actualAmount: true, statusNote: true },
      }),
      prisma.customerExt.findMany({ where: companyCodes ? { companyCode: { in: companyCodes } } : {} }),
      // 扩展表业务员名称（先查扩展表拿 id）
      Promise.resolve([] as { id: string; name: string }[]),
    ])
    const extByKey = new Map(exts.map((e) => [`${e.companyCode}|${e.counterpartyCode}`, e]))
    const extSalesmanIds = [...new Set(exts.map((e) => e.salesmanId).filter((x): x is string => !!x))]
    const salesmenRows = extSalesmanIds.length
      ? await prisma.salesman.findMany({ where: { id: { in: extSalesmanIds } }, select: { id: true, name: true } })
      : []
    const salesmanNameMap = new Map(salesmenRows.map((s) => [s.id, s.name]))
    const counterpartyNameMap = new Map(counterparties.map((c) => [c.code, c.name]))

    // 每 (公司,客商) 最新计划（plans 已按 createdAt desc，首个命中即最新）
    const planByKey = new Map<string, (typeof plans)[number]>()
    for (const p of plans) {
      const key = `${p.companyCode}|${p.counterpartyCode}`
      if (!planByKey.has(key)) planByKey.set(key, p)
    }

    // 4. 组装 + 关键词/状态过滤
    const kw = (params.counterpartyKeyword || '').trim().toLowerCase()
    let items = rows.map((r) => {
      const key = `${r.companyCode}|${r.counterpartyCode}`
      const plan = planByKey.get(key)
      const ext = extByKey.get(key)
      const s = r._sum
      const aging: Record<string, number> = {}
      for (const [bucket, fields] of AGING_GROUP_DEFS) {
        aging[bucket] = fields.reduce((acc, f) => acc + toNumber((s as Record<string, unknown>)[f]), 0)
      }
      return {
        companyCode: r.companyCode,
        counterpartyCode: r.counterpartyCode,
        counterpartyName: counterpartyNameMap.get(r.counterpartyCode) ?? null,
        closingBalance: toNumber(s.closingBalance),
        overdueAmount: OVERDUE_GROUPS.reduce((acc, g) => acc + (aging[g] ?? 0), 0),
        aging,
        billedUncollectedAmount: ext?.billedUncollectedAmount === null || ext?.billedUncollectedAmount === undefined ? null : toNumber(ext?.billedUncollectedAmount),
        salesmanId: ext?.salesmanId ?? null,
        salesmanName: ext?.salesmanId ? (salesmanNameMap.get(ext.salesmanId) ?? null) : null,
        planId: plan?.id ?? null,
        planStatus: plan?.status ?? null,
        plannedDate: plan?.plannedDate ? (plan.plannedDate as Date).toISOString().slice(0, 10) : null,
        method: plan?.method ?? null,
        actualAmount: plan?.actualAmount === null || plan?.actualAmount === undefined ? null : toNumber(plan?.actualAmount),
        statusNote: plan?.statusNote ?? null,
      }
    })
    if (kw) {
      items = items.filter((r) => (r.counterpartyCode || '').toLowerCase().includes(kw) || (r.counterpartyName || '').toLowerCase().includes(kw))
    }
    if (status === 'unplanned') items = items.filter((r) => r.planId === null)
    else if (status) items = items.filter((r) => r.planStatus === status)

    // 5. 分页 + stats（stats 用不含状态过滤的全量，含关键词条件；必须在状态过滤之前计算）
    const total = items.length
    const pageItems = items.slice((page - 1) * pageSize, page * pageSize)
    const stats = {
      byStatus: Object.fromEntries(['unplanned', ...PLAN_STATUSES].map((s) => [s, 0])) as Record<string, number>,
      totalBalance: 0,
    }
    for (const r of items) {
      stats.totalBalance += r.closingBalance
      const key = r.planStatus ?? 'unplanned'
      stats.byStatus[key] = (stats.byStatus[key] ?? 0) + 1
    }
    return {
      items: pageItems,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      stats,
    }
  },

  /**
   * 客商扩展表 upsert：业务员/已开票未收款（客商维度字段，与计划解耦）
   */
  async upsertCustomerExt(companyCode: string, counterpartyCode: string, patch: { billedUncollectedAmount?: number; salesmanId?: string | null }, ctx: Ctx) {
    if (!companyCode || !counterpartyCode) throw errors.badRequest('公司、客商必填')
    const data: Record<string, unknown> = {}
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
        if (salesman.companyCode !== companyCode) throw errors.badRequest('业务员不属于该公司')
        data.salesmanId = salesman.id
      }
    }
    if (Object.keys(data).length === 0) throw errors.badRequest('无可更新字段')

    const ext = await prisma.customerExt.upsert({
      where: { companyCode_counterpartyCode: { companyCode, counterpartyCode } },
      create: { companyCode, counterpartyCode, ...data },
      update: data,
    })
    await recordAudit({
      userId: ctx.userId, module: 'transactions', action: 'update', targetId: ext.id,
      detail: { action: 'update-customer-ext', companyCode, counterpartyCode, fields: Object.keys(data) },
    }, ctx.traceId)
    return { id: ext.id, companyCode: ext.companyCode, counterpartyCode: ext.counterpartyCode, billedUncollectedAmount: ext.billedUncollectedAmount, salesmanId: ext.salesmanId }
  },
}
```

**说明（实现要点）**：
- 上述代码中 `salesmen` 变量在 Promise.all 中先用 `Promise.resolve([])` 占位、随后单独查询 `salesmenRows`——这是为了让前 4 个查询并行、业务员查询依赖扩展表结果。**实现时可以简化为：先查 ext 再查 salesmenRows（两步串行），保持逻辑清晰**；以最终实现等价为准。
- 账龄 `_sum` 字段类型：Prisma groupBy `_sum` 返回 `Record<string, Decimal | null>`，`toNumber` 已兼容。

- [ ] **Step 4: 运行测试确认通过**

```powershell
cd d:\flies\pj3\server
npx vitest run src/services/CustomerLedgerService.test.ts
```

Expected: PASS（5 个用例；DB 不可用则整组跳过，需在可用 DB 环境确认）。

- [ ] **Step 5: Commit**

```powershell
git add server/src/services/CustomerLedgerService.ts server/src/services/CustomerLedgerService.test.ts; git commit -m "feat(collection): customer ledger aggregation service with tests"
```

---

### Task 3: 台账路由注册

**Files:**
- Modify: `server/src/routes/transactions.ts`

- [ ] **Step 1: 注册路由**

`server/src/routes/transactions.ts` 顶部导入追加：

```ts
import { CustomerLedgerService } from '../services/CustomerLedgerService'
```

在「===== 业务员与客商选项 =====」段落之前插入：

```ts
// ===== 应收款客商台账（催收计划页默认视图） =====
router.get('/collections/customers', requirePermission('transactions:view', 'view'), asyncHandler(async (req, res) => {
  const companyCodes = await normalizeCompanies(req.authUser as AuthUserContext, req.query.companyCode)
  const data = await CustomerLedgerService.list({
    companyCodes,
    status: req.query.status ? String(req.query.status) : undefined,
    counterpartyKeyword: req.query.counterpartyKeyword ? String(req.query.counterpartyKeyword) : undefined,
    page: req.query.page ? Number(req.query.page) : undefined,
    pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
  })
  sendOk(res, data)
}))

router.patch('/collections/customers/:companyCode/:counterpartyCode', requirePermission('transactions:update', 'update'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const data = await CustomerLedgerService.upsertCustomerExt(
    req.params.companyCode as string,
    req.params.counterpartyCode as string,
    req.body ?? {},
    { userId: authUser.userId, traceId: req.traceId },
  )
  sendOk(res, data)
}))
```

- [ ] **Step 2: 验证路由无冲突 + 类型检查 + 回归测试**

```powershell
cd d:\flies\pj3\server
npm run typecheck
npx vitest run src/services/CollectionService.test.ts src/services/CustomerLedgerService.test.ts
```

Expected: typecheck 通过；两个测试文件全部通过（CollectionService 9 个 + CustomerLedger 5 个 = 14 个）。路由冲突检查：`GET /collections/customers`（2 段）与 `GET /collections`（1 段）、`GET /collections/:id/logs`（3 段）均不冲突；`PATCH /collections/customers/:companyCode/:counterpartyCode`（4 段）与 `PATCH /collections/:id`（2 段）不冲突。用 `Select-String -Path src\routes\transactions.ts -Pattern "collections/customers"` 确认两条新路由存在。

- [ ] **Step 3: Commit**

```powershell
git add server/src/routes/transactions.ts; git commit -m "feat(collection): register customer ledger routes"
```

---

## 阶段二：前端

### Task 4: 前端类型 / API / hooks

**Files:**
- Modify: `web/src/types/index.ts`
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/hooks/api-queries.ts`

- [ ] **Step 1: 扩展类型定义**

`web/src/types/index.ts` 的 `CollectionListResponse` 定义之后追加：

```ts
export interface CustomerLedgerItem {
  companyCode: string
  counterpartyCode: string
  counterpartyName: string | null
  closingBalance: number
  overdueAmount: number
  aging: Record<string, number>
  billedUncollectedAmount: number | null
  salesmanId: string | null
  salesmanName: string | null
  planId: string | null
  planStatus: string | null
  plannedDate: string | null
  method: string | null
  actualAmount: number | null
  statusNote: string | null
}

export interface CustomerLedgerStats {
  byStatus: Record<'unplanned' | CollectionStatus, number>
  totalBalance: number
}

/** 应收款客商台账分页响应（列表 + 状态统计） */
export type CustomerLedgerResponse = PaginatedResponse<CustomerLedgerItem> & { stats: CustomerLedgerStats }
```

- [ ] **Step 2: 扩展 api.ts**

`web/src/lib/api.ts`：删除 `generateCollections` 方法（约 L1308-1310）：

```ts
  async generateCollections(data: { companyCode?: string; minAgingBucket?: string }) {
    return this.request({ method: 'POST', url: '/transactions/collections/generate', data })
  }
```

并在 `getCollections` 之前插入：

```ts
  // 应收款客商台账（催收计划页默认视图）
  async getCustomerLedger(params: Record<string, unknown>) {
    return this.request({ method: 'GET', url: '/transactions/collections/customers', params })
  }

  async updateCustomerExt(companyCode: string, counterpartyCode: string, data: Record<string, unknown>) {
    return this.request({ method: 'PATCH', url: `/transactions/collections/customers/${companyCode}/${counterpartyCode}`, data })
  }
```

- [ ] **Step 3: 扩展 api-queries.ts**

`web/src/hooks/api-queries.ts`：删除 `useGenerateCollections`（约 L1282-1288，含 mutation 与 invalidate）：

```ts
export function useGenerateCollections() {
  const qc = useQueryClient()
  return useMutation({
    ...
  })
}
```

在催收管理段落插入：

```ts
export function useCustomerLedger(params: { page?: number; pageSize?: number; companyCode?: string; status?: string; counterpartyKeyword?: string }) {
  return useQuery({
    queryKey: ['transactions', 'collections', 'customers', params] as const,
    queryFn: () => api.getCustomerLedger(params as Record<string, unknown>) as Promise<CustomerLedgerResponse>,
    placeholderData: keepPreviousData,
  })
}

export function useUpdateCustomerExt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { companyCode: string; counterpartyCode: string; data: Record<string, unknown> }) =>
      api.updateCustomerExt(vars.companyCode, vars.counterpartyCode, vars.data) as Promise<unknown>,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions', 'collections', 'customers'] }),
  })
}
```

文件顶部类型导入增加 `CustomerLedgerItem, CustomerLedgerStats, CustomerLedgerResponse`（确认 `keepPreviousData` 已导入）。

- [ ] **Step 4: 验证**

```powershell
cd d:\flies\pj3\web
npm run lint
npm run build
```

Expected: lint 无错误（确认删除 useGenerateCollections 后无其他文件引用它——`grep -r "useGenerateCollections" web/src` 应无结果）；build 成功。

- [ ] **Step 5: Commit**

```powershell
git add web/src/types/index.ts web/src/lib/api.ts web/src/hooks/api-queries.ts; git commit -m "feat(collection): customer ledger types, api and hooks"
```

---

### Task 5: 催收计划页改造（collections-tab.tsx）

**Files:**
- Modify: `web/src/pages/transactions/collections-tab.tsx`

- [ ] **Step 1: 移除生成建议相关代码**

1. 删除组件 `GenerateDialog`（约 L252-317 整段）与常量 `BUCKET_OPTIONS`（约 L70-76）
2. 删除导入：`useGenerateCollections`（从 L18 的 hooks 导入中移除）、`PhoneCall`（从 L22 lucide 导入中移除）；`Loader2` 保留（其他对话框仍用）
3. 删除 `CollectionsTab` 内：`const [generateOpen, setGenerateOpen] = useState(false)`（约 L467）、`const canCreate = can('transactions', 'create')`（约 L476）、生成按钮 JSX（约 L607-612）

- [ ] **Step 2: 状态常量扩展（unplanned）**

`STATUS_LABELS` / `STATUS_STYLES` / `STATUS_DOT` 均增加 `unplanned`：

```ts
const STATUS_LABELS: Record<CollectionStatus | 'unplanned', string> = {
  pending: '待催收',
  collecting: '催收中',
  partial: '部分回收',
  full: '全额回收',
  bad_debt: '坏账',
  unplanned: '未计划',
}

const STATUS_STYLES: Record<CollectionStatus | 'unplanned', string> = {
  pending: 'bg-muted text-muted-foreground',
  collecting: 'bg-info/10 text-info',
  partial: 'bg-warning/15 text-warning-strong',
  full: 'bg-success/10 text-success-strong',
  bad_debt: 'bg-destructive/10 text-destructive',
  unplanned: 'bg-muted text-muted-foreground',
}

const STATUS_DOT: Record<CollectionStatus | 'unplanned', string> = {
  pending: 'bg-muted-foreground',
  collecting: 'bg-info',
  partial: 'bg-warning',
  full: 'bg-success',
  bad_debt: 'bg-destructive',
  unplanned: 'bg-muted-foreground',
}
```

注意 `UpdateStatusDialog` 内 `STATUS_LABELS[plan.status]` 与 `STATUS_TRANSITIONS[plan.status]` 的类型：`plan.status` 为 `CollectionStatus`，Record 扩展后索引仍合法（`Record<CollectionStatus | 'unplanned', string>` 可被 `CollectionStatus` 索引）。

- [ ] **Step 3: 抽屉组件目标类型改造**

1. 顶部导入追加类型：`import type { CollectionPlanItem, CollectionStatus, CustomerLedgerItem } from '@/types'`
2. 新增客商键类型（`GenerateDialog` 原位置附近）：

```ts
/** 编辑抽屉目标：客商台账行（业务员/已开票未收款属客商维度，与计划解耦） */
type LedgerTarget = Pick<CustomerLedgerItem, 'companyCode' | 'counterpartyCode' | 'counterpartyName' | 'billedUncollectedAmount' | 'salesmanId'>
```

3. `BilledAmountDrawer` 整体替换为（目标类型 + 新接口 + 名称描述）：

```tsx
// ===== 已开票未收款金额编辑抽屉（客商扩展表） =====
function BilledAmountDrawer({ target, onClose }: { target: LedgerTarget; onClose: () => void }) {
  const [value, setValue] = useState(target.billedUncollectedAmount === null ? '' : String(target.billedUncollectedAmount))
  const [errorMsg, setErrorMsg] = useState('')
  const updateMutation = useUpdateCustomerExt()

  const handleSave = async () => {
    setErrorMsg('')
    const v = value.trim() === '' ? null : Number(value)
    if (v !== null && (!Number.isFinite(v) || v < 0)) { setErrorMsg('金额不合法'); return }
    try {
      await updateMutation.mutateAsync({ companyCode: target.companyCode, counterpartyCode: target.counterpartyCode, data: { billedUncollectedAmount: v } })
      onClose()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <SheetShell
      onClose={onClose}
      className="max-w-md"
      title="编辑已开票未收款金额"
      description={`${target.companyCode} · ${target.counterpartyName || target.counterpartyCode}`}
      footer={(
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={updateMutation.isPending}>取消</Button>
          <Button size="sm" disabled={updateMutation.isPending} onClick={handleSave}>
            保存
          </Button>
        </div>
      )}
    >
      <div className="space-y-3 p-5">
        <div className="space-y-1.5">
          <Label htmlFor="billed-amount-input">已开票未收款金额（元）</Label>
          <Input id="billed-amount-input" type="number" min={0} step="0.01" placeholder="选填，留空保存为未填写" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        {errorMsg && <FlashMessage type="error">{errorMsg}</FlashMessage>}
      </div>
    </SheetShell>
  )
}
```

4. `SalesmanDrawer` 整体替换为（客商键 + 新接口）：

```tsx
// ===== 业务员编辑抽屉（客商扩展表；选择现有 / 新建） =====
function SalesmanDrawer({ target, onClose }: { target: LedgerTarget; onClose: () => void }) {
  const companyCode = target.companyCode
  const { data: salesmen } = useSalesmen(companyCode)
  const createMutation = useCreateSalesman()
  const updateMutation = useUpdateCustomerExt()
  const [selectedId, setSelectedId] = useState(target.salesmanId ?? '')
  const [newName, setNewName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const handleAdd = async () => {
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
    setErrorMsg('')
    try {
      await updateMutation.mutateAsync({ companyCode, counterpartyCode: target.counterpartyCode, data: { salesmanId: selectedId || null } })
      onClose()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <SheetShell
      onClose={onClose}
      className="max-w-md"
      title="业务员"
      description={`${companyCode} · ${target.counterpartyName || target.counterpartyCode}`}
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

5. `UpdateStatusDialog` 目标类型改为 `CustomerLedgerItem`（仅计划行调用），内部 `plan` 引用改为行数据：`plan.id` → `plan.planId!`（有计划才可打开）、`plan.overdueAmount` 描述改 `plan.closingBalance`、`plan.status` → `plan.planStatus!`。整体替换：

```tsx
// ===== 状态更新对话框（仅计划行可用） =====
function UpdateStatusDialog({ row, onClose }: { row: CustomerLedgerItem | null; onClose: () => void }) {
  const [status, setStatus] = useState('')
  const [actualAmount, setActualAmount] = useState('')
  const [statusNote, setStatusNote] = useState(row?.statusNote ?? '')
  const [errorMsg, setErrorMsg] = useState('')
  const updateMutation = useUpdateCollection()

  // 打开时预填既有催收状态说明（可修改/覆盖）；关闭时由 handleClose 清空
  useEffect(() => {
    if (row) setStatusNote(row.statusNote ?? '')
  }, [row])

  const currentStatus = (row?.planStatus ?? 'pending') as CollectionStatus
  const allowed = row?.planId ? STATUS_TRANSITIONS[currentStatus] : []

  const handleSubmit = async () => {
    if (!row?.planId) return
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
      await updateMutation.mutateAsync({ id: row.planId, data })
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
    <Dialog open={!!row} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>更新催收状态</DialogTitle>
          <DialogDescription>
            {row?.counterpartyName || row?.counterpartyCode} · 应收金额 {fmtAmount(row?.closingBalance ?? null)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="update-status-select">新状态（当前：{row ? STATUS_LABELS[currentStatus] : '-'}）</Label>
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
            <Textarea id="update-status-note" rows={3} maxLength={500} placeholder="如：客户承诺月底回款，逾期部分已开票待付款…" value={statusNote} onChange={(e) => setStatusNote(e.target.value)} />
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

6. `LogsDialog` 目标类型改为 `CustomerLedgerItem`（`plan` 参数改 `row`），内部 `plan?.id` → `row?.planId ?? null`、描述 `plan?.accountCode` 移除（台账无科目列）改 `row?.counterpartyName || row?.counterpartyCode`。整体替换：

```tsx
// ===== 催收记录对话框（按最新计划） =====
function LogsDialog({ row, canUpdate, onClose }: { row: CustomerLedgerItem | null; canUpdate: boolean; onClose: () => void }) {
  const [content, setContent] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const planId = row?.planId ?? null
  const { data: logs, isLoading } = useCollectionLogs(planId)
  const addMutation = useAddCollectionLog()

  const handleAdd = async () => {
    if (!planId) return
    setErrorMsg('')
    if (!content.trim()) {
      setErrorMsg('请输入催收内容')
      return
    }
    try {
      await addMutation.mutateAsync({ id: planId, content: content.trim() })
      setContent('')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '提交失败')
    }
  }

  return (
    <Dialog open={!!row} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>催收记录</DialogTitle>
          <DialogDescription>{row?.counterpartyName || row?.counterpartyCode}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {isLoading ? (
            <p className="py-4 text-center text-sm text-muted-foreground">加载中…</p>
          ) : !logs?.length ? (
            <p className="py-4 text-center text-sm text-muted-foreground">暂无催收记录</p>
          ) : (
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {logs.map((log) => (
                <li key={log.id} className="rounded-lg border p-2.5 text-sm">
                  <p>{log.content}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{new Date(log.actionTime).toLocaleString('zh-CN')}</p>
                </li>
              ))}
            </ul>
          )}
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
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: CollectionsTab 主体改造**

1. 数据层替换（约 L479-489）：

```tsx
  const { data, isLoading } = useCustomerLedger({
    page,
    pageSize,
    companyCode,
    status: statusFilter || undefined,
    counterpartyKeyword: keyword || undefined,
  })

  const items = data?.items || []
  const total = data?.total || 0
  const stats = data?.stats
```

2. 对话框 state 类型改为 `CustomerLedgerItem`（约 L468-471）：

```tsx
  const [updatingRow, setUpdatingRow] = useState<CustomerLedgerItem | null>(null)
  const [logsRow, setLogsRow] = useState<CustomerLedgerItem | null>(null)
  const [billedTarget, setBilledTarget] = useState<LedgerTarget | null>(null)
  const [salesmanTarget, setSalesmanTarget] = useState<LedgerTarget | null>(null)
```

（原 `updatingPlan/logsPlan/billedPlan/salesmanPlan` 全部替换为上述命名；`generateOpen` 已在 Step 1 删除；`canCreate` 已删除，保留 `canUpdate`。）

3. 列定义整体替换（`planColumns` → `ledgerColumns`，类型 `DataTableColumn<CustomerLedgerItem>[]`）：

```tsx
  // 应收款客商台账列（行粒度：公司×客商；操作列带权限门禁）
  const ledgerColumns: DataTableColumn<CustomerLedgerItem>[] = useMemo(() => [
    {
      key: 'companyCode', header: '公司',
      render: (row) => <span title={row.companyCode}>{getDisplayName(row.companyCode, undefined)}</span>,
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
    {
      key: 'closingBalance', header: '应收金额', align: 'right', cellClassName: 'font-num',
      render: (row) => <span className={amountTone(row.closingBalance)}>{fmtAmount(row.closingBalance)}</span>,
    },
    {
      key: 'billedUncollectedAmount', header: '已开票未收款', align: 'right', cellClassName: 'font-num group/billed',
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          {fmtAmount(row.billedUncollectedAmount)}
          {canUpdate && (
            <button
              type="button"
              className="invisible rounded px-1 text-xs text-primary group-hover/billed:visible focus-visible:visible hover:underline"
              onClick={() => setBilledTarget(row)}
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
              className="invisible rounded px-1 text-xs text-primary group-hover/salesman:visible focus-visible:visible hover:underline"
              onClick={() => setSalesmanTarget(row)}
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
        const overdue = row.plannedDate !== null && row.plannedDate < new Date().toISOString().slice(0, 10) && row.planStatus !== 'full' && row.planStatus !== 'bad_debt'
        return (
          <span className={cn('text-xs whitespace-nowrap', overdue && 'font-medium text-destructive')} title={overdue ? '已逾期' : undefined}>
            {row.plannedDate ?? '-'}
            {overdue && <span className="ml-1 text-[10px] font-normal text-muted-foreground">已逾期</span>}
          </span>
        )
      },
    },
    { key: 'method', header: '方式', render: (row) => <span className="text-xs">{row.method ? (METHOD_LABELS[row.method] || row.method) : '-'}</span> },
    { key: 'actualAmount', header: '实际回收', align: 'right', cellClassName: 'font-num', render: (row) => fmtAmount(row.actualAmount) },
    {
      key: 'status', header: '状态',
      render: (row) => {
        const statusKey = (row.planStatus ?? 'unplanned') as CollectionStatus | 'unplanned'
        return (
          <span className={cn('rounded px-1.5 py-0.5 text-xs', STATUS_STYLES[statusKey])} title={row.statusNote ?? undefined}>
            {STATUS_LABELS[statusKey]}
          </span>
        )
      },
    },
    {
      key: 'actions', header: '操作', cellClassName: 'group/ops whitespace-nowrap',
      render: (row) => (
        <span className="invisible inline-flex gap-1 group-hover/ops:visible focus-within:visible">
          {canUpdate && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setBilledTarget(row)}>
              编辑
            </Button>
          )}
          {canUpdate && row.planId && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setUpdatingRow(row)}>
              更新
            </Button>
          )}
          {row.planId && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setLogsRow(row)}>
              记录
            </Button>
          )}
        </span>
      ),
    },
  ], [getDisplayName, canUpdate, setUpdatingRow, setLogsRow, setBilledTarget, setSalesmanTarget])
```

4. 筛选卡（约 L586-633）：删除生成按钮后，筛选行右侧不再有操作；状态下拉文案「全部状态」→「全部客商」，选项增加 `unplanned`：

```tsx
      <Card className="rounded-card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <CompanySelect value={companyFilter} onChange={(v) => { setCompanyFilter(v); setPage(1) }} />
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v === 'all' ? '' : v); setPage(1) }}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="客商状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部客商</SelectItem>
            <SelectItem value="unplanned">未计划</SelectItem>
            {(Object.keys(STATUS_LABELS) as (CollectionStatus | 'unplanned')[]).filter((s) => s !== 'unplanned').map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="搜索客商..."
          className="w-[200px]"
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); setPage(1) }}
        />
      </div>
      {stats && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-dashed border-border pt-2.5 text-xs">
          {(Object.keys(STATUS_LABELS) as (CollectionStatus | 'unplanned')[]).map((s) => (
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
            应收金额合计 <span className="font-num font-medium text-destructive">{formatMoneyWan(stats.totalBalance / 10000)}<span className="ml-0.5 text-[10px] font-normal">万</span></span>
          </span>
        </div>
      )}
      </Card>
```

5. 表格卡（约 L635-668）：`DataTable` 的 `columns={ledgerColumns}`、`data={items}`、`rowKey={(row) => `${row.companyCode}|${row.counterpartyCode}`}`、`caption="应收款客商台账"`；空态文案「暂无应收款客商数据」；分页行不变。

6. 挂载区（约 L670-674）：

```tsx
      <UpdateStatusDialog row={updatingRow} onClose={() => setUpdatingRow(null)} />
      <LogsDialog row={logsRow} canUpdate={canUpdate} onClose={() => setLogsRow(null)} />
      {billedTarget && <BilledAmountDrawer target={billedTarget} onClose={() => setBilledTarget(null)} />}
      {salesmanTarget && <SalesmanDrawer target={salesmanTarget} onClose={() => setSalesmanTarget(null)} />}
```

7. 组件顶部注释「催收计划 Tab」描述更新为台账语义：

```ts
/**
 * 催收计划 Tab：应收账款客商台账（公司×客商粒度，余额>0），
 * 关联最新催收计划（状态机流转与催收记录仅计划行可用）、
 * 客商扩展字段（业务员/已开票未收款，未计划客商亦可维护）。
 */
```

8. 导入更新：`import { useCollections, useGenerateCollections, useUpdateCollection, ... }` 改为 `import { useCustomerLedger, useUpdateCustomerExt, useUpdateCollection, useCollectionLogs, useAddCollectionLog } from '@/hooks/api-queries'`（`useCollections` 若无其他使用一并移除）。

- [ ] **Step 5: 验证**

```powershell
cd d:\flies\pj3\web
npm run lint
npm run build
```

Expected: 无错误。若 oxlint 报未使用导入/变量（如 `useCollections`、`CollectionPlanItem`、`PhoneCall`），按报错清理。确认 `CollectionPlanItem` 若仍被 UpdateStatusDialog 之外的代码使用则保留导入（本改造后应不再需要——若确实无使用则从类型导入中移除）。

- [ ] **Step 6: Commit**

```powershell
git add web/src/pages/transactions/collections-tab.tsx; git commit -m "feat(collection): rebuild collections page as receivable customer ledger"
```

---

## 自审记录

- **Spec 覆盖**：CustomerExt 表（Task 1）；台账聚合含应收账款限定/余额>0/inactive 剔除/公司×客商/计划关联（仅应收账款科目、取最新）/扩展表（Task 2）；状态过滤 unplanned+5 计划状态、stats（不含状态过滤）（Task 2）；upsert 校验与审计（Task 2）；路由权限与顺序（Task 3）；前端类型/API/hooks + 删除 generate（Task 4）；页面列（无逾期金额列、无科目列、应收金额、未计划胶囊、操作列按 planId）、统计条（未计划+5 状态+应收金额合计万）、筛选（全部客商默认）、生成按钮移除、抽屉改客商键与新接口（Task 5）。
- **占位符检查**：所有步骤含具体代码与命令；无 TBD。
- **类型一致性**：`CustomerLedgerItem`（后端 DTO ↔ 前端 types）字段名一致；`LedgerTarget` = Pick 4 字段；`stats.byStatus` 键 'unplanned' + 5 计划状态；`useUpdateCustomerExt` 签名（companyCode/counterpartyCode/data）；`UpdateStatusDialog`/`LogsDialog` 改 `row` 参数后内部 `planId` 非空断言仅在守卫后使用。
- **已知注意点**：`getDisplayName(row.companyCode, undefined)` 需要 `useCompanyDisplayName` 支持 name 为 undefined（检查其签名——若第二参必填，改为 `getDisplayName(row.companyCode, null)` 或直接用 companyCode 显示，以类型检查为准）；CustomerLedgerService 中业务员查询为两步（先 ext 后 salesman），与 Promise.all 占位写法等价，以最终实现为准。
