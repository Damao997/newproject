import { prisma } from '../../lib/prisma'
import { flattenValueTree } from '../AggregationService'
import { resolveCategoryMembers } from '../DashboardService'
import { loadConfigSource } from './dimension-members'
import type { ValueNode } from '../AggregationService'
import type { RowDim } from '../../lib/analysis-query'

/**
 * 矩阵模式列成员解析（即席分析 v2，见 docs/plans/即席分析-L1L2-阶段方案.md §2.1）。
 *
 * 与行维度适配器共享同一套口径来源（loadConfigSource：L2/T31 成员表驱动，空表/未覆盖时回退
 * 配置表），保证行序与列成员序同源；**只解析成员清单与科目集合，不取值**——
 * 科目树用 account_subject 静态构建（与 ProductCategoryService.check() 同源），
 * 无需跑聚合。列成员随后由 AnalysisQueryService 逐成员构造 ctx 跑行适配器：
 *   colDim = company              → 换 ctx.companyCodes（正交维度，逐主体聚合）
 *   colDim = product/category/...  → ctx.colSubjectFilter = 成员科目集（聚合树过滤）
 */

export interface ColMember {
  code: string
  name: string
  /** 科目维度成员的科目编码集合（company 维度为空） */
  subjectCodes: string[]
}

/** 静态科目节点（无值）：check 场景建模，见 ProductCategoryService.nodeOf */
function nodeOf(code: string, name: string, category: string, level: number): ValueNode {
  return {
    code, name, level, category, dataType: 'data', direction: 'debit',
    valueType: 'amount', isLeaf: true, values: {}, children: [],
  }
}

/** 静态经营科目树（全类别，按 parentCode 挂载；孤儿节点挂根） */
export async function staticOperatingTree(): Promise<ValueNode[]> {
  const rows = await prisma.accountSubject.findMany({
    where: { subjectType: 'operating', status: 'active' },
    select: { code: true, name: true, category: true, level: true, parentCode: true },
  })
  const byCode = new Map(rows.map((r) => [r.code, nodeOf(r.code, r.name, r.category, r.level)]))
  const roots: ValueNode[] = []
  for (const r of rows) {
    const node = byCode.get(r.code) as ValueNode
    if (r.parentCode && byCode.has(r.parentCode)) byCode.get(r.parentCode)?.children.push(node)
    else roots.push(node)
  }
  return roots
}

/** 品类 / 产品：按配置解析命中科目（显式编码优先，空则关键词回退，与 C1 一致）。
 *  配置源与行适配器同走 loadConfigSource（成员表驱动 + 覆盖回退）。 */
async function productLikeMembers(source: 'product' | 'category', tree: ValueNode[], incomeRoots: ValueNode[]): Promise<ColMember[]> {
  const configs = await loadConfigSource(source)
  // allNodes 必须是扁平化全树：resolveCategoryMembers 的关键词扫描逐节点比 name，
  // 传根节点数组会漏掉深层叶子（关键词通常命中叶子），导致命中科目集为空
  const flat = flattenValueTree(tree)
  return configs.map((c) => ({
    code: c.code,
    name: c.name,
    subjectCodes: resolveCategoryMembers(c, flat, incomeRoots).map((n) => n.code),
  }))
}

/**
 * 解析列成员清单。
 * subject 维度取 level ≤ 1 的节点（顶层类别与其直接子类），避免全树铺开超上限。
 */
export async function resolveColMembers(colDim: RowDim): Promise<ColMember[]> {
  if (colDim === 'company') {
    const configs = await prisma.subjectBudgetConfig.findMany({
      where: { status: 'active' }, orderBy: { sortOrder: 'asc' }, select: { companyCode: true },
    })
    const companies = await prisma.company.findMany({
      where: { code: { in: configs.map((c) => c.companyCode) }, status: 'active' },
      select: { code: true, name: true, shortName: true },
    })
    const byCode = new Map(companies.map((c) => [c.code, c]))
    return configs.flatMap((c) => {
      const company = byCode.get(c.companyCode)
      return company ? [{ code: company.code, name: company.shortName ?? company.name, subjectCodes: [] }] : []
    })
  }

  const tree = await staticOperatingTree()
  const incomeRoots = tree.filter((n) => n.category === '壹品慧收入')

  if (colDim === 'product' || colDim === 'category') return productLikeMembers(colDim, tree, incomeRoots)

  if (colDim === 'expense') {
    const configs = await loadConfigSource('expense')
    return configs.map((m) => ({ code: m.code, name: m.name, subjectCodes: m.subjectCodes }))
  }

  // subject：level ≤ 1 节点（含顶层类别与其直接子类）
  return tree
    .filter((n) => n.level <= 1)
    .map((n) => ({ code: n.code, name: n.name, subjectCodes: [n.code] }))
}

/** 列成员简化名（company 用 shortName，与列成员解析保持一致） */
export async function colMemberName(colDim: RowDim, code: string): Promise<string> {
  if (colDim === 'company') {
    const c = await prisma.company.findUnique({ where: { code }, select: { name: true, shortName: true } })
    return c?.shortName ?? c?.name ?? code
  }
  return code
}
