import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { matchProductCategories, profitMirrorName } from './DashboardService'
import { syncDimensionMembers } from './analysis/dimension-members'
import type { ValueNode } from './AggregationService'

/**
 * 品类配置服务：品类预算达成分析的品类 ↔ 收入科目配置。
 * 匹配逻辑与 DashboardService.matchProductCategories 共用；check 提供科目树变化检测。
 *
 * C1 混合模式：subject_codes 非空时按科目编码精确匹配（稳定，不受科目改名/重构影响），
 * 为空数组时回退 subject_keyword 关键词匹配（自动）。
 */

interface AuditCtx { userId: string; traceId?: string }

export interface ProductCategoryDto {
  id: string
  code: string
  name: string
  subjectKeyword: string
  /** 显式科目编码集合（非空时优先于 subjectKeyword） */
  subjectCodes: string[]
  sortOrder: number
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}

/** 科目树变化检测结果：品类覆盖状态 + 未覆盖科目 + 失效配置（关键词/编码）+ 毛利镜像缺失 */
export interface ProductCategoryCheckResult {
  categories: (ProductCategoryDto & { matchedSubjects: string[]; profitOk: boolean })[]
  uncoveredSubjects: string[]
  /** 关键词模式下无命中的关键词（显式模式下恒为空） */
  brokenKeywords: string[]
  /** 显式模式下在收入科目树中不存在的编码（关键词模式下恒为空） */
  brokenCodes: string[]
  missingProfitMirror: string[]
}

/** 归一化显式科目编码：去空白、去空串、去重（保留首次出现顺序） */
function normalizeCodes(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  for (const v of input) {
    const code = String(v ?? '').trim()
    if (code) seen.add(code)
  }
  return [...seen]
}

function toDto(row: {
  id: string; code: string; name: string; subjectKeyword: string; subjectCodes: string[]; sortOrder: number; status: string; createdAt: Date; updatedAt: Date
}): ProductCategoryDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    subjectKeyword: row.subjectKeyword,
    subjectCodes: row.subjectCodes ?? [],
    sortOrder: row.sortOrder,
    status: row.status === 'inactive' ? 'inactive' : 'active',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** 由科目表行构造参与匹配的节点（matchProductCategories 用 code/name/level/values/children，check 场景 values 置空） */
function nodeOf(code: string, name: string, category: string, level: number): ValueNode {
  return {
    code, name, level, category, dataType: 'data', direction: 'debit',
    valueType: 'amount', isLeaf: true, values: {}, children: [],
  }
}

/** 按 code/parentCode 构建类别树（供覆盖关系传播：已配置品类节点的后代视为已覆盖） */
function buildCategoryTree(rows: { code: string; name: string; level: number; parentCode: string | null }[]): ValueNode[] {
  const byCode = new Map(rows.map((r) => [r.code, nodeOf(r.code, r.name, '收入', r.level)]))
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

  async create(input: { code: string; name: string; subjectKeyword?: string; subjectCodes?: string[]; sortOrder?: number; status?: string }, ctx: AuditCtx): Promise<ProductCategoryDto> {
    const code = String(input.code ?? '').trim()
    const name = String(input.name ?? '').trim()
    const subjectKeyword = String(input.subjectKeyword ?? '').trim()
    const subjectCodes = normalizeCodes(input.subjectCodes)
    // C1 混合模式：显式编码优先、关键词为回退，两者至少配置一个（允许纯显式配置）
    if (!code || !name || (!subjectKeyword && subjectCodes.length === 0)) {
      throw errors.badRequest('品类编码与名称必填，且「匹配关键词」与「显式科目」至少配置一个')
    }
    const exists = await prisma.productCategory.findUnique({ where: { code } })
    if (exists) throw errors.conflict('品类编码已存在')
    // 配置写 + 维度成员同步同事务（L2/T31）：成员表镜像失败则配置回滚，不存中间态
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.productCategory.create({
        data: {
          code,
          name,
          subjectKeyword,
          subjectCodes,
          sortOrder: input.sortOrder ?? 0,
          status: input.status === 'inactive' ? 'inactive' : 'active',
        },
      })
      await syncDimensionMembers(tx, 'category')
      return row
    })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'create', targetId: created.code, detail: { entity: 'product_category' } }, ctx.traceId)
    return toDto(created)
  },

  async update(id: string, input: { name?: string; subjectKeyword?: string; subjectCodes?: string[]; sortOrder?: number; status?: string }, ctx: AuditCtx): Promise<ProductCategoryDto> {
    const found = await prisma.productCategory.findUnique({ where: { id } })
    if (!found) throw errors.notFound('品类配置不存在')
    // 变更后须仍满足「关键词与显式科目至少一个非空」，避免把回退链清空导致该行永不命中
    const nextKeyword = input.subjectKeyword !== undefined ? String(input.subjectKeyword).trim() : found.subjectKeyword
    const nextCodes = input.subjectCodes !== undefined ? normalizeCodes(input.subjectCodes) : found.subjectCodes
    if (!nextKeyword && nextCodes.length === 0) {
      throw errors.badRequest('「匹配关键词」与「显式科目」至少保留一个')
    }
    // code 不可变（被品类展示引用）
    // 配置写 + 维度成员同步同事务（L2/T31）：停用会移出成员表、改名/改序同步回写
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.productCategory.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: String(input.name).trim() } : {}),
          ...(input.subjectKeyword !== undefined ? { subjectKeyword: nextKeyword } : {}),
          ...(input.subjectCodes !== undefined ? { subjectCodes: nextCodes } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.status === 'active' || input.status === 'inactive' ? { status: input.status } : {}),
        },
      })
      await syncDimensionMembers(tx, 'category')
      return row
    })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'update', targetId: updated.code, detail: { entity: 'product_category' } }, ctx.traceId)
    return toDto(updated)
  },

  async remove(id: string, ctx: AuditCtx): Promise<void> {
    const found = await prisma.productCategory.findUnique({ where: { id } })
    if (!found) throw errors.notFound('品类配置不存在')
    // 删除 + 成员表差集删同事务（L2/T31）
    await prisma.$transaction(async (tx) => {
      await tx.productCategory.delete({ where: { id } })
      await syncDimensionMembers(tx, 'category')
    })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'delete', targetId: found.code, detail: { entity: 'product_category' } }, ctx.traceId)
  },

  /**
   * 科目树变化检测：对比经营科目树（收入/毛利类别）与品类配置，
   * 返回各品类匹配到的科目、毛利镜像是否齐全、未被配置的收入节点（科目树新增提示）、
   * 失效配置（关键词模式下无命中的关键词 / 显式模式下不存在的编码）与毛利镜像缺失（正常应为空）。
   */
  async check(): Promise<ProductCategoryCheckResult> {
    const subjects = await prisma.accountSubject.findMany({
      where: { subjectType: 'operating', status: 'active' },
      select: { code: true, name: true, category: true, level: true, parentCode: true },
    })
    const incomeRows = subjects.filter((s) => s.category === '壹品慧收入')
    const incomeRoots = buildCategoryTree(incomeRows)
    const profitByName = new Map(subjects.filter((s) => s.category === '壹品慧毛利').map((s) => [s.name, nodeOf(s.code, s.name, s.category, s.level)]))
    const categories = await prisma.productCategory.findMany({ orderBy: { sortOrder: 'asc' } })
    const { covered, uncovered } = matchProductCategories(categories, incomeRoots, profitByName)
    const coveredMap = new Map(covered.map((c) => [c.name, c]))
    const incomeCodeSet = new Set(incomeRows.map((s) => s.code))

    const rows = categories.map((c) => {
      const matched = coveredMap.get(c.name)?.subjects ?? []
      const profitOk = matched.length > 0 && matched.every((s) => profitByName.has(profitMirrorName(s)))
      return { ...toDto(c), matchedSubjects: matched, profitOk }
    })
    return {
      categories: rows,
      uncoveredSubjects: uncovered,
      // 失效关键词：仅关键词模式参与匹配（显式编码非空时关键词被忽略），且仅报告无命中的关键词
      brokenKeywords: rows.flatMap((r) => {
        if (r.subjectCodes.length > 0) return []
        const matched = coveredMap.get(r.name)?.subjects ?? []
        return r.subjectKeyword.split(/[,，]/).map((k) => k.trim()).filter(Boolean)
          .filter((kw) => !matched.some((s) => s.includes(kw)))
      }),
      // 失效编码：配置了但收入科目树中不存在（科目改名/停用/删除）
      brokenCodes: rows.flatMap((r) => r.subjectCodes.filter((c) => !incomeCodeSet.has(c))),
      missingProfitMirror: rows.filter((r) => r.matchedSubjects.length > 0 && !r.profitOk).map((r) => r.name),
    }
  },
}
