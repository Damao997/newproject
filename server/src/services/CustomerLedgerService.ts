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
    const counterpartyCodes = [...new Set(rows.map((r) => r.counterpartyCode))]
    const [counterparties, plans, exts] = await Promise.all([
      counterpartyCodes.length
        ? prisma.counterparty.findMany({ where: { code: { in: counterpartyCodes } }, select: { code: true, name: true } })
        : [],
      prisma.collectionPlan.findMany({
        where: {
          ...(params.companyCodes ? { companyCode: { in: params.companyCodes } } : {}),
          accountCode: { in: arCodes.length ? arCodes : ['__NO_AR_ACCOUNT__'] },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, companyCode: true, counterpartyCode: true, status: true, plannedDate: true, method: true, actualAmount: true, statusNote: true },
      }),
      prisma.customerExt.findMany({ where: params.companyCodes ? { companyCode: { in: params.companyCodes } } : {} }),
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

    // 5. stats：全量口径（仅含关键词条件，不含状态过滤）——须在状态过滤之前计算
    const stats = {
      byStatus: Object.fromEntries(['unplanned', ...PLAN_STATUSES].map((s) => [s, 0])) as Record<string, number>,
      totalBalance: 0,
    }
    for (const r of items) {
      stats.totalBalance += r.closingBalance
      const key = r.planStatus ?? 'unplanned'
      stats.byStatus[key] = (stats.byStatus[key] ?? 0) + 1
    }

    // 6. 状态过滤 → 分页（total/pageItems 受状态过滤影响，stats 不受）
    if (status === 'unplanned') items = items.filter((r) => r.planId === null)
    else if (status) items = items.filter((r) => r.planStatus === status)

    const total = items.length
    const pageItems = items.slice((page - 1) * pageSize, page * pageSize)
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
