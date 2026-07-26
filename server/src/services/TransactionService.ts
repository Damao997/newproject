import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'

/**
 * 往来分析服务：六大往来总览、明细查询、账龄分析、内部往来抵消。
 * 数据来源：yingshou 分支 sync_consolidate.py 的 SSOT 汇总表逻辑。
 * 六大往来类型：应收账款(AR)、其他应收款(AR)、预收账款(AR)、应付账款(AP)、其他应付款(AP)、预付账款(AP)
 */

const AGING_BUCKETS = ['1个月', '2个月', '3个月', '4个月', '5个月', '6个月', '半年到1年', '1年到2年', '2年到3年', '3年以上'] as const

const AGING_FIELDS = ['aging1m', 'aging2m', 'aging3m', 'aging4m', 'aging5m', 'aging6m', 'aging6mTo1y', 'aging1yTo2y', 'aging2yTo3y', 'aging3yPlus'] as const

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

interface ListParams {
  page?: number
  pageSize?: number
  companyCode?: string
  transactionType?: string
  direction?: string
  counterpartyKeyword?: string
  isInternal?: boolean
  internalType?: string
  isSettled?: boolean
  minAmount?: number
  maxAmount?: number
}

function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0
  return Number(v) || 0
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
    isEliminated: row.isEliminated as boolean,
    isSettled: row.isSettled as boolean,
    sourceFile: row.sourceFile as string | null,
  }
}

export const TransactionService = {
  /**
   * 六大往来总览：按往来类型汇总期末余额、账龄分布、内部/外部笔数
   */
  async getOverview(companyCode?: string): Promise<TransactionOverviewItem[]> {
    const where: Record<string, unknown> = {}
    if (companyCode) where.companyCode = companyCode

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

    return rows.map((r) => {
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
  },

  /**
   * 往来明细分页查询
   */
  async listDetails(params: ListParams) {
    const page = Math.max(params.page || 1, 1)
    const pageSize = Math.min(Math.max(params.pageSize || 20, 1), 500)
    const where: Record<string, unknown> = {}

    if (params.companyCode) where.companyCode = params.companyCode
    if (params.transactionType) where.transactionType = params.transactionType
    if (params.direction) where.direction = params.direction
    if (params.isInternal !== undefined) where.isInternal = params.isInternal
    if (params.internalType) where.internalType = params.internalType
    if (params.isSettled !== undefined) where.isSettled = params.isSettled
    if (params.counterpartyKeyword) {
      where.OR = [
        { counterpartyCode: { contains: params.counterpartyKeyword, mode: 'insensitive' } },
        { counterpartyName: { contains: params.counterpartyKeyword, mode: 'insensitive' } },
      ]
    }
    if (params.minAmount !== undefined || params.maxAmount !== undefined) {
      where.closingBalance = {}
      if (params.minAmount !== undefined) (where.closingBalance as Record<string, unknown>).gte = params.minAmount
      if (params.maxAmount !== undefined) (where.closingBalance as Record<string, unknown>).lte = params.maxAmount
    }

    const [items, total] = await Promise.all([
      prisma.transactionDetail.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.transactionDetail.count({ where }),
    ])

    return {
      items: items.map((r) => toDetailDto(r as unknown as Record<string, unknown>)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  },

  /**
   * 账龄分析：按公司×往来类型×往来对象汇总账龄分布
   */
  async getAgingAnalysis(params: { companyCode?: string; transactionType?: string; groupBy?: 'type' | 'counterparty' | 'account' }) {
    const where: Record<string, unknown> = {}
    if (params.companyCode) where.companyCode = params.companyCode
    if (params.transactionType) where.transactionType = params.transactionType
    // 排除已抵消的内部往来
    where.isEliminated = false

    const groupBy = params.groupBy || 'type'
    let by: string[]
    if (groupBy === 'counterparty') {
      by = ['companyCode', 'companyName', 'transactionType', 'counterpartyCode', 'counterpartyName']
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

    return rows.map((r) => {
      const s = r._sum
      const aging: Record<string, number> = {}
      AGING_BUCKETS.forEach((bucket, i) => {
        aging[bucket] = toNumber(s[AGING_FIELDS[i]])
      })
      const row: Record<string, unknown> = {
        closingBalance: toNumber(s.closingBalance),
        aging,
      }
      for (const key of by) {
        row[key] = r[key]
      }
      return row
    })
  },

  /**
   * 内部往来汇总：按(本方公司, 内部对方公司, 方向, 往来类型)汇总
   */
  async getInternalSummary(companyCode?: string): Promise<InternalSummaryRow[]> {
    const where: Record<string, unknown> = { isInternal: true }
    if (companyCode) where.companyCode = companyCode

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
   * 内部往来镜像校验：同一对内部公司 AR侧+AP侧应≈0
   */
  async getInternalMirrorCheck(companyCode?: string) {
    const summary = await this.getInternalSummary(companyCode)
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
      difference: p.arAmount + p.apAmount,
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
   * 获取所有往来对象（去重）用于前端筛选
   */
  async listCounterparties(companyCode?: string) {
    const where: Record<string, unknown> = {}
    if (companyCode) where.companyCode = companyCode

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
}
