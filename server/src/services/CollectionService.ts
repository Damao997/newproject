import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { assertCompaniesInScope } from '../lib/scope-guard'

/**
 * 催收管理服务：催收建议生成、催收计划 CRUD 与状态机流转、催收记录。
 * 数据来源：transaction_detail（AR 方向、外部客商、期末余额为正且存在逾期账龄段）。
 * 状态机：pending → collecting → partial | full | bad_debt；partial → full | bad_debt；full/bad_debt 为终态。
 */

const AGING_FIELDS = ['aging1m', 'aging2m', 'aging3m', 'aging4m', 'aging5m', 'aging6m', 'aging6mTo1y', 'aging1yTo2y', 'aging2yTo3y', 'aging3yPlus'] as const

/** 逾期起算账龄段 → AGING_FIELDS 起始下标（该段及之后计为逾期） */
const OVERDUE_BUCKET_START: Record<string, number> = {
  '1m': 1, // 1个月以上（2个月段起）
  '3m': 3, // 3个月以上
  '6m': 6, // 半年以上（半年到1年段起）
  '1y': 7, // 1年以上
  '2y': 8, // 2年以上
}

const COLLECTION_STATUSES = ['pending', 'collecting', 'partial', 'full', 'bad_debt'] as const
type CollectionStatusValue = (typeof COLLECTION_STATUSES)[number]

/** 合法状态流转表（不含自身；full/bad_debt 终态） */
const STATUS_TRANSITIONS: Record<CollectionStatusValue, CollectionStatusValue[]> = {
  pending: ['collecting'],
  collecting: ['partial', 'full', 'bad_debt'],
  partial: ['full', 'bad_debt'],
  full: [],
  bad_debt: [],
}

const COLLECTION_METHODS = ['phone', 'letter', 'legal'] as const

function toNumber(v: unknown): number {
  if (v === null || v === undefined) return 0
  return Number(v) || 0
}

/**
 * 批量回查业务员归属公司集合（SalesmanCompany 与 Salesman 未定义 Prisma 关系，直接查关联表）。
 * 返回 salesmanId → companyCode[]；无关联返回空 Map。
 */
async function buildSalesmanCompanyMap(salesmanIds: string[]) {
  const map = new Map<string, string[]>()
  if (salesmanIds.length === 0) return map
  const rels = await prisma.salesmanCompany.findMany({
    where: { salesmanId: { in: salesmanIds } },
    select: { salesmanId: true, companyCode: true },
  })
  for (const r of rels) {
    const arr = map.get(r.salesmanId)
    if (arr) arr.push(r.companyCode)
    else map.set(r.salesmanId, [r.companyCode])
  }
  return map
}

/**
 * 按公司编码集合取业务员 id（包含语义：归属任一目标公司的业务员命中）。
 * 无公司过滤时返回 null（调用方不施加过滤）。
 */
async function salesmanIdsByCompanies(companyCodes: string[]) {
  if (!companyCodes || companyCodes.length === 0) return null
  const rels = await prisma.salesmanCompany.findMany({
    where: { companyCode: { in: companyCodes } },
    select: { salesmanId: true },
  })
  return [...new Set(rels.map((r) => r.salesmanId))]
}

export interface CollectionPlanDto {
  id: string
  companyCode: string
  companyName: string | null
  counterpartyCode: string
  counterpartyName: string | null
  accountCode: string
  overdueAmount: number
  plannedDate: string
  collectorId: string | null
  method: string
  expectedAmount: number | null
  actualAmount: number | null
  status: string
  remark: string | null
  billedUncollectedAmount: number | null
  salesmanId: string | null
  salesmanName: string | null
  statusNote: string | null
  createdAt: string
}

export interface CollectionLogDto {
  id: string
  planId: string
  actionTime: string
  actionBy: string | null
  content: string
  attachmentUrl: string | null
}

interface ListParams {
  page?: number
  pageSize?: number
  /** 已按数据范围归一化的公司编码集合（汇总主体在路由层展开为成员） */
  companyCodes?: string[]
  status?: string
  counterpartyKeyword?: string
}

interface Ctx {
  userId: string
  traceId?: string
}

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

export const CollectionService = {
  /**
   * 从账龄数据批量生成催收建议：仅限债权类应收（应收账款/其他应收款，排除贷方性质的预收）、
   * 外部客商、期末余额>0 且指定账龄段及以上有逾期金额，
   * 按 (公司, 客商, 科目) 聚合逾期金额幂等创建（同键存在非终态计划则跳过）。
   */
  async generateSuggestions(params: { companyCodes?: string[]; minAgingBucket?: string }, ctx: Ctx) {
    const bucketKey = params.minAgingBucket || '6m'
    const startIdx = OVERDUE_BUCKET_START[bucketKey]
    if (startIdx === undefined) throw errors.badRequest('逾期起算账龄段不合法（可选 1m/3m/6m/1y/2y）')
    const overdueFields = AGING_FIELDS.slice(startIdx)

    const where: Record<string, unknown> = {
      direction: 'AR',
      // 预收账款为贷方性质负债（符号归一后为正），不属于催收对象，需显式排除
      transactionType: { in: ['应收账款', '其他应收款'] },
      isInternal: false,
      isEliminated: false,
      closingBalance: { gt: 0 },
    }
    if (params.companyCodes) where.companyCode = { in: params.companyCodes }

    const rows = await prisma.transactionDetail.findMany({
      where,
      select: {
        companyCode: true, counterpartyCode: true, accountCode: true,
        aging1m: true, aging2m: true, aging3m: true, aging4m: true, aging5m: true,
        aging6m: true, aging6mTo1y: true, aging1yTo2y: true, aging2yTo3y: true, aging3yPlus: true,
      },
    })

    // 按 (公司, 客商, 科目) 聚合逾期金额
    const grouped = new Map<string, { companyCode: string; counterpartyCode: string; accountCode: string; overdue: number }>()
    for (const r of rows) {
      const overdue = overdueFields.reduce((s, f) => s + toNumber((r as Record<string, unknown>)[f]), 0)
      if (overdue <= 0) continue
      const key = `${r.companyCode}|${r.counterpartyCode}|${r.accountCode}`
      const entry = grouped.get(key)
      if (entry) entry.overdue += overdue
      else grouped.set(key, { companyCode: r.companyCode, counterpartyCode: r.counterpartyCode, accountCode: r.accountCode, overdue })
    }

    if (grouped.size === 0) return { created: 0, skipped: 0 }

    // 幂等：同键已有非终态计划则跳过
    const candidates = [...grouped.values()]
    const existing = await prisma.collectionPlan.findMany({
      where: {
        status: { in: ['pending', 'collecting', 'partial'] },
        OR: candidates.map((c) => ({ companyCode: c.companyCode, counterpartyCode: c.counterpartyCode, accountCode: c.accountCode })),
      },
      select: { companyCode: true, counterpartyCode: true, accountCode: true },
    })
    const existingKeys = new Set(existing.map((e) => `${e.companyCode}|${e.counterpartyCode}|${e.accountCode}`))

    const plannedDate = new Date()
    plannedDate.setDate(plannedDate.getDate() + 7)
    const toCreate = candidates
      .filter((c) => !existingKeys.has(`${c.companyCode}|${c.counterpartyCode}|${c.accountCode}`))
      .map((c) => ({
        companyCode: c.companyCode,
        counterpartyCode: c.counterpartyCode,
        accountCode: c.accountCode,
        overdueAmount: Number(c.overdue.toFixed(2)),
        plannedDate,
        method: 'phone' as const,
        expectedAmount: Number(c.overdue.toFixed(2)),
        status: 'pending' as const,
        remark: `系统生成（逾期账龄 ${bucketKey} 及以上）`,
      }))

    if (toCreate.length > 0) {
      await prisma.collectionPlan.createMany({ data: toCreate })
    }
    await recordAudit({
      userId: ctx.userId, module: 'transactions', action: 'create', targetId: null,
      detail: { action: 'generate-collections', minAgingBucket: bucketKey, created: toCreate.length, skipped: candidates.length - toCreate.length },
    }, ctx.traceId)

    return { created: toCreate.length, skipped: candidates.length - toCreate.length }
  },

  /**
   * 催收计划分页列表（联查公司/客商名称）
   */
  async list(params: ListParams) {
    const page = Math.max(params.page || 1, 1)
    const pageSize = Math.min(Math.max(params.pageSize || 20, 1), 200)
    const where: Record<string, unknown> = {}
    if (params.companyCodes) where.companyCode = { in: params.companyCodes }
    if (params.status) {
      if (!COLLECTION_STATUSES.includes(params.status as CollectionStatusValue)) throw errors.badRequest('催收状态不合法')
      where.status = params.status
    }
    if (params.counterpartyKeyword) {
      // 关键词先在客商主数据中匹配名称，再回填编码过滤
      const matched = await prisma.counterparty.findMany({
        where: { OR: [
          { code: { contains: params.counterpartyKeyword, mode: 'insensitive' } },
          { name: { contains: params.counterpartyKeyword, mode: 'insensitive' } },
        ] },
        select: { code: true },
        take: 500,
      })
      where.counterpartyCode = { in: matched.map((m) => m.code) }
    }

    // 状态统计使用不含状态筛选的条件（统计条为全状态总览，点击筛选后其余状态计数不应归零）
    const statsWhere: Record<string, unknown> = { ...where }
    delete statsWhere.status
    const [items, total, statusRows] = await Promise.all([
      prisma.collectionPlan.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' } }),
      prisma.collectionPlan.count({ where }),
      prisma.collectionPlan.groupBy({ by: ['status'], where: statsWhere, _count: { id: true }, _sum: { overdueAmount: true } }),
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
  },

  /**
   * 业务员选项列表（按公司过滤；仅 active——停用业务员不再可选，历史关联保留）
   */
  async listSalesmen(params: { companyCodes?: string[] }) {
    const where: Record<string, unknown> = { status: 'active' }
    const matchedIds = await salesmanIdsByCompanies(params.companyCodes ?? [])
    if (matchedIds !== null) where.id = { in: matchedIds }
    const rows = await prisma.salesman.findMany({ where, orderBy: { createdAt: 'desc' } })
    const companyMap = await buildSalesmanCompanyMap(rows.map((s) => s.id))
    return rows.map((s) => ({ id: s.id, companyCodes: companyMap.get(s.id) ?? [], name: s.name, phone: s.phone, remark: s.remark }))
  },

  /**
   * 新建业务员（姓名必填，联系方式选填）
   */
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

  /**
   * 业务员管理列表（分页 + 姓名/电话关键词 + 公司 + 状态筛选；status 空/''/'all' 不过滤）
   */
  async listSalesmenManage(params: { companyCodes?: string[]; keyword?: string; status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(params.page || 1, 1)
    const pageSize = Math.min(Math.max(params.pageSize || 20, 1), 200)
    const where: Record<string, unknown> = {}
    const matchedIds = await salesmanIdsByCompanies(params.companyCodes ?? [])
    if (matchedIds !== null) where.id = { in: matchedIds }
    const kw = (params.keyword || '').trim()
    if (kw) {
      where.OR = [
        { name: { contains: kw, mode: 'insensitive' } },
        { phone: { contains: kw, mode: 'insensitive' } },
      ]
    }
    const status = params.status || ''
    if (status && status !== 'all') {
      if (status !== 'active' && status !== 'inactive') throw errors.badRequest('业务员状态不合法')
      where.status = status
    }
    const [items, total] = await Promise.all([
      prisma.salesman.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' } }),
      prisma.salesman.count({ where }),
    ])
    const companyMap = await buildSalesmanCompanyMap(items.map((s) => s.id))
    return {
      items: items.map((s) => ({ id: s.id, companyCodes: companyMap.get(s.id) ?? [], name: s.name, phone: s.phone, remark: s.remark, status: s.status, createdAt: s.createdAt.toISOString() })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  },

  /**
   * 编辑业务员：姓名/电话/备注；公司归属集合可编辑（整集合替换）
   */
  async updateSalesman(id: string, patch: { name?: string; phone?: string; remark?: string; companyCodes?: string[] }, ctx: Ctx) {
    const salesman = await prisma.salesman.findUnique({ where: { id } })
    if (!salesman) throw errors.notFound('业务员不存在')
    // 数据范围守卫：现有归属公司必须在当前用户数据范围内（修改影响该业务员全部关联）
    const existing = await prisma.salesmanCompany.findMany({ where: { salesmanId: id }, select: { companyCode: true } })
    await assertCompaniesInScope(existing.map((c) => c.companyCode), undefined, '修改业务员')
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
    let companyCodes: string[] | null = null
    if (patch.companyCodes !== undefined) {
      companyCodes = [...new Set(patch.companyCodes)]
      if (companyCodes.length === 0) throw errors.badRequest('请选择所属公司')
      // 数据范围守卫：目标归属公司也须在范围内
      await assertCompaniesInScope(companyCodes, undefined, '修改业务员')
    }
    if (Object.keys(data).length === 0 && companyCodes === null) throw errors.badRequest('无可更新字段')
    // 写入（事务内完成普通字段更新 + 公司集合整集合替换）
    await prisma.$transaction(async (tx) => {
      if (Object.keys(data).length > 0) await tx.salesman.update({ where: { id }, data: data as never })
      if (companyCodes !== null) {
        await tx.salesmanCompany.deleteMany({ where: { salesmanId: id } })
        await tx.salesmanCompany.createMany({ data: companyCodes.map((c) => ({ salesmanId: id, companyCode: c })) })
      }
    })
    const updated = await prisma.salesman.findUniqueOrThrow({ where: { id } })
    const updatedCompanyCodes = companyCodes ?? existing.map((c) => c.companyCode)
    await recordAudit({ userId: ctx.userId, module: 'transactions', action: 'update', targetId: id, detail: { action: 'update-salesman', fields: Object.keys(data) } }, ctx.traceId)
    return { id: updated.id, companyCodes: updatedCompanyCodes, name: updated.name, phone: updated.phone, remark: updated.remark, status: updated.status }
  },

  /**
   * 停用/启用业务员（软删除：历史关联 customer_ext/collection_plan 的 salesmanId 保留）
   */
  async setSalesmanStatus(id: string, status: 'active' | 'inactive', ctx: Ctx) {
    const salesman = await prisma.salesman.findUnique({ where: { id } })
    if (!salesman) throw errors.notFound('业务员不存在')
    // 数据范围守卫：全部归属公司必须在当前用户数据范围内（影响该业务员全部关联）
    const companies = await prisma.salesmanCompany.findMany({ where: { salesmanId: id }, select: { companyCode: true } })
    await assertCompaniesInScope(companies.map((c) => c.companyCode), undefined, '停用/启用业务员')
    if (status !== 'active' && status !== 'inactive') throw errors.badRequest('业务员状态不合法')
    const updated = await prisma.salesman.update({ where: { id }, data: { status } })
    await recordAudit({ userId: ctx.userId, module: 'transactions', action: 'update', targetId: id, detail: { action: 'set-salesman-status', status } }, ctx.traceId)
    return { id: updated.id, companyCodes: companies.map((c) => c.companyCode), name: updated.name, phone: updated.phone, remark: updated.remark, status: updated.status }
  },

  /**
   * 客商选项（按公司过滤 + 关键词模糊匹配 code/name，供编辑抽屉选择）
   */
  async listCounterparties(params: { companyCodes?: string[]; keyword?: string }) {
    // 只展示有效客商，停用客商不出现在选项中
    const where: Record<string, unknown> = { status: 'active' }
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

  /**
   * 手工创建催收计划
   */
  async create(input: { companyCode: string; counterpartyCode: string; accountCode: string; overdueAmount: number; plannedDate: string; method?: string; expectedAmount?: number; remark?: string }, ctx: Ctx) {
    if (!input.companyCode || !input.counterpartyCode || !input.accountCode) throw errors.badRequest('公司、客商、科目必填')
    const overdueAmount = Number(input.overdueAmount)
    if (!Number.isFinite(overdueAmount) || overdueAmount <= 0) throw errors.badRequest('逾期金额必须为正数')
    const plannedDate = new Date(input.plannedDate)
    if (Number.isNaN(plannedDate.getTime())) throw errors.badRequest('计划催收日期不合法')
    const method = input.method || 'phone'
    if (!COLLECTION_METHODS.includes(method as never)) throw errors.badRequest('催收方式不合法（phone/letter/legal）')
    // 数据范围守卫：目标公司必须在当前用户数据范围内（防跨公司伪造催收计划）
    await assertCompaniesInScope([input.companyCode], undefined, '新增催收计划')

    const plan = await prisma.collectionPlan.create({
      data: {
        companyCode: input.companyCode,
        counterpartyCode: input.counterpartyCode,
        accountCode: input.accountCode,
        overdueAmount: Number(overdueAmount.toFixed(2)),
        plannedDate,
        method: method as never,
        expectedAmount: input.expectedAmount !== undefined ? Number(Number(input.expectedAmount).toFixed(2)) : null,
        remark: input.remark || null,
      },
    })
    await recordAudit({ userId: ctx.userId, module: 'transactions', action: 'create', targetId: plan.id, detail: { action: 'create-collection' } }, ctx.traceId)
    const names = await buildNameMaps([plan])
    return toPlanDto(plan as unknown as Record<string, unknown>, names)
  },

  /**
   * 更新催收计划：状态流转按状态机校验；可同步更新实际回收金额等字段
   */
  async update(id: string, patch: { status?: string; actualAmount?: number; expectedAmount?: number; plannedDate?: string; method?: string; collectorId?: string; remark?: string; billedUncollectedAmount?: number; salesmanId?: string | null; statusNote?: string }, ctx: Ctx) {
    const plan = await prisma.collectionPlan.findUnique({ where: { id } })
    if (!plan) throw errors.notFound('催收计划不存在')
    // 数据范围守卫：计划归属公司必须在当前用户数据范围内（防跨公司篡改）
    await assertCompaniesInScope([plan.companyCode], undefined, '修改催收计划')

    const data: Record<string, unknown> = {}
    if (patch.status !== undefined && patch.status !== plan.status) {
      if (!COLLECTION_STATUSES.includes(patch.status as CollectionStatusValue)) throw errors.badRequest('催收状态不合法')
      const allowed = STATUS_TRANSITIONS[plan.status as CollectionStatusValue] ?? []
      if (!allowed.includes(patch.status as CollectionStatusValue)) {
        throw errors.badRequest(`状态不可从 ${plan.status} 流转为 ${patch.status}`)
      }
      data.status = patch.status
    }
    if (patch.actualAmount !== undefined) {
      const v = Number(patch.actualAmount)
      if (!Number.isFinite(v) || v < 0) throw errors.badRequest('实际回收金额不合法')
      data.actualAmount = Number(v.toFixed(2))
    }
    if (patch.expectedAmount !== undefined) {
      const v = Number(patch.expectedAmount)
      if (!Number.isFinite(v) || v < 0) throw errors.badRequest('预计回收金额不合法')
      data.expectedAmount = Number(v.toFixed(2))
    }
    if (patch.plannedDate !== undefined) {
      const d = new Date(patch.plannedDate)
      if (Number.isNaN(d.getTime())) throw errors.badRequest('计划催收日期不合法')
      data.plannedDate = d
    }
    if (patch.method !== undefined) {
      if (!COLLECTION_METHODS.includes(patch.method as never)) throw errors.badRequest('催收方式不合法（phone/letter/legal）')
      data.method = patch.method
    }
    if (patch.collectorId !== undefined) data.collectorId = patch.collectorId || null
    if (patch.remark !== undefined) data.remark = patch.remark || null
    if (patch.billedUncollectedAmount !== undefined) {
      const v = Number(patch.billedUncollectedAmount)
      if (!Number.isFinite(v) || v < 0) throw errors.badRequest('已开票未收款金额不合法')
      data.billedUncollectedAmount = Number(v.toFixed(2))
    }
    if (patch.salesmanId !== undefined) {
      if (patch.salesmanId === null || patch.salesmanId === '') {
        data.salesmanId = null
      } else {
        // 挂接校验改为“归属包含”语义：业务员任一归属公司等于计划公司即可
        const salesmanCompanies = await prisma.salesmanCompany.findMany({
          where: { salesmanId: patch.salesmanId },
          select: { companyCode: true },
        })
        if (salesmanCompanies.length === 0) throw errors.badRequest('业务员不存在')
        if (!salesmanCompanies.some((c) => c.companyCode === plan.companyCode)) throw errors.badRequest('业务员不属于该公司')
        data.salesmanId = patch.salesmanId
      }
    }
    if (patch.statusNote !== undefined) {
      const note = (patch.statusNote || '').trim()
      if (note.length > 500) throw errors.badRequest('催收状态说明不能超过 500 字')
      data.statusNote = note || null
    }
    if (Object.keys(data).length === 0) throw errors.badRequest('无可更新字段')

    const updated = await prisma.collectionPlan.update({ where: { id }, data: data as never })
    await recordAudit({ userId: ctx.userId, module: 'transactions', action: 'update', targetId: id, detail: { action: 'update-collection', fields: Object.keys(data), statusTo: data.status ?? undefined } }, ctx.traceId)
    const names = await buildNameMaps([updated])
    return toPlanDto(updated as unknown as Record<string, unknown>, names)
  },

  /**
   * 催收记录列表
   */
  async listLogs(planId: string): Promise<CollectionLogDto[]> {
    const plan = await prisma.collectionPlan.findUnique({ where: { id: planId }, select: { id: true, companyCode: true } })
    if (!plan) throw errors.notFound('催收计划不存在')
    // 数据范围守卫：计划归属公司必须在当前用户数据范围内（防越权读催收记录）
    await assertCompaniesInScope([plan.companyCode], undefined, '查看催收记录')
    const logs = await prisma.collectionLog.findMany({ where: { planId }, orderBy: { actionTime: 'desc' } })
    return logs.map((l) => ({
      id: l.id,
      planId: l.planId,
      actionTime: l.actionTime.toISOString(),
      actionBy: l.actionBy,
      content: l.content,
      attachmentUrl: l.attachmentUrl,
    }))
  },

  /**
   * 新增催收记录
   */
  async addLog(planId: string, input: { content: string; attachmentUrl?: string }, ctx: Ctx): Promise<CollectionLogDto> {
    const plan = await prisma.collectionPlan.findUnique({ where: { id: planId }, select: { id: true, companyCode: true } })
    if (!plan) throw errors.notFound('催收计划不存在')
    // 数据范围守卫：计划归属公司必须在当前用户数据范围内（防越权写催收记录）
    await assertCompaniesInScope([plan.companyCode], undefined, '新增催收记录')
    const content = (input.content || '').trim()
    if (!content) throw errors.badRequest('催收内容必填')
    const log = await prisma.collectionLog.create({
      data: {
        planId,
        actionTime: new Date(),
        actionBy: ctx.userId,
        content,
        attachmentUrl: input.attachmentUrl || null,
      },
    })
    await recordAudit({ userId: ctx.userId, module: 'transactions', action: 'update', targetId: planId, detail: { action: 'add-collection-log' } }, ctx.traceId)
    return {
      id: log.id,
      planId: log.planId,
      actionTime: log.actionTime.toISOString(),
      actionBy: log.actionBy,
      content: log.content,
      attachmentUrl: log.attachmentUrl,
    }
  },
}
