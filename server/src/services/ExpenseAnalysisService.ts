import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'

/**
 * 运营费用映射服务：运营费用分析的展示指标 ↔ 经营科目编码集合配置。
 * 展示逻辑（聚合求和）与 DashboardService.getExpenseAnalysis 共用；
 * check 提供科目树变化检测（候选科目 / 未配置 / 失效编码）。
 */

interface AuditCtx { userId: string; traceId?: string }

export interface ExpenseMappingDto {
  id: string
  code: string
  name: string
  subjectCodes: string[]
  sortOrder: number
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}

/** 候选科目（纯函数 expenseCandidates 输出） */
export interface ExpenseCandidateItem {
  code: string
  name: string
}

/** 候选科目分组（check 返回，供配置面板按组多选；hasData 由 check 按 active 批次注入） */
export interface ExpenseCandidateGroup {
  group: string
  items: (ExpenseCandidateItem & { hasData: boolean })[]
}

/** 科目树变化检测结果：映射匹配状态 + 候选科目分组 + 未配置科目 + 失效编码 */
export interface ExpenseMappingCheckResult {
  mappings: (ExpenseMappingDto & { matchedSubjects: string[]; hasData: boolean })[]
  candidates: ExpenseCandidateGroup[]
  uncoveredSubjects: string[]
  brokenCodes: string[]
}

/** 科目编码（经营指标级联数字编码，如 OP_0501010101）：一对一映射 code=科目编码 */
const SUBJECT_CODE_RE = /^OP_[0-9]+$/
/** 归并/自定义映射编码：EXP_ 前缀 + 小写英文/数字/下划线 */
const CUSTOM_CODE_RE = /^EXP_[a-z][a-z0-9_]*$/

/** 映射编码合法格式：一对一映射=科目编码（OP_ 前缀数字）；归并/自定义=EXP_ 前缀小写英文（如 EXP_rd_expense） */
export function isValidMappingCode(code: string): boolean {
  return SUBJECT_CODE_RE.test(code) || CUSTOM_CODE_RE.test(code)
}

/** 科目树节点（check 场景仅用 code/name/children 定位候选） */
interface SubjectNode {
  code: string
  name: string
  level: number
  parentCode: string | null
  children: SubjectNode[]
}

/** check 的科目行输入（accountSubject select 子集） */
export type SubjectRow = { code: string; name: string; category: string; level: number; parentCode: string | null }

/** check 的映射行输入（expenseSubjectMapping 行子集） */
export type MappingRow = { code: string; name: string; subjectCodes: string[]; sortOrder: number; status: string }

/** 按 code/parentCode 构建类别树 */
function buildTree(rows: SubjectRow[]): SubjectNode[] {
  const byCode = new Map(rows.map((r) => [r.code, { ...r, children: [] as SubjectNode[] }]))
  const roots: SubjectNode[] = []
  for (const r of rows) {
    const node = byCode.get(r.code) as SubjectNode
    if (r.parentCode && byCode.has(r.parentCode)) {
      byCode.get(r.parentCode)?.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

/** 按名称链在子树内查找节点（如 壹品慧费用 > 运营费用） */
function findByNamePath(nodes: SubjectNode[], names: string[]): SubjectNode | undefined {
  let current: SubjectNode | undefined
  let level = nodes
  for (const n of names) {
    current = level.find((x) => x.name === n)
    if (!current) return undefined
    level = current.children
  }
  return current
}

/** 收集子树全部叶子节点（无子级即叶子） */
function collectLeaves(node: SubjectNode): SubjectNode[] {
  if (node.children.length === 0) return [node]
  return node.children.flatMap((c) => collectLeaves(c))
}

/**
 * 运营费用候选科目定位：费用 > 壹品慧费用 > 运营费用 子树（叶子按直接子节点分组，
 * 如 付现运营费用/非付现运营费用）+ 壹品慧费用 下的 财务费用 叶子。
 * 科目树缺失对应节点时返回空数组（前端显示无候选提示）。
 */
export function expenseCandidates(subjects: SubjectRow[]): { group: string; items: ExpenseCandidateItem[] }[] {
  const feeRoots = buildTree(subjects.filter((s) => s.category === '费用'))
  const yph = feeRoots[0]
  const expenseNode = yph ? findByNamePath(yph.children, ['壹品慧费用', '运营费用']) : undefined

  const candidates: { group: string; items: ExpenseCandidateItem[] }[] = []
  if (expenseNode) {
    for (const child of expenseNode.children) {
      const items = collectLeaves(child).map((n) => ({ code: n.code, name: n.name }))
      if (items.length === 0) continue
      candidates.push({ group: child.name, items })
    }
  }
  // 财务费用（壹品慧费用 下的兄弟叶子，与运营费用平级）
  const yphNode = yph?.children.find((n) => n.name === '壹品慧费用')
  const financeNode = yphNode?.children.find((n) => n.name === '财务费用')
  if (financeNode) {
    candidates.push({ group: '财务费用', items: [{ code: financeNode.code, name: financeNode.name }] })
  }
  return candidates
}

/**
 * 映射健康判定：matchedSubjects（编码→科目名，仅候选内）、
 * uncoveredSubjects（候选未被任何 active 映射引用）、
 * brokenCodes（映射引用了候选集之外的编码：不存在/停用/不在运营费用范围内）。
 */
export function expenseMappingHealth(mappings: MappingRow[], candidates: { group: string; items: ExpenseCandidateItem[] }[]): {
  matchedSubjects: Map<string, string[]>
  uncoveredSubjects: string[]
  brokenCodes: string[]
} {
  const allCandidates = candidates.flatMap((g) => g.items)
  const candidateByCode = new Map(allCandidates.map((c) => [c.code, c.name]))

  const matchedSubjects = new Map<string, string[]>()
  const referenced = new Set<string>()
  const broken = new Set<string>()
  for (const m of mappings) {
    const matched = m.subjectCodes
      .map((c) => candidateByCode.get(c))
      .filter((n): n is string => !!n)
    matchedSubjects.set(m.code, matched)
    for (const c of m.subjectCodes) {
      if (candidateByCode.has(c)) {
        if (m.status === 'active') referenced.add(c)
      } else {
        broken.add(c)
      }
    }
  }
  const uncoveredSubjects = allCandidates.filter((c) => !referenced.has(c.code)).map((c) => c.name)
  return { matchedSubjects, uncoveredSubjects, brokenCodes: [...broken] }
}

function toDto(row: {
  id: string; code: string; name: string; subjectCodes: string[]; sortOrder: number; status: string; createdAt: Date; updatedAt: Date
}): ExpenseMappingDto {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    subjectCodes: [...row.subjectCodes],
    sortOrder: row.sortOrder,
    status: row.status === 'inactive' ? 'inactive' : 'active',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export const ExpenseAnalysisService = {
  /** 全部映射（sortOrder 升序） */
  async list(): Promise<ExpenseMappingDto[]> {
    const rows = await prisma.expenseSubjectMapping.findMany({ orderBy: { sortOrder: 'asc' } })
    return rows.map(toDto)
  },

  async create(input: { code: string; name: string; subjectCodes: string[]; sortOrder?: number; status?: string }, ctx: AuditCtx): Promise<ExpenseMappingDto> {
    const code = String(input.code ?? '').trim()
    const name = String(input.name ?? '').trim()
    const subjectCodes = Array.isArray(input.subjectCodes) ? input.subjectCodes.map((c) => String(c).trim()).filter(Boolean) : []
    if (!code || !name) throw errors.badRequest('展示名称与映射编码必填')
    if (!isValidMappingCode(code)) throw errors.badRequest('映射编码需为科目编码（OP_ 前缀）或 EXP_ 前缀小写英文（如 EXP_rd_expense）')
    if (subjectCodes.length === 0) throw errors.badRequest('至少选择 1 个运营费用科目')
    const exists = await prisma.expenseSubjectMapping.findUnique({ where: { code } })
    if (exists) throw errors.conflict('映射编码已存在')
    const created = await prisma.expenseSubjectMapping.create({
      data: {
        code,
        name,
        subjectCodes,
        sortOrder: input.sortOrder ?? 0,
        status: input.status === 'inactive' ? 'inactive' : 'active',
      },
    })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'create', targetId: created.code, detail: { entity: 'expense_subject_mapping' } }, ctx.traceId)
    return toDto(created)
  },

  async update(id: string, input: { name?: string; subjectCodes?: string[]; sortOrder?: number; status?: string }, ctx: AuditCtx): Promise<ExpenseMappingDto> {
    const found = await prisma.expenseSubjectMapping.findUnique({ where: { id } })
    if (!found) throw errors.notFound('运营费用映射不存在')
    // code 不可变（被看板展示引用）
    const subjectCodes = input.subjectCodes !== undefined
      ? input.subjectCodes.map((c) => String(c).trim()).filter(Boolean)
      : undefined
    if (subjectCodes !== undefined && subjectCodes.length === 0) throw errors.badRequest('至少选择 1 个运营费用科目')
    const updated = await prisma.expenseSubjectMapping.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: String(input.name).trim() } : {}),
        ...(subjectCodes !== undefined ? { subjectCodes } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.status === 'active' || input.status === 'inactive' ? { status: input.status } : {}),
      },
    })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'update', targetId: updated.code, detail: { entity: 'expense_subject_mapping' } }, ctx.traceId)
    return toDto(updated)
  },

  async remove(id: string, ctx: AuditCtx): Promise<void> {
    const found = await prisma.expenseSubjectMapping.findUnique({ where: { id } })
    if (!found) throw errors.notFound('运营费用映射不存在')
    await prisma.expenseSubjectMapping.delete({ where: { id } })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'delete', targetId: found.code, detail: { entity: 'expense_subject_mapping' } }, ctx.traceId)
  },

  /**
   * 科目树变化检测：定位运营费用候选科目（按组返回，供前端多选），
   * 返回各映射匹配到的科目、未配置的候选科目与失效编码（不存在/停用/不在运营费用范围内）；
   * 候选科目与映射行附带 hasData（active 经营/预算批次中是否存在事实行，供前端提示"无数据不展示"）。
   */
  async check(): Promise<ExpenseMappingCheckResult> {
    const subjects = await prisma.accountSubject.findMany({
      where: { subjectType: 'operating', status: 'active' },
      select: { code: true, name: true, category: true, level: true, parentCode: true },
    })
    const candidates = expenseCandidates(subjects)
    const mappings = await prisma.expenseSubjectMapping.findMany({ orderBy: { sortOrder: 'asc' } })
    const { matchedSubjects, uncoveredSubjects, brokenCodes } = expenseMappingHealth(mappings, candidates)

    // hasData：跨 active 经营/预算批次一次取全量科目编码集合（与看板取数口径一致：预算与经营任一存在即视为有数据）
    const [opBatches, budgetBatches] = await Promise.all([
      prisma.importBatch.findMany({ where: { dataType: 'operating', lifecycleStatus: 'active' }, select: { id: true } }),
      prisma.importBatch.findMany({ where: { dataType: 'budget', lifecycleStatus: 'active' }, select: { id: true } }),
    ])
    const [opGrouped, budgetGrouped] = await Promise.all([
      prisma.factOperating.groupBy({ by: ['accountCode'], where: { batchId: { in: opBatches.map((b) => b.id) } } }),
      prisma.factBudget.groupBy({ by: ['accountCode'], where: { batchId: { in: budgetBatches.map((b) => b.id) } } }),
    ])
    const dataCodes = new Set([...opGrouped.map((g) => g.accountCode), ...budgetGrouped.map((g) => g.accountCode)])

    const candidatesWithData: ExpenseCandidateGroup[] = candidates.map((g) => ({
      group: g.group,
      items: g.items.map((i) => ({ ...i, hasData: dataCodes.has(i.code) })),
    }))
    const rows = mappings.map((m) => ({
      ...toDto(m),
      matchedSubjects: matchedSubjects.get(m.code) ?? [],
      hasData: m.subjectCodes.some((c) => dataCodes.has(c)),
    }))
    return { mappings: rows, candidates: candidatesWithData, uncoveredSubjects, brokenCodes }
  },
}
