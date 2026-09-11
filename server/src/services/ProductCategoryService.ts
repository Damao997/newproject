import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { matchProductCategories, profitMirrorName } from './DashboardService'
import type { ValueNode } from './AggregationService'

/**
 * 品类配置服务：品类预算达成分析的品类 ↔ 收入科目关键词配置。
 * 匹配逻辑与 DashboardService.matchProductCategories 共用；check 提供科目树变化检测。
 */

interface AuditCtx { userId: string; traceId?: string }

export interface ProductCategoryDto {
  id: string
  code: string
  name: string
  subjectKeyword: string
  sortOrder: number
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}

/** 科目树变化检测结果：品类覆盖状态 + 未覆盖科目 + 失效配置 + 毛利镜像缺失 */
export interface ProductCategoryCheckResult {
  categories: (ProductCategoryDto & { matchedSubjects: string[]; profitOk: boolean })[]
  uncoveredSubjects: string[]
  brokenKeywords: string[]
  missingProfitMirror: string[]
}

function toDto(row: {
  id: string; code: string; name: string; subjectKeyword: string; sortOrder: number; status: string; createdAt: Date; updatedAt: Date
}): ProductCategoryDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    subjectKeyword: row.subjectKeyword,
    sortOrder: row.sortOrder,
    status: row.status === 'inactive' ? 'inactive' : 'active',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** 由科目表行构造参与匹配的节点（matchProductCategories 仅用 name/level/values/children，check 场景 values 置空） */
function nodeOf(name: string, category: string, level: number): ValueNode {
  return {
    code: '', name, level, category, dataType: 'data', direction: 'debit',
    valueType: 'amount', isLeaf: true, values: {}, children: [],
  }
}

/** 按 code/parentCode 构建类别树（供覆盖关系传播：已配置品类节点的后代视为已覆盖） */
function buildCategoryTree(rows: { code: string; name: string; level: number; parentCode: string | null }[]): ValueNode[] {
  const byCode = new Map(rows.map((r) => [r.code, nodeOf(r.name, '收入', r.level)]))
  const roots: ValueNode[] = []
  for (const r of rows) {
    const node = byCode.get(r.code) as ValueNode
    if (r.parentCode && byCode.has(r.parentCode)) {
      byCode.get(r.parentCode)?.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

export const ProductCategoryService = {
  /** 全部品类（sortOrder 升序） */
  async list(): Promise<ProductCategoryDto[]> {
    const rows = await prisma.productCategory.findMany({ orderBy: { sortOrder: 'asc' } })
    return rows.map(toDto)
  },

  async create(input: { code: string; name: string; subjectKeyword: string; sortOrder?: number; status?: string }, ctx: AuditCtx): Promise<ProductCategoryDto> {
    const code = String(input.code ?? '').trim()
    const name = String(input.name ?? '').trim()
    const subjectKeyword = String(input.subjectKeyword ?? '').trim()
    if (!code || !name || !subjectKeyword) throw errors.badRequest('品类编码、名称与匹配关键词必填')
    const exists = await prisma.productCategory.findUnique({ where: { code } })
    if (exists) throw errors.conflict('品类编码已存在')
    const created = await prisma.productCategory.create({
      data: {
        code,
        name,
        subjectKeyword,
        sortOrder: input.sortOrder ?? 0,
        status: input.status === 'inactive' ? 'inactive' : 'active',
      },
    })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'create', targetId: created.code, detail: { entity: 'product_category' } }, ctx.traceId)
    return toDto(created)
  },

  async update(id: string, input: { name?: string; subjectKeyword?: string; sortOrder?: number; status?: string }, ctx: AuditCtx): Promise<ProductCategoryDto> {
    const found = await prisma.productCategory.findUnique({ where: { id } })
    if (!found) throw errors.notFound('品类配置不存在')
    // code 不可变（被品类展示引用）
    const updated = await prisma.productCategory.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: String(input.name).trim() } : {}),
        ...(input.subjectKeyword !== undefined ? { subjectKeyword: String(input.subjectKeyword).trim() } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.status === 'active' || input.status === 'inactive' ? { status: input.status } : {}),
      },
    })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'update', targetId: updated.code, detail: { entity: 'product_category' } }, ctx.traceId)
    return toDto(updated)
  },

  async remove(id: string, ctx: AuditCtx): Promise<void> {
    const found = await prisma.productCategory.findUnique({ where: { id } })
    if (!found) throw errors.notFound('品类配置不存在')
    await prisma.productCategory.delete({ where: { id } })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'delete', targetId: found.code, detail: { entity: 'product_category' } }, ctx.traceId)
  },

  /**
   * 科目树变化检测：对比经营科目树（收入/毛利类别）与品类配置，
   * 返回各品类匹配到的科目、毛利镜像是否齐全、未被配置的收入节点（科目树新增提示）、
   * 失效关键词（配置无匹配）与毛利镜像缺失（正常应为空）。
   */
  async check(): Promise<ProductCategoryCheckResult> {
    const subjects = await prisma.accountSubject.findMany({
      where: { subjectType: 'operating', status: 'active' },
      select: { code: true, name: true, category: true, level: true, parentCode: true },
    })
    const incomeRoots = buildCategoryTree(subjects.filter((s) => s.category === '壹品慧收入'))
    const profitByName = new Map(subjects.filter((s) => s.category === '壹品慧毛利').map((s) => [s.name, nodeOf(s.name, s.category, s.level)]))
    const categories = await prisma.productCategory.findMany({ orderBy: { sortOrder: 'asc' } })
    const { covered, uncovered } = matchProductCategories(categories, incomeRoots, profitByName)
    const coveredMap = new Map(covered.map((c) => [c.name, c]))

    const rows = categories.map((c) => {
      const matched = coveredMap.get(c.name)?.subjects ?? []
      const profitOk = matched.length > 0 && matched.every((s) => profitByName.has(profitMirrorName(s)))
      return { ...toDto(c), matchedSubjects: matched, profitOk }
    })
    return {
      categories: rows,
      uncoveredSubjects: uncovered,
      brokenKeywords: rows.filter((r) => r.matchedSubjects.length === 0).map((r) => r.subjectKeyword),
      missingProfitMirror: rows.filter((r) => r.matchedSubjects.length > 0 && !r.profitOk).map((r) => r.name),
    }
  },
}
