import { prisma } from '../lib/prisma'
import { resolveScope } from '../middleware/scope'
import type { AuthUserContext } from '../types/express'
import { OPERATING_DIMS, STATIC_DIMS } from '../lib/metric-values'

/**
 * 聚合服务：从事实表按科目树自底向上汇总（父节点 = 子节点求和，与前端一致），
 * 并遵循数据范围（scope）过滤。金额单位：万元。
 */

export interface ValueNode {
  code: string
  name: string
  level: number
  category: string
  dataType: 'data' | 'calc' | 'display'
  direction: 'debit' | 'credit'
  isLeaf: boolean
  values: Record<string, number>
  children: ValueNode[]
}

interface SubjectRow {
  code: string
  name: string
  level: number
  parentCode: string | null
  category: string
  direction: 'debit' | 'credit'
  isLeaf: boolean
  dataType: 'data' | 'calc' | 'display'
  orderNo: number
}

function round2(n: number): number {
  return Number(n.toFixed(2))
}

/** 将汇总主体编码经 company_aggregation_map 展开为其单体成员；单体编码原样保留 */
async function expandSummaries(codes: string[]): Promise<string[]> {
  if (codes.length === 0) return []
  const companies = await prisma.company.findMany({ where: { code: { in: codes } }, select: { code: true, entityType: true } })
  const summaryCodes = companies.filter((c) => c.entityType === 'summary').map((c) => c.code)
  const singleCodes = new Set(companies.filter((c) => c.entityType === 'single').map((c) => c.code))
  if (summaryCodes.length > 0) {
    const maps = await prisma.companyAggregationMap.findMany({ where: { summaryCompanyCode: { in: summaryCodes } }, select: { singleCompanyCode: true } })
    for (const m of maps) singleCodes.add(m.singleCompanyCode)
  }
  return Array.from(singleCodes)
}

/** 解析当前用户的有效公司编码集合（叠加可选的公司过滤；汇总主体自动展开为单体成员） */
export async function resolveCompanyCodes(
  authUser: Pick<AuthUserContext, 'companyCode' | 'orgScopeBu' | 'scopeValue'>,
  requestedCompany?: string,
): Promise<string[]> {
  const scope = await resolveScope(prisma, authUser)
  let base: string[]
  if (scope.type === 'all') {
    const all = await prisma.company.findMany({ where: { entityType: 'single', status: 'active' }, select: { code: true } })
    base = all.map((c) => c.code)
  } else if (scope.type === 'companies') {
    base = scope.companyCodes
  } else {
    base = []
  }
  if (requestedCompany) {
    // 请求为汇总主体：展开其单体成员；请求为单体：需在权限范围内
    const requested = await prisma.company.findUnique({ where: { code: requestedCompany }, select: { code: true, entityType: true } })
    if (!requested) return []
    if (requested.entityType === 'summary') {
      const members = await expandSummaries([requestedCompany])
      const baseSet = new Set(base)
      return members.filter((c) => baseSet.has(c))
    }
    return base.includes(requestedCompany) ? [requestedCompany] : []
  }
  return base
}

async function activeBatchIds(dataType: 'operating' | 'static' | 'budget'): Promise<string[]> {
  const batches = await prisma.importBatch.findMany({
    where: { dataType, lifecycleStatus: 'active' },
    select: { id: true },
  })
  return batches.map((b) => b.id)
}

async function loadSubjects(subjectType: 'operating' | 'static'): Promise<SubjectRow[]> {
  const rows = await prisma.accountSubject.findMany({
    where: { subjectType },
    orderBy: { orderNo: 'asc' },
    select: {
      code: true, name: true, level: true, parentCode: true, category: true,
      direction: true, isLeaf: true, orderNo: true,
    },
  })
  // dataType 来自 metric 表
  const metrics = await prisma.metric.findMany({ select: { code: true, dataType: true } })
  const dtMap = new Map(metrics.map((m) => [m.code, m.dataType]))
  return rows.map((r) => ({ ...r, dataType: (dtMap.get(r.code) ?? 'data') as SubjectRow['dataType'] }))
}

const EMPTY_OPERATING: Record<string, number> = {
  [OPERATING_DIMS.BUDGET_AMOUNT]: 0,
  [OPERATING_DIMS.ACTUAL_MONTH]: 0,
  [OPERATING_DIMS.SAME_PERIOD_ACTUAL]: 0,
  [OPERATING_DIMS.YTD_ACTUAL]: 0,
  [OPERATING_DIMS.SAME_PERIOD_YTD]: 0,
}
const EMPTY_STATIC: Record<string, number> = {
  [STATIC_DIMS.CURRENT_AMOUNT]: 0,
  [STATIC_DIMS.YEAR_START]: 0,
  [STATIC_DIMS.SAME_PERIOD_AMOUNT]: 0,
  [STATIC_DIMS.LAST_YEAR_START]: 0,
}

function buildTree(subjects: SubjectRow[], leafValues: Map<string, Record<string, number>>, emptyDims: Record<string, number>): ValueNode[] {
  const byCode = new Map<string, ValueNode>()
  const roots: ValueNode[] = []

  for (const s of subjects) {
    byCode.set(s.code, {
      code: s.code, name: s.name, level: s.level, category: s.category,
      dataType: s.dataType, direction: s.direction, isLeaf: s.isLeaf,
      values: { ...emptyDims }, children: [],
    })
  }
  for (const s of subjects) {
    const node = byCode.get(s.code) as ValueNode
    if (s.parentCode && byCode.has(s.parentCode)) {
      byCode.get(s.parentCode)?.children.push(node)
    } else {
      roots.push(node)
    }
  }

  // 后序：叶子取事实值，父节点 = 子求和
  const dims = Object.keys(emptyDims)
  const aggregate = (node: ValueNode): void => {
    if (node.children.length === 0) {
      const v = leafValues.get(node.code)
      if (v) for (const d of dims) node.values[d] = round2(v[d] ?? 0)
      return
    }
    for (const child of node.children) aggregate(child)
    for (const d of dims) {
      node.values[d] = round2(node.children.reduce((sum, c) => sum + (c.values[d] ?? 0), 0))
    }
  }
  roots.forEach(aggregate)
  return roots
}

export const AggregationService = {
  /** 经营指标聚合树 */
  async buildOperatingTree(companyCodes: string[], period: string): Promise<ValueNode[]> {
    const subjects = await loadSubjects('operating')
    const leafValues = new Map<string, Record<string, number>>()
    if (companyCodes.length > 0) {
      const batchIds = await activeBatchIds('operating')
      if (batchIds.length > 0) {
        const grouped = await prisma.factOperating.groupBy({
          by: ['accountCode', 'periodDimCode'],
          where: { companyCode: { in: companyCodes }, period, batchId: { in: batchIds } },
          _sum: { value: true },
        })
        for (const g of grouped) {
          const rec = leafValues.get(g.accountCode) ?? { ...EMPTY_OPERATING }
          rec[g.periodDimCode] = Number(g._sum.value ?? 0)
          leafValues.set(g.accountCode, rec)
        }
      }
    }
    return buildTree(subjects, leafValues, EMPTY_OPERATING)
  },

  /** 静态指标聚合树（按 active 静态批次汇总） */
  async buildStaticTree(companyCodes: string[]): Promise<ValueNode[]> {
    const subjects = await loadSubjects('static')
    const leafValues = new Map<string, Record<string, number>>()
    if (companyCodes.length > 0) {
      const batchIds = await activeBatchIds('static')
      if (batchIds.length > 0) {
        const grouped = await prisma.factStatic.groupBy({
          by: ['accountCode', 'periodDimCode'],
          where: { companyCode: { in: companyCodes }, batchId: { in: batchIds } },
          _sum: { value: true },
        })
        for (const g of grouped) {
          const rec = leafValues.get(g.accountCode) ?? { ...EMPTY_STATIC }
          rec[g.periodDimCode] = Number(g._sum.value ?? 0)
          leafValues.set(g.accountCode, rec)
        }
      }
    }
    return buildTree(subjects, leafValues, EMPTY_STATIC)
  },
}

/** 前序展开树为扁平行 */
export function flattenValueTree(tree: ValueNode[]): ValueNode[] {
  const out: ValueNode[] = []
  const walk = (nodes: ValueNode[]): void => {
    for (const n of nodes) {
      out.push(n)
      if (n.children.length > 0) walk(n.children)
    }
  }
  walk(tree)
  return out
}
