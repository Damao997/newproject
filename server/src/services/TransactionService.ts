import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { getFiscalStartMonth, formatPeriod, periodsInRange, fiscalYearLabel } from '../lib/period'

/**
 * 往来分析服务：六大往来总览、明细查询、账龄分析、内部往来抵消。
 * 数据来源：yingshou 分支 sync_consolidate.py 的 SSOT 汇总表逻辑。
 * 六大往来类型：应收账款(AR)、其他应收款(AR)、预收账款(AR)、应付账款(AP)、其他应付款(AP)、预付账款(AP)
 */

const AGING_BUCKETS = ['1个月', '2个月', '3个月', '4个月', '5个月', '6个月', '半年到1年', '1年到2年', '2年到3年', '3年以上'] as const

const AGING_FIELDS = ['aging1m', 'aging2m', 'aging3m', 'aging4m', 'aging5m', 'aging6m', 'aging6mTo1y', 'aging1yTo2y', 'aging2yTo3y', 'aging3yPlus'] as const

/** 账龄分析展示归集：10 段 → 5 段（半年以上 = 半年到1年段；1年至3年 = 1-2年 + 2-3年） */
const AGING_GROUP_DEFS: [string, (typeof AGING_FIELDS)[number][]][] = [
  ['1-3月', ['aging1m', 'aging2m', 'aging3m']],
  ['4-6月', ['aging4m', 'aging5m', 'aging6m']],
  ['半年以上', ['aging6mTo1y']],
  ['1年至3年', ['aging1yTo2y', 'aging2yTo3y']],
  ['3年以上', ['aging3yPlus']],
]

/** 总览固定展示顺序：应收 → 预付 → 其他应收 → 应付 → 预收 → 其他应付 */
export const OVERVIEW_TYPE_ORDER = ['应收账款', '预付账款', '其他应收款', '应付账款', '预收账款', '其他应付款']

export interface TransactionOverviewItem {
  transactionType: string
  direction: string
  totalClosingBalance: number
  totalOpeningBalance: number
  totalDebit: number
  totalCredit: number
  recordCount: number
  internalCount: number
  externalCount: number
  aging: Record<string, number>
}

export interface TransactionDetailDto {
  id: string
  companyCode: string
  companyName: string | null
  transactionType: string
  direction: string
  cutoffDate: string | null
  counterpartyCode: string
  counterpartyName: string | null
  accountCode: string
  accountDesc: string | null
  documentNo: string | null
  bookingDate: string | null
  dueDate: string | null
  agingDays: number | null
  openingBalance: number
  debitAmount: number
  creditAmount: number
  closingBalance: number
  aging: Record<string, number>
  isInternal: boolean
  internalType: string | null
  internalPeerCode: string | null
  partyType: string
  isEliminated: boolean
  isSettled: boolean
  sourceFile: string | null
}

export interface AgingSummaryRow {
  companyCode: string
  companyName: string | null
  transactionType: string
  counterpartyCode?: string
  counterpartyName?: string | null
  closingBalance: number
  aging: Record<string, number>
}

export interface InternalSummaryRow {
  companyCode: string
  internalPeerCode: string
  direction: string
  transactionType: string
  closingBalance: number
  recordCount: number
}

export interface TransactionTrendSeries {
  companyCode: string
  companyName: string | null
  points: (number | null)[]
}

export interface TransactionTrendResult {
  periods: string[]
  series: TransactionTrendSeries[]
}

/** 科目筛选选项：hasData 标识该科目当前是否有交易数据 */
export interface AccountOption {
  accountCode: string
  accountDesc: string | null
  hasData: boolean
}

// ===== 导入覆盖矩阵 =====

export type CoverageCellStatus = 'active' | 'empty' | 'draft' | 'missing'

export interface TransactionCoverageCell {
  companyCode: string
  period: string
  transactionType: string
  status: CoverageCellStatus
  recordCount: number
  draftBatchIds: string[]
}

export interface TransactionCoverageResult {
  periods: string[]
  companies: { code: string; name: string }[]
  types: string[]
  cells: TransactionCoverageCell[]
  summary: { expected: number; active: number; empty: number; draft: number; missing: number; coverageRate: number }
  draftBatches: { id: string; filename: string; createdAt: string; detailCount: number }[]
}

export interface BatchCoverageRow {
  companyCode: string
  companyName: string | null
  period: string | null
  transactionType: string
  recordCount: number
}

/** 批次 coverageJson 申报项结构（导入时由汇总表 Sheet 产出，含 0 条的空 Sheet） */
interface DeclaredCoverageItem {
  companyCode: string
  period: string
  transactionType: string
  recordCount: number
}

function parseDeclaredCoverage(coverageJson: unknown): DeclaredCoverageItem[] {
  if (!Array.isArray(coverageJson)) return []
  return coverageJson.filter((x): x is DeclaredCoverageItem => !!x && typeof x === 'object' && typeof (x as DeclaredCoverageItem).companyCode === 'string' && typeof (x as DeclaredCoverageItem).period === 'string')
}

interface ListParams {
  page?: number
  pageSize?: number
  /** 已按数据范围归一化的公司编码集合（汇总主体在路由层展开为成员） */
  companyCodes?: string[]
  transactionType?: string
  direction?: string
  counterpartyKeyword?: string
  isInternal?: boolean
  internalType?: string
  isSettled?: boolean
  minAmount?: number
  maxAmount?: number
  period?: string
  accountCodes?: string[]
  partyType?: string
}

function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0
  return Number(v) || 0
}

/** 被排除分析的科目编码（transaction_account.status='inactive'），明细/账龄查询强制剔除 */
async function getInactiveAccountCodes(): Promise<string[]> {
  const rows = await prisma.transactionAccount.findMany({ where: { status: 'inactive' }, select: { code: true } })
  return rows.map((r) => r.code)
}

function extractAging(row: Record<string, unknown>): Record<string, number> {
  const aging: Record<string, number> = {}
  AGING_BUCKETS.forEach((bucket, i) => {
    aging[bucket] = toNumber(row[AGING_FIELDS[i]])
  })
  return aging
}

function toDetailDto(row: Record<string, unknown>): TransactionDetailDto {
  return {
    id: row.id as string,
    companyCode: row.companyCode as string,
    companyName: row.companyName as string | null,
    transactionType: row.transactionType as string,
    direction: row.direction as string,
    cutoffDate: row.cutoffDate as string | null,
    counterpartyCode: row.counterpartyCode as string,
    counterpartyName: row.counterpartyName as string | null,
    accountCode: row.accountCode as string,
    accountDesc: row.accountDesc as string | null,
    documentNo: row.documentNo as string | null,
    bookingDate: row.bookingDate as string | null,
    dueDate: row.dueDate as string | null,
    agingDays: row.agingDays as number | null,
    openingBalance: toNumber(row.openingBalance),
    debitAmount: toNumber(row.debitAmount),
    creditAmount: toNumber(row.creditAmount),
    closingBalance: toNumber(row.closingBalance),
    aging: extractAging(row),
    isInternal: row.isInternal as boolean,
    internalType: row.internalType as string | null,
    internalPeerCode: row.internalPeerCode as string | null,
    partyType: (row.partyType as string | null) ?? 'external',
    isEliminated: row.isEliminated as boolean,
    isSettled: row.isSettled as boolean,
    sourceFile: row.sourceFile as string | null,
  }
}

export const TransactionService = {
  /**
   * 六大往来总览：按往来类型汇总期末余额、账龄分布、内部/外部笔数。
   * 期末余额为时点数，跨期间求和会重复累加，因此支持 period 单期过滤（前端默认传最新期间）；
   * companyCodes 多选 IN 过滤；空/未传 = 数据范围内全部公司（由 scopeContext 扩展兜底过滤）。
   */
  async getOverview(params: { companyCodes?: string[]; period?: string } = {}): Promise<TransactionOverviewItem[]> {
    const where: Record<string, unknown> = {}
    // undefined = 不加显式过滤（交由 scopeContext 扩展兜底）；空数组 = 归一化后无可见公司，应返回空集
    if (params.companyCodes) where.companyCode = { in: params.companyCodes.filter(Boolean) }
    if (params.period) where.period = params.period

    const rows = await prisma.transactionDetail.groupBy({
      by: ['transactionType', 'direction'],
      where,
      _sum: {
        closingBalance: true,
        openingBalance: true,
        debitAmount: true,
        creditAmount: true,
        aging1m: true, aging2m: true, aging3m: true, aging4m: true, aging5m: true,
        aging6m: true, aging6mTo1y: true, aging1yTo2y: true, aging2yTo3y: true, aging3yPlus: true,
      },
      _count: { id: true },
    })

    // 内部/外部分组统计
    const internalRows = await prisma.transactionDetail.groupBy({
      by: ['transactionType', 'isInternal'],
      where,
      _count: { id: true },
    })

    const internalMap = new Map<string, { internal: number; external: number }>()
    for (const r of internalRows) {
      const key = r.transactionType
      if (!internalMap.has(key)) internalMap.set(key, { internal: 0, external: 0 })
      const entry = internalMap.get(key)!
      if (r.isInternal) entry.internal = r._count.id
      else entry.external = r._count.id
    }

    const items = rows.map((r) => {
      const s = r._sum
      const ie = internalMap.get(r.transactionType) || { internal: 0, external: 0 }
      const aging: Record<string, number> = {}
      AGING_BUCKETS.forEach((bucket, i) => {
        const field = AGING_FIELDS[i]
        aging[bucket] = toNumber((s as Record<string, unknown>)[field])
      })
      return {
        transactionType: r.transactionType,
        direction: r.direction,
        totalClosingBalance: toNumber(s.closingBalance),
        totalOpeningBalance: toNumber(s.openingBalance),
        totalDebit: toNumber(s.debitAmount),
        totalCredit: toNumber(s.creditAmount),
        recordCount: r._count.id,
        internalCount: ie.internal,
        externalCount: ie.external,
        aging,
      }
    })

    // 按固定顺序排列，未知类型排末尾
    const orderOf = (t: string) => {
      const i = OVERVIEW_TYPE_ORDER.indexOf(t)
      return i < 0 ? OVERVIEW_TYPE_ORDER.length : i
    }
    return items.sort((a, b) => orderOf(a.transactionType) - orderOf(b.transactionType))
  },

  /**
   * 往来明细分页查询（固定排除零余额行，提升可读性）
   */
  async listDetails(params: ListParams) {
    const page = Math.max(params.page || 1, 1)
    const pageSize = Math.min(Math.max(params.pageSize || 20, 1), 500)
    const where: Record<string, unknown> = {}

    if (params.companyCodes) where.companyCode = { in: params.companyCodes }
    if (params.transactionType) where.transactionType = params.transactionType
    if (params.direction) where.direction = params.direction
    if (params.period) where.period = params.period
    const detailAccountCodes = (params.accountCodes ?? []).filter(Boolean)
    const inactiveCodes = await getInactiveAccountCodes()
    if (detailAccountCodes.length) where.accountCode = { in: detailAccountCodes, notIn: inactiveCodes }
    else if (inactiveCodes.length) where.accountCode = { notIn: inactiveCodes }
    if (params.isInternal !== undefined) where.isInternal = params.isInternal
    if (params.internalType) where.internalType = params.internalType
    if (params.partyType) where.partyType = params.partyType
    if (params.isSettled !== undefined) where.isSettled = params.isSettled
    if (params.counterpartyKeyword) {
      where.OR = [
        { counterpartyCode: { contains: params.counterpartyKeyword, mode: 'insensitive' } },
        { counterpartyName: { contains: params.counterpartyKeyword, mode: 'insensitive' } },
      ]
    }
    // 零余额行固定隐藏；与金额区间筛选用 AND 叠加，避免同字段条件互相覆盖
    const balanceConds: Record<string, unknown>[] = [{ closingBalance: { not: 0 } }]
    if (params.minAmount !== undefined) balanceConds.push({ closingBalance: { gte: params.minAmount } })
    if (params.maxAmount !== undefined) balanceConds.push({ closingBalance: { lte: params.maxAmount } })
    where.AND = balanceConds

    const [items, total, agg] = await Promise.all([
      prisma.transactionDetail.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        // 按期末余额倒序（从大到小），同额时按创建时间稳定排序
        orderBy: [{ closingBalance: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.transactionDetail.count({ where }),
      // 合计：与列表同一 where（含零余额隐藏/科目排除/关联方过滤），跨全部页聚合
      prisma.transactionDetail.aggregate({ where, _sum: { closingBalance: true } }),
    ])

    return {
      items: items.map((r) => toDetailDto(r as unknown as Record<string, unknown>)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      totals: { closingBalance: toNumber(agg._sum.closingBalance) },
    }
  },

  /**
   * 账龄分析：按公司×往来类型×往来对象汇总账龄分布。
   * 账龄 10 段归集为 5 段展示（1-3月 / 4-6月 / 半年以上 / 1年至3年 / 3年以上）；
   * 支持 period 单期过滤（期末余额为时点数）与科目多选；结果按期末余额倒序。
   */
  async getAgingAnalysis(params: { companyCodes?: string[]; transactionType?: string; groupBy?: 'type' | 'counterparty' | 'account'; period?: string; accountCodes?: string[]; partyType?: string }) {
    const where: Record<string, unknown> = {}
    if (params.companyCodes) where.companyCode = { in: params.companyCodes }
    if (params.transactionType) where.transactionType = params.transactionType
    if (params.period) where.period = params.period
    if (params.partyType) where.partyType = params.partyType
    const accountCodes = (params.accountCodes ?? []).filter(Boolean)
    const agingInactiveCodes = await getInactiveAccountCodes()
    if (accountCodes.length) where.accountCode = { in: accountCodes, notIn: agingInactiveCodes }
    else if (agingInactiveCodes.length) where.accountCode = { notIn: agingInactiveCodes }
    // 排除已抵消的内部往来
    where.isEliminated = false

    const groupBy = params.groupBy || 'type'
    let by: string[]
    if (groupBy === 'counterparty') {
      // partyType 由 counterpartyCode 唯一决定，加入分组键以便结果携带关联方标记（不改变分组粒度）
      by = ['companyCode', 'companyName', 'transactionType', 'counterpartyCode', 'counterpartyName', 'partyType']
    } else if (groupBy === 'account') {
      by = ['companyCode', 'companyName', 'transactionType', 'accountCode', 'accountDesc']
    } else {
      by = ['companyCode', 'companyName', 'transactionType']
    }

    const rows = await (prisma.transactionDetail.groupBy as Function)({
      by,
      where,
      _sum: {
        closingBalance: true,
        aging1m: true, aging2m: true, aging3m: true, aging4m: true, aging5m: true,
        aging6m: true, aging6mTo1y: true, aging1yTo2y: true, aging2yTo3y: true, aging3yPlus: true,
      },
    }) as Array<{ _sum: Record<string, unknown> } & Record<string, unknown>>

    const result = rows.map((r) => {
      const s = r._sum
      const aging: Record<string, number> = {}
      for (const [group, fields] of AGING_GROUP_DEFS) {
        aging[group] = Math.round(fields.reduce((sum, f) => sum + toNumber(s[f]), 0) * 100) / 100
      }
      const row: Record<string, unknown> = {
        closingBalance: toNumber(s.closingBalance),
        aging,
      }
      for (const key of by) {
        row[key] = r[key]
      }
      return row
    })
    // 按期末余额倒序（从大到小）
    return result.sort((a, b) => (b.closingBalance as number) - (a.closingBalance as number))
  },

  /**
   * 会计科目列表（供明细/账龄分析的科目多选筛选）：
   * 以 transaction_account 主数据为全集，与 transaction_detail 实际出现的科目合并，
   * 标注 hasData（是否有交易数据）；实际有数据但主数据缺失的科目也保留（防主数据滞后）。
   * 传 transactionType 时两侧同时按该往来类型过滤。排序：有数据在前，其后按科目编码升序。
   */
  async listAccounts(params: { transactionType?: string } = {}): Promise<AccountOption[]> {
    const typeWhere = params.transactionType ? { transactionType: params.transactionType } : {}
    const [masters, allMasters, details] = await Promise.all([
      prisma.transactionAccount.findMany({
        where: { status: 'active', ...typeWhere },
        select: { code: true, name: true },
        orderBy: { orderNo: 'asc' },
      }),
      // 全部主数据编码（含 inactive）：用于排除"已排除科目"，使其即便有数据也不进入筛选选项
      prisma.transactionAccount.findMany({
        where: typeWhere,
        select: { code: true },
      }),
      prisma.transactionDetail.findMany({
        where: typeWhere,
        distinct: ['accountCode'],
        select: { accountCode: true, accountDesc: true },
      }),
    ])

    const dataMap = new Map(details.map((d) => [d.accountCode, d.accountDesc]))
    const options: AccountOption[] = masters.map((m) => ({
      accountCode: m.code,
      accountDesc: m.name,
      hasData: dataMap.has(m.code),
    }))
    // 主数据未覆盖但实际存在的科目（新科目/未维护），名称取明细中的科目说明；已排除科目不纳入
    const masterCodes = new Set(allMasters.map((m) => m.code))
    for (const [code, desc] of dataMap) {
      if (!masterCodes.has(code)) options.push({ accountCode: code, accountDesc: desc, hasData: true })
    }

    return options.sort((a, b) => {
      if (a.hasData !== b.hasData) return a.hasData ? -1 : 1
      return a.accountCode.localeCompare(b.accountCode)
    })
  },

  /**
   * 科目过滤管理列表：返回全部科目主数据（含 inactive），附 hasData。
   * 供「科目过滤」Tab 配置哪些科目纳入/排除分析。
   */
  async listAccountsForManage(): Promise<{ code: string; name: string; transactionType: string; direction: string; status: string; hasData: boolean }[]> {
    const [masters, details] = await Promise.all([
      prisma.transactionAccount.findMany({
        select: { code: true, name: true, transactionType: true, direction: true, status: true },
        orderBy: [{ transactionType: 'asc' }, { orderNo: 'asc' }],
      }),
      prisma.transactionDetail.findMany({ distinct: ['accountCode'], select: { accountCode: true } }),
    ])
    const dataSet = new Set(details.map((d) => d.accountCode))
    return masters.map((m) => ({ code: m.code, name: m.name, transactionType: m.transactionType, direction: m.direction, status: m.status, hasData: dataSet.has(m.code) }))
  },

  /**
   * 切换科目纳入/排除分析状态（active/inactive）。排除后该科目在明细/账龄查询中被自动剔除。
   */
  async updateAccountStatus(code: string, status: 'active' | 'inactive', userId: string, traceId?: string): Promise<{ code: string; status: string }> {
    const existing = await prisma.transactionAccount.findUnique({ where: { code }, select: { code: true } })
    if (!existing) throw errors.notFound('科目不存在')
    const updated = await prisma.transactionAccount.update({ where: { code }, data: { status } })
    await recordAudit({ userId, module: 'transactions', action: 'update', targetId: code, detail: { action: 'account_status', status } }, traceId)
    return { code: updated.code, status: updated.status }
  },

  /** 内部往来汇总：按(本方公司, 内部对方公司, 方向, 往来类型)汇总
   */
  async getInternalSummary(companyCodes?: string[]): Promise<InternalSummaryRow[]> {
    const where: Record<string, unknown> = { isInternal: true }
    if (companyCodes) where.companyCode = { in: companyCodes }

    const rows = await prisma.transactionDetail.groupBy({
      by: ['companyCode', 'internalPeerCode', 'direction', 'transactionType'],
      where,
      _sum: { closingBalance: true },
      _count: { id: true },
    })

    return rows.map((r) => ({
      companyCode: r.companyCode,
      internalPeerCode: r.internalPeerCode || '',
      direction: r.direction,
      transactionType: r.transactionType,
      closingBalance: toNumber(r._sum.closingBalance),
      recordCount: r._count.id,
    }))
  },

  /**
   * 内部往来镜像校验：同一对内部公司 AR侧与AP侧应相抵（余额已按科目性质归一为正号，差额 = AR - AP）
   */
  async getInternalMirrorCheck(companyCodes?: string[]) {
    const summary = await this.getInternalSummary(companyCodes)
    const pairMap = new Map<string, { companyA: string; companyB: string; arAmount: number; apAmount: number }>()

    for (const row of summary) {
      const pair = [row.companyCode, row.internalPeerCode].sort()
      const key = pair.join('|')
      if (!pairMap.has(key)) {
        pairMap.set(key, { companyA: pair[0], companyB: pair[1], arAmount: 0, apAmount: 0 })
      }
      const entry = pairMap.get(key)!
      if (row.direction === 'AR') entry.arAmount += row.closingBalance
      else entry.apAmount += row.closingBalance
    }

    return Array.from(pairMap.values()).map((p) => ({
      ...p,
      difference: p.arAmount - p.apAmount,
    }))
  },

  /**
   * 导入往来数据（批量写入）
   */
  async importData(records: Array<Record<string, unknown>>, batchId: string, ctx: { userId: string; traceId?: string }) {
    if (!records.length) throw errors.badRequest('无有效数据行')

    const data = records.map((r) => ({
      batchId,
      companyCode: String(r.companyCode || ''),
      companyName: r.companyName ? String(r.companyName) : null,
      transactionType: String(r.transactionType || ''),
      direction: String(r.direction || 'AR'),
      cutoffDate: r.cutoffDate ? String(r.cutoffDate) : null,
      counterpartyCode: String(r.counterpartyCode || ''),
      counterpartyName: r.counterpartyName ? String(r.counterpartyName) : null,
      accountCode: String(r.accountCode || ''),
      accountDesc: r.accountDesc ? String(r.accountDesc) : null,
      subCode: r.subCode ? String(r.subCode) : null,
      subName: r.subName ? String(r.subName) : null,
      sourceType: r.sourceType ? String(r.sourceType) : null,
      documentNo: r.documentNo ? String(r.documentNo) : null,
      documentLineNo: r.documentLineNo ? String(r.documentLineNo) : null,
      bookingDate: r.bookingDate ? String(r.bookingDate) : null,
      dueDate: r.dueDate ? String(r.dueDate) : null,
      internalArea: r.internalArea ? String(r.internalArea) : null,
      product: r.product ? String(r.product) : null,
      productDesc: r.productDesc ? String(r.productDesc) : null,
      project: r.project ? String(r.project) : null,
      projectDesc: r.projectDesc ? String(r.projectDesc) : null,
      remark: r.remark ? String(r.remark) : null,
      agingDays: r.agingDays ? Number(r.agingDays) : null,
      openingBalance: Number(r.openingBalance) || 0,
      debitAmount: Number(r.debitAmount) || 0,
      creditAmount: Number(r.creditAmount) || 0,
      closingBalance: Number(r.closingBalance) || 0,
      aging1m: Number(r.aging1m) || 0,
      aging2m: Number(r.aging2m) || 0,
      aging3m: Number(r.aging3m) || 0,
      aging4m: Number(r.aging4m) || 0,
      aging5m: Number(r.aging5m) || 0,
      aging6m: Number(r.aging6m) || 0,
      aging6mTo1y: Number(r.aging6mTo1y) || 0,
      aging1yTo2y: Number(r.aging1yTo2y) || 0,
      aging2yTo3y: Number(r.aging2yTo3y) || 0,
      aging3yPlus: Number(r.aging3yPlus) || 0,
      agingTotal: Number(r.agingTotal) || 0,
      isInternal: Boolean(r.isInternal),
      internalType: r.internalType ? String(r.internalType) : null,
      internalPeerCode: r.internalPeerCode ? String(r.internalPeerCode) : null,
      isEliminated: Boolean(r.isEliminated),
      isSettled: Boolean(r.isSettled),
      sourceFile: r.sourceFile ? String(r.sourceFile) : null,
      period: r.period ? String(r.period) : null,
    }))

    // 分批写入，每批 500 条
    const BATCH_SIZE = 500
    let created = 0
    for (let i = 0; i < data.length; i += BATCH_SIZE) {
      const chunk = data.slice(i, i + BATCH_SIZE)
      await prisma.transactionDetail.createMany({ data: chunk, skipDuplicates: true })
      created += chunk.length
    }

    await recordAudit({
      userId: ctx.userId,
      module: 'transactions',
      action: 'import',
      targetId: batchId,
      detail: { rowCount: created },
    }, ctx.traceId)

    return { imported: created, batchId }
  },

  /**
   * 往来余额变动趋势：单一往来类型，按 公司×期间(月) 聚合期末余额（DB 侧 groupBy 求和）。
   * 期间轴三种模式（优先级依次递减）：
   *  - periodFrom + periodTo（形如 2026-04）：自定义期间范围，闭区间连续补全，跨度上限 60 个月；
   *  - fiscalYear（形如 FY2026）：完整财年轴（起始月~次年起始月前一月，共 12 个月），未来无数据月补 null；
   *  - 否则按 months：以该类型最新期间为终点回溯 months 个月（默认 12，上限 36），连续补全，缺数据月补 null。
   * companyCodes 为空时返回全部公司逐公司曲线（不再合并为「全部公司」合计线）；非空时每公司一条线。
   */
  async getTrend(params: { transactionType: string; companyCodes?: string[]; months?: number; fiscalYear?: string; periodFrom?: string; periodTo?: string }): Promise<TransactionTrendResult> {
    const companyWhere: Record<string, unknown> = { transactionType: params.transactionType }
    // undefined = 不加显式过滤（交由 scopeContext 扩展兜底）；空数组 = 归一化后无可见公司，应返回空集
    if (params.companyCodes) companyWhere.companyCode = { in: params.companyCodes.filter(Boolean) }

    let periods: string[]
    let dataWhere: Record<string, unknown>

    if (params.periodFrom && params.periodTo) {
      // 自定义期间范围：闭区间 [from, to] 连续补全，缺数据月补 null
      const from = params.periodFrom
      const to = params.periodTo
      if (!/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) throw errors.badRequest('期间格式不合法，应形如 YYYY-MM')
      if (from > to) throw errors.badRequest('开始期间不能晚于结束期间')
      const [fy, fm] = from.split('-').map(Number)
      const [ty, tm] = to.split('-').map(Number)
      const span = ty * 12 + (tm - 1) - (fy * 12 + (fm - 1)) + 1
      if (span > 60) throw errors.badRequest('自定义期间跨度不能超过 60 个月')
      periods = periodsInRange(from, to)
      dataWhere = { ...companyWhere, period: { gte: from, lte: to } }
    } else if (params.fiscalYear) {
      // 完整财年轴：起始月 ~ 次年起始月前一月（共 12 个月）
      const startYear = Number(String(params.fiscalYear).replace(/^FY/i, ''))
      if (!Number.isInteger(startYear)) throw errors.badRequest('财年格式不合法，应形如 FY2026')
      const startMonth = getFiscalStartMonth()
      const start = formatPeriod(startYear, startMonth)
      const end = formatPeriod(startYear, startMonth + 11)
      periods = periodsInRange(start, end)
      dataWhere = { ...companyWhere, period: { gte: start, lte: end } }
    } else {
      const months = Math.min(Math.max(params.months || 12, 1), 36)
      // 以该类型（含公司筛选）数据的最新期间为终点
      const latest = await prisma.transactionDetail.findFirst({
        where: { ...companyWhere, period: { not: null } },
        orderBy: { period: 'desc' },
        select: { period: true },
      })
      if (!latest?.period) return { periods: [], series: [] }
      // 期间轴：终点回溯 months-1 个月，连续补全（YYYY-MM 可字典序比较）
      const [ey, em] = latest.period.split('-').map(Number)
      const endIdx = ey * 12 + (em - 1)
      const startIdx = endIdx - (months - 1)
      const ymOf = (idx: number) => `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`
      periods = []
      for (let i = startIdx; i <= endIdx; i++) periods.push(ymOf(i))
      dataWhere = { ...companyWhere, period: { gte: periods[0], lte: latest.period } }
    }

    const rows = await prisma.transactionDetail.groupBy({
      by: ['companyCode', 'companyName', 'period'],
      where: dataWhere,
      _sum: { closingBalance: true },
    })

    // 每公司一条线（按公司编码升序）；companyCodes 为空时即全部公司逐公司曲线
    const byCompany = new Map<string, { companyName: string | null; byPeriod: Map<string, number> }>()
    for (const r of rows) {
      if (!r.period) continue
      let entry = byCompany.get(r.companyCode)
      if (!entry) {
        entry = { companyName: r.companyName, byPeriod: new Map() }
        byCompany.set(r.companyCode, entry)
      }
      entry.byPeriod.set(r.period, (entry.byPeriod.get(r.period) || 0) + toNumber(r._sum.closingBalance))
    }
    const series = [...byCompany.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([companyCode, entry]) => ({
        companyCode,
        companyName: entry.companyName,
        points: periods.map((p) => (entry.byPeriod.has(p) ? Number(entry.byPeriod.get(p)!.toFixed(2)) : null)),
      }))
    return { periods, series }
  },

  /**
   * 往来数据涉及的财年列表（倒序）：供趋势图财年筛选。
   * 由明细期间经 fiscalYearLabel 归集去重。
   */
  async listFiscalYears(): Promise<string[]> {
    const rows = await prisma.transactionDetail.findMany({ distinct: ['period'], select: { period: true } })
    const fys = new Set<string>()
    for (const r of rows) if (r.period) fys.add(fiscalYearLabel(r.period))
    return [...fys].sort((a, b) => b.localeCompare(a))
  },

  /**
   * 导入覆盖矩阵：期望集合 = active 单体公司 × 最近 months 个月 × 六大往来类型，
   * 实际状态由 transaction_detail + import_batch（含 coverageJson 申报范围）实时推导：
   * active=生效批次有明细 / empty=无明细但被生效批次申报（已导入·该期确无往来款）/
   * draft=仅草稿批次有数据或申报（已传未激活）/ missing=无任何数据。
   * 期间轴终点 = max(数据最新期间, 当前自然月)。历史批次无 coverageJson，其真空单元格仍为 missing。
   * companyCodes 为矩阵行集合（调用方按数据范围传入）：限定行集合同时使范围外公司的申报覆盖不产生单元格。
   */
  async getImportCoverage(params: { months?: number; companyCodes?: string[] } = {}): Promise<TransactionCoverageResult> {
    const months = Math.min(Math.max(params.months || 6, 1), 24)

    const [companies, activeBatches, draftBatches, latestRow] = await Promise.all([
      prisma.company.findMany({
        where: {
          entityType: 'single',
          status: 'active',
          ...(params.companyCodes ? { code: { in: params.companyCodes } } : {}),
        },
        select: { code: true, name: true },
        orderBy: { orderNo: 'asc' },
      }),
      prisma.importBatch.findMany({ where: { dataType: 'transaction', lifecycleStatus: 'active' }, select: { id: true, coverageJson: true } }),
      prisma.importBatch.findMany({
        where: { dataType: 'transaction', lifecycleStatus: 'draft' },
        select: { id: true, fileName: true, createdAt: true, detailCount: true, coverageJson: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.transactionDetail.findFirst({ where: { period: { not: null } }, orderBy: { period: 'desc' }, select: { period: true } }),
    ])

    // 期间轴：终点取 数据最新期间 与 当前自然月 的较大者，回溯 months 个月
    const now = new Date()
    const nowYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const endYm = latestRow?.period && latestRow.period > nowYm ? latestRow.period : nowYm
    const [ey, em] = endYm.split('-').map(Number)
    const endIdx = ey * 12 + (em - 1)
    const periods: string[] = []
    for (let i = endIdx - (months - 1); i <= endIdx; i++) {
      periods.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`)
    }

    const activeIds = activeBatches.map((b) => b.id)
    const draftIds = draftBatches.map((b) => b.id)
    const keyOf = (c: string, p: string, t: string) => `${c}|${p}|${t}`

    // 生效数据：三元组 → 笔数
    const activeCount = new Map<string, number>()
    if (activeIds.length > 0) {
      const rows = await prisma.transactionDetail.groupBy({
        by: ['companyCode', 'period', 'transactionType'],
        where: { batchId: { in: activeIds }, period: { in: periods } },
        _count: { id: true },
      })
      for (const r of rows) {
        if (r.period) activeCount.set(keyOf(r.companyCode, r.period, r.transactionType), r._count.id)
      }
    }

    // 草稿数据：三元组 → 批次 id 集合（明细 + 申报范围均计入）
    const draftByKey = new Map<string, Set<string>>()
    if (draftIds.length > 0) {
      const rows = await prisma.transactionDetail.findMany({
        where: { batchId: { in: draftIds }, period: { in: periods } },
        select: { companyCode: true, period: true, transactionType: true, batchId: true },
        distinct: ['companyCode', 'period', 'transactionType', 'batchId'],
      })
      for (const r of rows) {
        if (!r.period || !r.batchId) continue
        const key = keyOf(r.companyCode, r.period, r.transactionType)
        if (!draftByKey.has(key)) draftByKey.set(key, new Set())
        draftByKey.get(key)!.add(r.batchId)
      }
      for (const b of draftBatches) {
        for (const item of parseDeclaredCoverage(b.coverageJson)) {
          if (!periods.includes(item.period)) continue
          const key = keyOf(item.companyCode, item.period, item.transactionType)
          if (!draftByKey.has(key)) draftByKey.set(key, new Set())
          draftByKey.get(key)!.add(b.id)
        }
      }
    }

    // 生效批次申报范围：无明细但被申报 → 已导入·该期确无往来款
    const declaredActive = new Set<string>()
    for (const b of activeBatches) {
      for (const item of parseDeclaredCoverage(b.coverageJson)) {
        if (periods.includes(item.period)) declaredActive.add(keyOf(item.companyCode, item.period, item.transactionType))
      }
    }

    const cells: TransactionCoverageCell[] = []
    let activeCells = 0
    let emptyCells = 0
    let draftCells = 0
    for (const company of companies) {
      for (const period of periods) {
        for (const transactionType of OVERVIEW_TYPE_ORDER) {
          const key = keyOf(company.code, period, transactionType)
          const recordCount = activeCount.get(key) ?? 0
          const draftSet = draftByKey.get(key)
          let status: CoverageCellStatus = 'missing'
          if (recordCount > 0) {
            status = 'active'
            activeCells++
          } else if (declaredActive.has(key)) {
            status = 'empty'
            emptyCells++
          } else if (draftSet && draftSet.size > 0) {
            status = 'draft'
            draftCells++
          }
          cells.push({ companyCode: company.code, period, transactionType, status, recordCount, draftBatchIds: draftSet ? [...draftSet] : [] })
        }
      }
    }

    const expected = cells.length
    return {
      periods,
      companies,
      types: [...OVERVIEW_TYPE_ORDER],
      cells,
      summary: {
        expected,
        active: activeCells,
        empty: emptyCells,
        draft: draftCells,
        missing: expected - activeCells - emptyCells - draftCells,
        // 真空数据（empty）视为已完成导入
        coverageRate: expected > 0 ? Number((((activeCells + emptyCells) / expected) * 100).toFixed(1)) : 0,
      },
      draftBatches: draftBatches.map((b) => ({ id: b.id, filename: b.fileName, createdAt: b.createdAt.toISOString(), detailCount: b.detailCount })),
    }
  },

  /**
   * 批次覆盖明细：该批次包含的 (公司, 期间, 往来类型) 三元组及笔数
   */
  async getBatchCoverage(batchId: string): Promise<BatchCoverageRow[]> {
    const batch = await prisma.importBatch.findUnique({ where: { id: batchId }, select: { id: true } })
    if (!batch) throw errors.notFound('导入批次不存在')
    const rows = await prisma.transactionDetail.groupBy({
      by: ['companyCode', 'companyName', 'period', 'transactionType'],
      where: { batchId },
      _count: { id: true },
    })
    return rows
      .map((r) => ({
        companyCode: r.companyCode,
        companyName: r.companyName,
        period: r.period,
        transactionType: r.transactionType,
        recordCount: r._count.id,
      }))
      .sort((a, b) => `${a.companyCode}|${a.period}|${a.transactionType}`.localeCompare(`${b.companyCode}|${b.period}|${b.transactionType}`))
  },

  /**
   * 获取所有往来对象（去重）用于前端筛选
   */
  async listCounterparties(companyCodes?: string[]) {
    const where: Record<string, unknown> = {}
    if (companyCodes) where.companyCode = { in: companyCodes }

    const rows = await prisma.transactionDetail.findMany({
      where,
      select: { counterpartyCode: true, counterpartyName: true },
      distinct: ['counterpartyCode'],
      orderBy: { counterpartyCode: 'asc' },
      take: 1000,
    })
    return rows
  },

  /**
   * 获取最新数据截止日期
   */
  async getLatestCutoff() {
    const row = await prisma.transactionDetail.findFirst({
      where: { cutoffDate: { not: null } },
      orderBy: { cutoffDate: 'desc' },
      select: { cutoffDate: true },
    })
    return row?.cutoffDate || null
  },

  /**
   * 已导入数据的去重期间列表（倒序），供明细筛选期间下拉
   */
  async listPeriods(): Promise<string[]> {
    const rows = await prisma.transactionDetail.findMany({
      where: { period: { not: null } },
      select: { period: true },
      distinct: ['period'],
      orderBy: { period: 'desc' },
    })
    return rows.map((r) => r.period!).filter(Boolean)
  },
}
