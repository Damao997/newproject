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

/** 科目编码（经营指标级联数字编码，如 PL05010101）：一对一映射 code=科目编码 */
const SUBJECT_CODE_RE = /^PL[0-9]+$/
/** 归并/自定义映射编码：EXP_ 前缀 + 小写英文/数字/下划线（含统一自动编码 EXP_001） */
const CUSTOM_CODE_RE = /^EXP_[a-z0-9][a-z0-9_]*$/
/** 统一自动编码的数字序号部分（EXP_001 → 001） */
const EXP_NUMERIC_RE = /^EXP_(\d+)$/

/** 映射编码合法格式：一对一映射=科目编码（PL 前缀数字）；归并/自定义=EXP_ 前缀（小写英文或数字序号，如 EXP_001/EXP_rd_expense） */
export function isValidMappingCode(code: string): boolean {
  return SUBJECT_CODE_RE.test(code) || CUSTOM_CODE_RE.test(code)
}

/** 统一编码生成输入行（expenseSubjectMapping 行子集：code + 墓碑标记） */
export type MappingCodeRow = { code: string; deletedAt: Date | null }

/**
 * 下一个统一映射编码：EXP_ + 现有数字序号最大值 + 1（3 位零填充，超 999 自然扩位）。
 * 统计含墓碑行：被删除的编码不复用，避免与"同 code 重建=复活"语义冲突；
 * 非数字 EXP_ 编码（EXP_rd_expense）与科目编码不参与序号计算。
 */
export function nextExpenseMappingCode(rows: MappingCodeRow[]): string {
  let max = 0
  for (const r of rows) {
    const m = EXP_NUMERIC_RE.exec(r.code)
    if (m) max = Math.max(max, Number(m[1]))
  }
  return `EXP_${String(max + 1).padStart(3, '0')}`
}

/** 旧格式映射行（buildLegacyMappingMigration 输入，expenseSubjectMapping 行子集） */
export type LegacyMappingRow = {
  id: string
  code: string
  name: string
  subjectCodes: string[]
  sortOrder: number
  status: string
  deletedAt: Date | null
}

/** 旧格式迁移计划项：legacy=被迁移的旧行，targetCode=分配的统一编码 */
export interface LegacyMappingMigration {
  legacy: LegacyMappingRow
  targetCode: string
}

/**
 * 旧默认映射迁移计划（统一编码改造）：code 为科目编码（PL 前缀）的非墓碑映射视为旧 seed 默认映射，
 * 按 sortOrder 升序分配 EXP_001 起统一编码；归并（subjectCodes）/停用（status）等管理员修改原样保留。
 * 墓碑行 / EXP_ 自定义编码不参与迁移（后者本就不在默认集合中）。
 */
export function buildLegacyMappingMigration(rows: LegacyMappingRow[]): LegacyMappingMigration[] {
  const legacy = rows
    .filter((r) => r.deletedAt === null && SUBJECT_CODE_RE.test(r.code))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
  return legacy.map((r, i) => ({ legacy: r, targetCode: `EXP_${String(i + 1).padStart(3, '0')}` }))
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
 * 运营费用候选科目定位：壹品慧费用（PL05）> 运营费用（PL0501）子树（叶子按直接子节点分组，
 * 如 付现运营费用/非付现运营费用）+ 财务费用（PL0502）叶子。
 * 科目树缺失对应节点时返回空数组（前端显示无候选提示）。
 */
export function expenseCandidates(subjects: SubjectRow[]): { group: string; items: ExpenseCandidateItem[] }[] {
  const feeRoots = buildTree(subjects.filter((s) => s.category === '壹品慧费用'))
  const yph = feeRoots[0]
  const expenseNode = yph ? findByNamePath(yph.children, ['运营费用']) : undefined

  const candidates: { group: string; items: ExpenseCandidateItem[] }[] = []
  if (expenseNode) {
    for (const child of expenseNode.children) {
      const items = collectLeaves(child).map((n) => ({ code: n.code, name: n.name }))
      if (items.length === 0) continue
      candidates.push({ group: child.name, items })
    }
  }
  // 财务费用（PL0502，与运营费用 PL0501 平级的叶子）
  const financeNode = yph?.children.find((n) => n.name === '财务费用')
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

/** 查询全部映射行（含墓碑）并计算下一个统一编码（nextCode 与 create 兜底共用） */
async function nextMappingCode(): Promise<string> {
  const rows = await prisma.expenseSubjectMapping.findMany({ select: { code: true, deletedAt: true } })
  return nextExpenseMappingCode(rows)
}

export const ExpenseAnalysisService = {
  /** 全部映射（sortOrder 升序；不含墓碑行） */
  async list(): Promise<ExpenseMappingDto[]> {
    const rows = await prisma.expenseSubjectMapping.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } })
    return rows.map(toDto)
  },

  /** 下一个统一映射编码（含墓碑行统计，供新增映射对话框预取展示） */
  async nextCode(): Promise<{ code: string }> {
    return { code: await nextMappingCode() }
  },

  async create(input: { code?: string; name: string; subjectCodes: string[]; sortOrder?: number; status?: string }, ctx: AuditCtx): Promise<ExpenseMappingDto> {
    // 编码缺省时自动生成统一编码（EXP_ 数字序号）；显式传入时按原有格式校验
    const code = String(input.code ?? '').trim() || await nextMappingCode()
    const name = String(input.name ?? '').trim()
    const subjectCodes = Array.isArray(input.subjectCodes) ? input.subjectCodes.map((c) => String(c).trim()).filter(Boolean) : []
    if (!name) throw errors.badRequest('展示名称必填')
    if (!isValidMappingCode(code)) throw errors.badRequest('映射编码需为科目编码（PL 前缀）或 EXP_ 前缀（小写英文/数字序号，如 EXP_001）')
    if (subjectCodes.length === 0) throw errors.badRequest('至少选择 1 个运营费用科目')
    const exists = await prisma.expenseSubjectMapping.findUnique({ where: { code } })
    if (exists) {
      // 墓碑行（软删除）同 code 重建视为复活：清除墓碑标记并按新输入更新
      if (exists.deletedAt) {
        const revived = await prisma.expenseSubjectMapping.update({
          where: { id: exists.id },
          data: { name, subjectCodes, sortOrder: input.sortOrder ?? 0, status: input.status === 'inactive' ? 'inactive' : 'active', deletedAt: null },
        })
        await recordAudit({ userId: ctx.userId, module: 'data', action: 'create', targetId: revived.code, detail: { entity: 'expense_subject_mapping', revived: true } }, ctx.traceId)
        return toDto(revived)
      }
      throw errors.conflict('映射编码已存在')
    }
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
    // 墓碑行（已软删除）不可再编辑：列表/看板均不可见，持 id 直调也应拒绝
    if (!found || found.deletedAt) throw errors.notFound('运营费用映射不存在')
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
    // 软删除（墓碑）：避免 seed 重跑时按默认配置复活；list/check/看板均过滤 deleted_at 行
    await prisma.expenseSubjectMapping.update({ where: { id }, data: { deletedAt: new Date() } })
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
    const mappings = await prisma.expenseSubjectMapping.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } })
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
