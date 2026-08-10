import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { validateFormulaChange, extractCodes, extractOperandRefs, PSEUDO_OPERANDS } from './FormulaRuleService'
import { AggregationService, resolveCompanyCodes, flattenValueTree } from './AggregationService'
import { evaluateFormula } from '../lib/formula'
import { OPERATING_DIMS, STATIC_DIMS } from '../lib/metric-values'
import { periodMinusYears, fiscalYtdDays } from '../lib/period'
import { buildExcel } from '../lib/excel'
import { effectiveScope, type ScopeInput } from '../lib/scope-guard'
import { withoutScope } from '../middleware/scope-context'
import { SUBJECT_SEGMENT_MAP, childSubjectCodeOf } from '../../prisma/seed-data/subject-trees'
import type { AuthUserContext } from '../types/express'
import type { Prisma } from '@prisma/client'

/**
 * 数据管理服务：公司主体、科目体系 CRUD、指标 CRUD（含公式与 DAG 校验）、导出。
 */

interface AuditCtx { userId: string; traceId?: string }

// ---------------- 公司 ----------------
export interface CompanyDto { id: string; code: string; name: string; shortName: string | null; type: string; entityType: string; parentCode: string | null; legalEntity: string | null; managementEntity: string | null; orderNo: number; status: string }

function companyDto(c: { id: string; code: string; name: string; shortName: string | null; entityType: string; parentCode: string | null; legalEntity: string | null; managementEntity: string | null; orderNo: number; status: string }): CompanyDto {
  return {
    id: c.id, code: c.code, name: c.name,
    shortName: c.shortName,
    type: c.entityType === 'single' ? 'entity' : 'summary',
    entityType: c.entityType,
    parentCode: c.parentCode,
    legalEntity: c.legalEntity,
    managementEntity: c.managementEntity,
    orderNo: c.orderNo,
    status: c.status,
  }
}

// ---------------- 汇总映射 ----------------
export interface AggregationMapDto { id: string; summaryCompanyCode: string; summaryCompanyName: string; singleCompanyCode: string; singleCompanyName: string; isInternalElimination: boolean }

// ---------------- 科目 ----------------
export interface SubjectDto { id: string; code: string; name: string; type: string; level: number; parentCode: string | null; category: string; direction: string; valueType: string; isLeaf: boolean; status: string; dataType?: string }

function subjectDto(s: { id: string; code: string; name: string; subjectType: string; level: number; parentCode: string | null; category: string; direction: string; valueType: string; isLeaf: boolean; status: string }, dataType?: string): SubjectDto {
  return { id: s.id, code: s.code, name: s.name, type: s.subjectType, level: s.level, parentCode: s.parentCode, category: s.category, direction: s.direction, valueType: s.valueType, isLeaf: s.isLeaf, status: s.status, dataType }
}

/** 校验并归一化值类型入参；非法/缺省返回 undefined（update 不改动） */
function normalizeValueType(v?: string): 'amount' | 'quantity' | 'ratio' | undefined {
  return v === 'amount' || v === 'quantity' || v === 'ratio' ? v : undefined
}

// ---------------- 科目编码生成（级联赋码：根=段位表/自动分配，子=父码+同级最大序号+1） ----------------

/** 解析 父码+2位序号 编码的尾部序号；非规则编码视为 0 */
function subjectSeqOf(code: string, parentCode: string): number {
  const esc = parentCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = code.match(new RegExp(`^${esc}(\\d{2})$`))
  return m ? Number(m[1]) : 0
}

/** 该类型段位表登记值（经营 01-08 / 静态 10+，与 SUBJECT_SEGMENT_MAP 注释口径一致） */
function registeredSegmentsOf(prefix: 'OP' | 'ST'): number[] {
  return Object.values(SUBJECT_SEGMENT_MAP)
    .map((s) => Number(s))
    .filter((s) => (prefix === 'OP' ? s <= 8 : s >= 10))
}

/** 子科目编码：父码 + 同级最大序号 + 1（含 inactive，避免与停用科目撞码；>99 抛错） */
async function nextChildSubjectCode(parentCode: string): Promise<string> {
  // 显式声明 status 绕过软删除中间件自动注入（只统计 active 会与停用科目撞码）
  const siblings = await prisma.accountSubject.findMany({
    where: { parentCode, status: { in: ['active', 'inactive'] } },
    select: { code: true },
  })
  const maxSeq = Math.max(0, ...siblings.map((s) => subjectSeqOf(s.code, parentCode)))
  const seq = maxSeq + 1
  if (seq > 99) throw errors.badRequest('同级科目数量已达上限（99），无法继续新增')
  return childSubjectCodeOf(parentCode, seq)
}

/** 根科目编码：名称命中段位表（且段位属于该类型区间）用登记段位；未命中自动分配该类型下一未用段位；>99 抛错 */
async function nextRootSubjectCode(prefix: 'OP' | 'ST', name: string): Promise<string> {
  const registered = SUBJECT_SEGMENT_MAP[name]
  if (registered && registeredSegmentsOf(prefix).includes(Number(registered))) return `${prefix}_${registered}`
  // 显式声明 status 绕过软删除中间件自动注入（复用停用根科目的段位会撞码）
  const used = await prisma.accountSubject.findMany({
    where: { subjectType: prefix === 'OP' ? 'operating' : 'static', level: 0, status: { in: ['active', 'inactive'] } },
    select: { code: true },
  })
  const usedSegs = used.map((u) => Number(u.code.split('_')[1])).filter((n) => Number.isFinite(n))
  const regs = registeredSegmentsOf(prefix)
  const base = regs.length > 0 || usedSegs.length > 0 ? Math.max(...regs, ...usedSegs) : 0
  let next = base + 1
  while (usedSegs.includes(next)) next++
  if (next > 99) throw errors.badRequest('该类型根科目段位已达上限（99），无法继续新增')
  return `${prefix}_${String(next).padStart(2, '0')}`
}

// ---------------- 指标 ----------------
export interface MetricDto { id: string; code: string; name: string; dataType: string; formula: string | null; sourceAccountCodes: string[] | null; dependsOn: string[] | null; category: string; status: string }

function metricDto(m: { id: string; code: string; name: string; dataType: string; formula: string | null; sourceAccountCodes: unknown; dependsOn: unknown; category: string; status: string }): MetricDto {
  return {
    id: m.id, code: m.code, name: m.name, dataType: m.dataType, formula: m.formula,
    sourceAccountCodes: Array.isArray(m.sourceAccountCodes) ? (m.sourceAccountCodes as string[]) : null,
    dependsOn: Array.isArray(m.dependsOn) ? (m.dependsOn as string[]) : null,
    category: m.category, status: m.status,
  }
}

/** 快照日期 → 月份（YYYY-MM，UTC 口径，与 ImportService/IndicatorsService 一致） */
function ymOfDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** 批次元信息（对比响应两侧头部展示） */
function batchMetaOf(b: { id: string; fileName: string; dataType: string; lifecycleStatus: string; createdAt: Date }): ImportDiff['a'] {
  return { id: b.id, filename: b.fileName, templateType: b.dataType, status: b.lifecycleStatus, createdAt: b.createdAt.toISOString() }
}

/** 差异对比行（值均为万元/原始单位数值，展示层格式化） */
export interface ImportDiffRow {
  companyCode: string
  accountCode: string
  subjectName: string
  /** operating: 期间（2026-04）；static: 快照月（2026-03）；budget: FY2026/期间 */
  period: string
  oldValue: number
  newValue: number
  delta: number
  /** 变化百分比（旧值为 0 时为 null）；四舍五入到 1 位小数 */
  deltaPercent: number | null
}

export interface ImportDiff {
  a: { id: string; filename: string; templateType: string; status: string; createdAt: string }
  b: { id: string; filename: string; templateType: string; status: string; createdAt: string }
  changed: ImportDiffRow[]
  added: ImportDiffRow[]
  removed: ImportDiffRow[]
  summary: {
    changedCount: number
    addedCount: number
    removedCount: number
    totalDelta: number
    truncated: boolean
  }
}

/** 单数组截断上限（防止超大批次拖垮响应） */
const DIFF_ROW_LIMIT = 500
/** 对比读取上限：防超大批次全量载入内存（超出时按截断处理并在 summary 标注） */
const COMPARE_FETCH_LIMIT = 5000

export const DataService = {
  // ===== 公司 =====
  async listCompanies(includeInactive?: boolean): Promise<CompanyDto[]> {
    const where: Record<string, unknown> = {}
    // 显式声明 status 以绕过 soft-delete 中间件自动注入
    if (includeInactive) where.status = { in: ['active', 'inactive'] }
    // 数据范围收敛：受限用户只见授权单体 + 完整授权的汇总主体（前端各下拉据此自动对齐）
    const scope = await effectiveScope()
    if (scope && scope.type !== 'all') {
      const visible = scope.type === 'companies' ? [...scope.companyCodes, ...scope.summaryCodes] : []
      where.code = { in: visible }
    }
    const rows = await prisma.company.findMany({ where, orderBy: { orderNo: 'asc' } })
    return rows.map(companyDto)
  },

  async createCompany(input: { code: string; name: string; shortName?: string | null; entityType?: string; parentCode?: string | null; legalEntity?: string | null; managementEntity?: string | null; orderNo?: number }, ctx: AuditCtx): Promise<CompanyDto> {
    const exists = await prisma.company.findUnique({ where: { code: input.code } })
    if (exists) throw errors.conflict('公司编码已存在')
    const created = await prisma.company.create({
      data: {
        code: input.code,
        name: input.name,
        shortName: input.shortName ?? null,
        entityType: input.entityType === 'summary' ? 'summary' : 'single',
        parentCode: input.parentCode ?? null,
        legalEntity: input.legalEntity ?? null,
        managementEntity: input.managementEntity ?? null,
        orderNo: input.orderNo ?? 0,
        createdBy: ctx.userId,
      },
    })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'create', targetId: created.code, detail: { entity: 'company' } }, ctx.traceId)
    return companyDto(created)
  },

  async updateCompany(id: string, input: { name?: string; shortName?: string | null; entityType?: string; parentCode?: string | null; legalEntity?: string | null; managementEntity?: string | null; orderNo?: number; status?: string }, ctx: AuditCtx): Promise<CompanyDto> {
    const found = await prisma.company.findUnique({ where: { id } })
    if (!found) throw errors.notFound('公司不存在')
    // code 不可变（被事实/用户/汇总映射引用）
    if (input.status === 'inactive' && found.status === 'active') {
      await this.assertCompanyNotReferenced(found.code)
    }
    const updated = await prisma.company.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        shortName: input.shortName === undefined ? undefined : input.shortName,
        entityType: input.entityType === 'summary' ? 'summary' : input.entityType === 'single' ? 'single' : undefined,
        parentCode: input.parentCode === undefined ? undefined : input.parentCode,
        legalEntity: input.legalEntity === undefined ? undefined : input.legalEntity,
        managementEntity: input.managementEntity === undefined ? undefined : input.managementEntity,
        orderNo: input.orderNo ?? undefined,
        status: input.status === 'inactive' ? 'inactive' : input.status === 'active' ? 'active' : undefined,
        updatedBy: ctx.userId,
      },
    })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'update', targetId: updated.code, detail: { entity: 'company', before: { name: found.name, status: found.status }, after: { name: updated.name, status: updated.status } } }, ctx.traceId)
    return companyDto(updated)
  },

  async deleteCompany(id: string, ctx: AuditCtx): Promise<void> {
    const found = await prisma.company.findUnique({ where: { id } })
    if (!found) throw errors.notFound('公司不存在')
    await this.assertCompanyNotReferenced(found.code)
    await prisma.company.update({ where: { id }, data: { status: 'inactive', updatedBy: ctx.userId } })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'delete', targetId: found.code, detail: { entity: 'company', before: { name: found.name, status: found.status } } }, ctx.traceId)
  },



  /** 引用完整性保护：公司被事实数据、用户或汇总映射引用时禁止停用/删除 */
  async assertCompanyNotReferenced(code: string): Promise<void> {
    // 必须取跨数据范围的真值：范围外仍有事实数据时不得放行停用，故显式退出 scope 上下文
    const [opCount, stCount, bgCount, userCount, mapCount] = await withoutScope(() => Promise.all([
      prisma.factOperating.count({ where: { companyCode: code } }),
      prisma.factStatic.count({ where: { companyCode: code } }),
      prisma.factBudget.count({ where: { companyCode: code } }),
      prisma.user.count({ where: { companyCode: code } }),
      prisma.companyAggregationMap.count({ where: { OR: [{ summaryCompanyCode: code }, { singleCompanyCode: code }] } }),
    ]))
    if (opCount + stCount + bgCount > 0 || userCount > 0 || mapCount > 0) {
      throw errors.conflict('公司已被事实数据、用户或汇总映射引用，无法停用/删除')
    }
  },

  // ===== 汇总映射（单体 → 汇总主体成员） =====
  async listAggregationMap(summaryCode?: string): Promise<AggregationMapDto[]> {
    const where: Record<string, unknown> = summaryCode ? { summaryCompanyCode: summaryCode } : {}
    // 数据范围收敛：避免泄露范围外汇总主体的成员构成
    const scope = await effectiveScope()
    if (scope && scope.type !== 'all') {
      const allowedSummaries = scope.type === 'companies' ? scope.summaryCodes : []
      where.summaryCompanyCode = summaryCode
        ? { in: allowedSummaries.includes(summaryCode) ? [summaryCode] : [] }
        : { in: allowedSummaries }
    }
    const rows = await prisma.companyAggregationMap.findMany({ where, orderBy: { createdAt: 'asc' } })
    const codes = Array.from(new Set(rows.flatMap((r) => [r.summaryCompanyCode, r.singleCompanyCode])))
    const companies = await prisma.company.findMany({ where: { code: { in: codes } }, select: { code: true, name: true } })
    const nameMap = new Map(companies.map((c) => [c.code, c.name]))
    return rows.map((r) => ({
      id: r.id,
      summaryCompanyCode: r.summaryCompanyCode,
      summaryCompanyName: nameMap.get(r.summaryCompanyCode) ?? r.summaryCompanyCode,
      singleCompanyCode: r.singleCompanyCode,
      singleCompanyName: nameMap.get(r.singleCompanyCode) ?? r.singleCompanyCode,
      isInternalElimination: r.isInternalElimination,
    }))
  },

  async createAggregationMap(input: { summaryCompanyCode: string; singleCompanyCode: string; isInternalElimination?: boolean }, ctx: AuditCtx): Promise<AggregationMapDto> {
    const [summary, single] = await Promise.all([
      prisma.company.findUnique({ where: { code: input.summaryCompanyCode }, select: { entityType: true } }),
      prisma.company.findUnique({ where: { code: input.singleCompanyCode }, select: { entityType: true } }),
    ])
    if (!summary || summary.entityType !== 'summary') throw errors.badRequest('汇总主体不存在或类型不是 summary')
    if (!single || single.entityType !== 'single') throw errors.badRequest('单体公司不存在或类型不是 single')
    const dup = await prisma.companyAggregationMap.findUnique({ where: { summaryCompanyCode_singleCompanyCode: { summaryCompanyCode: input.summaryCompanyCode, singleCompanyCode: input.singleCompanyCode } } })
    if (dup) throw errors.conflict('该单体已在此汇总主体下')
    const created = await prisma.companyAggregationMap.create({
      data: {
        summaryCompanyCode: input.summaryCompanyCode,
        singleCompanyCode: input.singleCompanyCode,
        isInternalElimination: input.isInternalElimination ?? false,
      },
    })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'update', targetId: input.summaryCompanyCode, detail: { entity: 'aggregation_map', action: 'add', single: input.singleCompanyCode } }, ctx.traceId)
    const [{ name: sName }, { name: gName }] = await Promise.all([
      prisma.company.findUnique({ where: { code: input.summaryCompanyCode }, select: { name: true } }).then((c) => c ?? { name: input.summaryCompanyCode }),
      prisma.company.findUnique({ where: { code: input.singleCompanyCode }, select: { name: true } }).then((c) => c ?? { name: input.singleCompanyCode }),
    ])
    return {
      id: created.id,
      summaryCompanyCode: created.summaryCompanyCode,
      summaryCompanyName: sName,
      singleCompanyCode: created.singleCompanyCode,
      singleCompanyName: gName,
      isInternalElimination: created.isInternalElimination,
    }
  },

  async deleteAggregationMap(id: string, ctx: AuditCtx): Promise<void> {
    const found = await prisma.companyAggregationMap.findUnique({ where: { id } })
    if (!found) throw errors.notFound('映射不存在')
    await prisma.companyAggregationMap.delete({ where: { id } })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'update', targetId: found.summaryCompanyCode, detail: { entity: 'aggregation_map', action: 'remove', single: found.singleCompanyCode } }, ctx.traceId)
  },

  // ===== 科目 =====
  async listSubjects(params: { page: number; pageSize: number; type?: string; keyword?: string; includeInactive?: boolean }): Promise<{ items: SubjectDto[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const where: Record<string, unknown> = {}
    if (params.type) where.subjectType = params.type
    if (params.keyword) where.OR = [{ name: { contains: params.keyword } }, { code: { contains: params.keyword } }]
    // 显式声明 status 以绕过 soft-delete 中间件自动注入（见 soft-delete.ts 注释）
    if (params.includeInactive) where.status = { in: ['active', 'inactive'] }
    const [rows, total] = await Promise.all([
      prisma.accountSubject.findMany({ where, orderBy: { code: 'asc' }, skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
      prisma.accountSubject.count({ where }),
    ])
    // 指标类型（data/calc/display）与科目同编码关联：供调整模块过滤计算类/展示类科目
    const metrics = rows.length > 0
      ? await prisma.metric.findMany({ where: { code: { in: rows.map((r) => r.code) } }, select: { code: true, dataType: true } })
      : []
    const dataTypeByCode = new Map(metrics.map((m) => [m.code, m.dataType]))
    return { items: rows.map((s) => subjectDto(s, dataTypeByCode.get(s.code))), total, page: params.page, pageSize: params.pageSize, totalPages: Math.ceil(total / params.pageSize) }
  },

  /**
   * 新增科目：编码由系统按级联赋码机制自动生成（不信任客户端 code/level）——
   * 根科目 = 段位表登记段位（未登记自动分配下一未用段位）；子科目 = 父码 + 同级最大序号 + 1。
   * level 由上级层级推导；并发下唯一冲突时重新计算重试（段位表路径编码不变则直接报冲突）。
   */
  async createSubject(input: { name: string; type?: string; parentCode?: string | null; category?: string; direction?: string; valueType?: string; isLeaf?: boolean }, ctx: AuditCtx): Promise<SubjectDto> {
    const subjectType = input.type === 'static' ? 'static' : 'operating'
    const prefix = subjectType === 'static' ? 'ST' : 'OP'
    const parentCode = input.parentCode ?? null
    let level = 0
    if (parentCode) {
      // findFirst 显式过滤 status（软删除中间件不注入 findUnique，避免挂到已停用父级下）
      const parent = await prisma.accountSubject.findFirst({ where: { code: parentCode, status: 'active' } })
      if (!parent) throw errors.badRequest('上级科目不存在或已停用')
      if (parent.subjectType !== subjectType) throw errors.badRequest('不能跨科目类型（经营/静态）新增')
      level = parent.level + 1
    }
    let lastCode: string | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = parentCode ? await nextChildSubjectCode(parentCode) : await nextRootSubjectCode(prefix, input.name)
      // 两次计算结果相同仍冲突（段位表路径撞同名根科目）：无需重试，直接报冲突
      if (attempt > 0 && code === lastCode) throw errors.conflict('科目编码已存在')
      lastCode = code
      try {
        const created = await prisma.accountSubject.create({
          data: {
            code, name: input.name,
            subjectType,
            level,
            parentCode,
            category: input.category ?? input.name,
            direction: (input.direction === 'credit' ? 'credit' : 'debit'),
            valueType: normalizeValueType(input.valueType) ?? 'amount',
            isLeaf: input.isLeaf ?? true,
          },
        })
        await recordAudit({ userId: ctx.userId, module: 'data', action: 'create', targetId: created.code, detail: { entity: 'subject' } }, ctx.traceId)
        return subjectDto(created)
      } catch (e) {
        // 唯一约束冲突：并发下同级序号被抢占，重新计算编码后重试
        if ((e as { code?: string }).code !== 'P2002') throw e
      }
    }
    throw errors.conflict('科目编码已存在')
  },

  async updateSubject(id: string, input: { name?: string; category?: string; direction?: string; valueType?: string; isLeaf?: boolean; parentCode?: string | null; status?: string }, ctx: AuditCtx): Promise<SubjectDto> {
    const found = await prisma.accountSubject.findUnique({ where: { id } })
    if (!found) throw errors.notFound('科目不存在')
    // code 不可变（变更 code 会破坏事实/指标引用，接口不接受 code）
    // 停用（active→inactive）需引用保护
    if (input.status === 'inactive' && found.status === 'active') {
      await this.assertSubjectNotReferenced(found.code)
    }
    const updated = await prisma.accountSubject.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        category: input.category ?? undefined,
        direction: input.direction === 'credit' ? 'credit' : input.direction === 'debit' ? 'debit' : undefined,
        valueType: normalizeValueType(input.valueType),
        isLeaf: input.isLeaf ?? undefined,
        parentCode: input.parentCode === undefined ? undefined : input.parentCode,
        status: input.status === 'inactive' ? 'inactive' : input.status === 'active' ? 'active' : undefined,
      },
    })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'update', targetId: updated.code, detail: { entity: 'subject', before: { name: found.name, status: found.status }, after: { name: updated.name, status: updated.status } } }, ctx.traceId)
    return subjectDto(updated)
  },

  /**
   * 科目归类调整（换父）：把科目（含子树）移到新的上级科目下，
   * 重新计算 category（取新 level0 根名）并向下传播到所有后代，level 同步平移。
   * 数据随之在看板 KPI 桶/指标分组间重新归类（category 为决策依据）。
   */
  async reclassifySubject(id: string, input: { parentCode?: string | null }, ctx: AuditCtx): Promise<SubjectDto> {
    const found = await prisma.accountSubject.findUnique({ where: { id } })
    if (!found) throw errors.notFound('科目不存在')
    const newParentCode = input.parentCode === undefined ? found.parentCode : input.parentCode
    if (newParentCode === found.parentCode) return subjectDto(found)

    let newLevel = 0
    let newCategory = found.name // 成为根节点时 category=自身名
    if (newParentCode) {
      const parent = await prisma.accountSubject.findUnique({ where: { code: newParentCode } })
      if (!parent) throw errors.badRequest('目标上级科目不存在')
      if (parent.subjectType !== found.subjectType) throw errors.badRequest('不能跨科目类型（经营/静态）调整归类')
      if (parent.code === found.code) throw errors.badRequest('不能将科目挂到自身下')
      if (await this.isDescendantOf(parent.code, found.code)) throw errors.badRequest('不能将科目移到自己的下级科目下')
      newLevel = parent.level + 1
      newCategory = await this.rootCategoryOf(parent.code)
    }
    const levelDelta = newLevel - found.level

    const updated = await prisma.$transaction(async (tx) => {
      const all = await tx.accountSubject.findMany({ where: { subjectType: found.subjectType }, select: { code: true, parentCode: true, level: true } })
      const childrenMap = new Map<string, string[]>()
      const levelMap = new Map<string, number>()
      for (const s of all) {
        levelMap.set(s.code, s.level)
        if (s.parentCode) {
          const list = childrenMap.get(s.parentCode) ?? []
          list.push(s.code)
          childrenMap.set(s.parentCode, list)
        }
      }
      // 收集子树（含自身）
      const subtree: string[] = []
      const stack = [found.code]
      while (stack.length > 0) {
        const c = stack.pop() as string
        subtree.push(c)
        for (const ch of childrenMap.get(c) ?? []) stack.push(ch)
      }
      // 后代：category 统一为新值，level 平移
      for (const code of subtree) {
        if (code === found.code) continue
        await tx.accountSubject.update({ where: { code }, data: { category: newCategory, level: (levelMap.get(code) ?? 0) + levelDelta } })
      }
      // 自身：换父 + category + level
      return tx.accountSubject.update({ where: { id }, data: { parentCode: newParentCode, category: newCategory, level: newLevel } })
    })

    await prisma.reclassificationLog.create({
      data: {
        type: 'subject',
        sourceSubject: found.parentCode ?? '(root)',
        targetSubject: newParentCode ?? '(root)',
        affectedRows: 0,
        operatedBy: ctx.userId,
        detail: { subjectCode: found.code, fromCategory: found.category, toCategory: newCategory } as never,
      },
    })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'reclassify', targetId: found.code, detail: { kind: 'subject', fromParent: found.parentCode, toParent: newParentCode, fromCategory: found.category, toCategory: newCategory } }, ctx.traceId)
    return subjectDto(updated)
  },

  /** 判断 candidateCode 是否为 ancestorCode 的子孙（防环） */
  async isDescendantOf(candidateCode: string, ancestorCode: string): Promise<boolean> {
    const all = await prisma.accountSubject.findMany({ select: { code: true, parentCode: true } })
    const childrenMap = new Map<string, string[]>()
    for (const s of all) {
      if (s.parentCode) {
        const list = childrenMap.get(s.parentCode) ?? []
        list.push(s.code)
        childrenMap.set(s.parentCode, list)
      }
    }
    const stack = [...(childrenMap.get(ancestorCode) ?? [])]
    while (stack.length > 0) {
      const c = stack.pop() as string
      if (c === candidateCode) return true
      for (const ch of childrenMap.get(c) ?? []) stack.push(ch)
    }
    return false
  },

  /** 向上追溯到 level0 根，返回根名作为 category */
  async rootCategoryOf(code: string): Promise<string> {
    let cur = await prisma.accountSubject.findUnique({ where: { code } })
    let guard = 0
    while (cur && cur.parentCode && guard < 50) {
      cur = await prisma.accountSubject.findUnique({ where: { code: cur.parentCode } })
      guard++
    }
    return cur?.name ?? code
  },

  async deleteSubject(id: string, ctx: AuditCtx): Promise<void> {
    const found = await prisma.accountSubject.findUnique({ where: { id } })
    if (!found) throw errors.notFound('科目不存在')
    // 引用保护：被事实数据或指标公式引用时禁止停用/删除
    await this.assertSubjectNotReferenced(found.code)
    // 软删除
    await prisma.accountSubject.update({ where: { id }, data: { status: 'inactive' } })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'delete', targetId: found.code, detail: { entity: 'subject', before: { name: found.name, status: found.status } } }, ctx.traceId)
  },



  /** 引用完整性保护：科目被事实表或指标公式引用时禁止停用/删除 */
  async assertSubjectNotReferenced(code: string): Promise<void> {
    const [opCount, stCount, bgCount, metricRefs] = await Promise.all([
      prisma.factOperating.count({ where: { accountCode: code } }),
      prisma.factStatic.count({ where: { accountCode: code } }),
      prisma.factBudget.count({ where: { accountCode: code } }),
      prisma.metric.count({
        where: {
          status: 'active',
          OR: [{ dependsOn: { array_contains: code } }, { formula: { contains: `{${code}}` } }],
        },
      }),
    ])
    if (opCount + stCount + bgCount > 0 || metricRefs > 0) {
      throw errors.conflict('科目已被事实数据或指标公式引用，无法停用/删除')
    }
  },

  /** 科目树（扁平列表，含 dataType/valueType）：取该 type 全部 active 科目 + 左联 metric 取 dataType */
  async getSubjectTree(type: 'operating' | 'static'): Promise<{ id: string; code: string; name: string; level: number; parentCode: string | null; category: string; direction: string; valueType: string; isLeaf: boolean; dataType: string }[]> {
    const subjects = await prisma.accountSubject.findMany({ where: { subjectType: type, status: 'active' }, orderBy: { code: 'asc' } })
    const codes = subjects.map((s) => s.code)
    const metrics = await prisma.metric.findMany({ where: { code: { in: codes } }, select: { code: true, dataType: true } })
    const dtMap = new Map(metrics.map((m) => [m.code, m.dataType as string]))
    return subjects.map((s) => ({
      id: s.id,
      code: s.code,
      name: s.name,
      level: s.level,
      parentCode: s.parentCode,
      category: s.category,
      direction: s.direction,
      valueType: s.valueType,
      isLeaf: s.isLeaf,
      dataType: dtMap.get(s.code) ?? 'data',
    }))
  },

  // ===== 指标 =====
  async listMetrics(params: { page: number; pageSize: number; keyword?: string; dataType?: string; includeInactive?: boolean }): Promise<{ items: MetricDto[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const where: Record<string, unknown> = {}
    if (params.dataType) where.dataType = params.dataType
    if (params.keyword) where.OR = [{ name: { contains: params.keyword } }, { code: { contains: params.keyword } }]
    // 显式声明 status 以接管软删除过滤：公式维护页需展示已停用指标（恢复/彻底删除入口）
    if (params.includeInactive) where.status = { in: ['active', 'inactive'] }
    const [rows, total] = await Promise.all([
      prisma.metric.findMany({ where, orderBy: { createdAt: 'asc' }, skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
      prisma.metric.count({ where }),
    ])
    return { items: rows.map(metricDto), total, page: params.page, pageSize: params.pageSize, totalPages: Math.ceil(total / params.pageSize) }
  },

  /** 校验计算类指标公式（全图：操作数存在 + 语法 + 环检测），返回重算的 dependsOn。 */
  async validateCalcMetric(code: string, formula: string): Promise<string[]> {
    const { dependsOn, warnings } = await validateFormulaChange(code, formula)
    if (warnings.length > 0) throw errors.badRequest(warnings.join('；'))
    return dependsOn
  },

  async createMetric(input: { code: string; name: string; dataType?: string; formula?: string; dependsOn?: string[]; sourceAccountCodes?: string[]; category?: string }, ctx: AuditCtx): Promise<MetricDto> {
    const exists = await prisma.metric.findUnique({ where: { code: input.code } })
    if (exists) throw errors.conflict('指标编码已存在')
    const dataType = input.dataType === 'calc' ? 'calc' : input.dataType === 'display' ? 'display' : 'data'
    // 前置条件：计算类指标与科目体系同编码，科目不存在时禁止创建孤儿指标
    if (dataType === 'calc') {
      const subject = await prisma.accountSubject.findFirst({ where: { code: input.code } })
      if (!subject) throw errors.badRequest(`科目体系中不存在编码为 ${input.code} 的科目，请先在维度/科目体系中创建`)
    }
    let dependsOn = input.dependsOn
    if (dataType === 'calc' && input.formula) {
      dependsOn = await this.validateCalcMetric(input.code, input.formula)
    }
    const created = await prisma.metric.create({
      data: {
        code: input.code, name: input.name, category: input.category ?? '自定义', dataType,
        formula: input.formula ?? null,
        dependsOn: (dependsOn ?? []) as never,
        sourceAccountCodes: (input.sourceAccountCodes ?? undefined) as never,
        createdBy: ctx.userId,
      },
    })
    if (dataType === 'calc' && input.formula) {
      await prisma.metricDefinitionHistory.create({
        data: { metricId: created.id, version: 1, formula: input.formula, description: '创建', changedBy: ctx.userId },
      })
    }
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'metric_change', targetId: created.code, detail: { action: 'create', after: input.formula ?? null } }, ctx.traceId)
    return metricDto(created)
  },

  async updateMetric(id: string, input: { name?: string; formula?: string | null; dependsOn?: string[]; sourceAccountCodes?: string[]; status?: string }, ctx: AuditCtx): Promise<MetricDto> {
    const found = await prisma.metric.findUnique({ where: { id } })
    if (!found) throw errors.notFound('指标不存在')
    // 恢复启用须走 restoreMetric 单一通道（含公式有效性复检），禁止经由普通更新绕过
    if (input.status === 'active' && found.status === 'inactive') throw errors.badRequest('请使用恢复启用操作激活已停用指标')

    const before = found.formula
    let formulaData: string | null | undefined
    let dependsOnData: unknown
    let versionInc = 0
    let historyFormula: string | null = null

    if (input.formula === null) {
      // 清空公式
      formulaData = null
      dependsOnData = []
      if (before) { versionInc = 1; historyFormula = null }
    } else if (typeof input.formula === 'string' && input.formula.trim() !== '') {
      const formula = input.formula.trim()
      const dependsOn = found.dataType === 'calc' ? await this.validateCalcMetric(found.code, formula) : extractCodes(formula)
      formulaData = formula
      dependsOnData = dependsOn
      if (before !== formula) { versionInc = 1; historyFormula = formula }
    }

    const updated = await prisma.metric.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        formula: formulaData,
        dependsOn: dependsOnData === undefined ? undefined : (dependsOnData as never),
        sourceAccountCodes: input.sourceAccountCodes === undefined ? undefined : (input.sourceAccountCodes as never),
        status: input.status === 'inactive' ? 'inactive' : input.status === 'active' ? 'active' : undefined,
        version: { increment: versionInc },
      },
    })
    if (versionInc > 0) {
      await prisma.metricDefinitionHistory.create({
        data: { metricId: id, version: updated.version, formula: historyFormula ?? '', description: historyFormula ? '修改公式' : '清空公式', changedBy: ctx.userId },
      })
    }
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'metric_change', targetId: updated.code, detail: { action: 'update', before, after: formulaData === undefined ? before : formulaData } }, ctx.traceId)
    return metricDto(updated)
  },

  /** 查询引用了指定编码的活跃指标（停用/转换前的一致性检查） */
  async findMetricReferrers(code: string): Promise<{ code: string; name: string }[]> {
    const all = await prisma.metric.findMany({ where: { status: 'active', formula: { not: null } }, select: { code: true, name: true, formula: true } })
    return all
      .filter((m) => m.code !== code && m.formula && extractCodes(m.formula).includes(code))
      .map((m) => ({ code: m.code, name: m.name }))
  },

  async deleteMetric(id: string, ctx: AuditCtx): Promise<void> {
    const found = await prisma.metric.findUnique({ where: { id } })
    if (!found) throw errors.notFound('指标不存在')
    // 严格策略：被其他活跃指标公式引用时禁止停用，避免静默破坏引用方公式
    const referrers = await this.findMetricReferrers(found.code)
    if (referrers.length > 0) {
      throw errors.conflict(`该指标被以下指标公式引用，无法停用：${referrers.map((r) => `${r.name}（${r.code}）`).join('、')}`)
    }
    await prisma.metric.update({ where: { id }, data: { status: 'inactive' } })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'metric_change', targetId: found.code, detail: { action: 'delete' } }, ctx.traceId)
  },

  /**
   * 恢复启用已停用指标：重新校验公式有效性（停用期间依赖可能已失效）。
   * 校验失败时默认拒绝；clearFormula=true 则清空公式后恢复（version+1 并写历史）。
   */
  async restoreMetric(id: string, input: { clearFormula?: boolean }, ctx: AuditCtx): Promise<MetricDto> {
    const found = await prisma.metric.findUnique({ where: { id } })
    if (!found) throw errors.notFound('指标不存在')
    if (found.status !== 'inactive') throw errors.badRequest('该指标未停用，无需恢复')

    let clearedFormula = false
    if (found.dataType === 'calc' && found.formula) {
      const { warnings } = await validateFormulaChange(found.code, found.formula)
      if (warnings.length > 0) {
        if (!input.clearFormula) throw errors.badRequest(`公式依赖已失效：${warnings.join('；')}。可选择清空公式后恢复`)
        clearedFormula = true
      }
    }

    const updated = await prisma.metric.update({
      where: { id },
      data: clearedFormula
        ? { status: 'active', formula: null, dependsOn: [] as never, version: { increment: 1 } }
        : { status: 'active' },
    })
    if (clearedFormula) {
      await prisma.metricDefinitionHistory.create({
        data: { metricId: id, version: updated.version, formula: '', description: '恢复启用（公式失效已清空）', changedBy: ctx.userId },
      })
    }
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'metric_change', targetId: found.code, detail: { action: 'restore', before: 'inactive', after: 'active', clearedFormula } }, ctx.traceId)
    return metricDto(updated)
  },

  /**
   * 指标类型转换（高危）：data ↔ calc、data/calc → display。
   * data → calc：可同时携带公式（走全图校验，version+1 写历史）；
   * calc → data：被活跃指标引用时拒绝，清空公式与依赖（原有公式时 version+1 写历史）；
   * data/calc → display：展示类为只读展示用途（calc 源被引用时拒绝，原有公式时清空并写历史）；
   * display 为转换终点，不支持转出。
   */
  async convertMetricType(id: string, input: { dataType: string; formula?: string }, ctx: AuditCtx): Promise<MetricDto> {
    const found = await prisma.metric.findUnique({ where: { id } })
    if (!found) throw errors.notFound('指标不存在')
    if (found.status !== 'active') throw errors.badRequest('请先恢复启用该指标再转换类型')
    const target = input.dataType
    if (target !== 'data' && target !== 'calc' && target !== 'display') throw errors.badRequest('目标类型仅支持 data、calc 或 display')
    if (found.dataType === target) throw errors.badRequest('指标已是目标类型，无需转换')
    // 展示类为只读展示用途：仅可作为转换终点，不支持转出
    if (found.dataType === 'display') throw errors.badRequest('展示类指标为只读展示用途，不支持转换为其他类型')

    const before = found.formula
    if (target === 'calc') {
      // data → calc：科目体系存在性前置校验（与 createMetric 口径一致），可选携带公式
      const subject = await prisma.accountSubject.findFirst({ where: { code: found.code } })
      if (!subject) throw errors.badRequest(`科目体系中不存在编码为 ${found.code} 的科目，无法转换为计算类`)
      const formula = input.formula?.trim() || null
      let dependsOn: string[] = []
      if (formula) dependsOn = await this.validateCalcMetric(found.code, formula)
      const versionInc = formula ? 1 : 0
      const updated = await prisma.metric.update({
        where: { id },
        data: { dataType: 'calc', formula, dependsOn: dependsOn as never, version: { increment: versionInc } },
      })
      if (versionInc > 0) {
        await prisma.metricDefinitionHistory.create({
          data: { metricId: id, version: updated.version, formula: formula as string, description: '转换为计算类', changedBy: ctx.userId },
        })
      }
      await recordAudit({ userId: ctx.userId, module: 'data', action: 'metric_change', targetId: found.code, detail: { action: 'convert', from: found.dataType, to: 'calc', before, after: formula } }, ctx.traceId)
      return metricDto(updated)
    }

    if (target === 'display') {
      // data/calc → display：display 不参与计算，calc 源被活跃公式引用时拒绝
      if (found.dataType === 'calc') {
        const referrers = await this.findMetricReferrers(found.code)
        if (referrers.length > 0) {
          throw errors.conflict(`该指标被以下指标公式引用，无法转换为展示类：${referrers.map((r) => `${r.name}（${r.code}）`).join('、')}`)
        }
      }
      const versionInc = before ? 1 : 0
      const updated = await prisma.metric.update({
        where: { id },
        data: { dataType: 'display', formula: null, dependsOn: [] as never, version: { increment: versionInc } },
      })
      if (versionInc > 0) {
        await prisma.metricDefinitionHistory.create({
          data: { metricId: id, version: updated.version, formula: '', description: '转换为展示类（只读展示）', changedBy: ctx.userId },
        })
      }
      await recordAudit({ userId: ctx.userId, module: 'data', action: 'metric_change', targetId: found.code, detail: { action: 'convert', from: found.dataType, to: 'display', before, after: null } }, ctx.traceId)
      return metricDto(updated)
    }

    // calc → data：引用检查 + 清空公式
    const referrers = await this.findMetricReferrers(found.code)
    if (referrers.length > 0) {
      throw errors.conflict(`该指标被以下指标公式引用，无法转换为数据类：${referrers.map((r) => `${r.name}（${r.code}）`).join('、')}`)
    }
    const versionInc = before ? 1 : 0
    const updated = await prisma.metric.update({
      where: { id },
      data: { dataType: 'data', formula: null, dependsOn: [] as never, version: { increment: versionInc } },
    })
    if (versionInc > 0) {
      await prisma.metricDefinitionHistory.create({
        data: { metricId: id, version: updated.version, formula: '', description: '转换为数据类（清空公式）', changedBy: ctx.userId },
      })
    }
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'metric_change', targetId: found.code, detail: { action: 'convert', from: 'calc', to: 'data', before, after: null } }, ctx.traceId)
    return metricDto(updated)
  },

  /**
   * 物理删除指标（高危，仅 superadmin）：事务内连同公式历史版本一并删除。
   * 前置条件：已停用（inactive）。
   */
  async purgeMetric(id: string, ctx: AuditCtx): Promise<void> {
    const found = await prisma.metric.findUnique({ where: { id } })
    if (!found) throw errors.notFound('指标不存在')
    if (found.status !== 'inactive') throw errors.badRequest('请先停用该指标再彻底删除')
    try {
      await prisma.$transaction(async (tx) => {
        await tx.metricDefinitionHistory.deleteMany({ where: { metricId: id } })
        await tx.metric.delete({ where: { id } })
      })
    } catch (e) {
      if ((e as { code?: string }).code === 'P2003') throw errors.conflict('存在关联数据，无法彻底删除')
      throw e
    }
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'metric_change', targetId: found.code, detail: { action: 'purge', before: { name: found.name, status: found.status } } }, ctx.traceId)
  },

  /** 指标公式版本历史（含变更人用户名与审批状态） */
  async getMetricHistory(id: string): Promise<{ version: number; formula: string; description: string | null; changedBy: string; changedByName: string; changedAt: string; approvedBy: string | null }[]> {
    const metric = await prisma.metric.findUnique({ where: { id } })
    if (!metric) throw errors.notFound('指标不存在')
    const rows = await prisma.metricDefinitionHistory.findMany({ where: { metricId: id }, orderBy: { version: 'desc' } })
    const userIds = Array.from(new Set(rows.map((r) => r.changedBy).filter(Boolean)))
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } })
    const nameMap = new Map(users.map((u) => [u.id, u.username]))
    return rows.map((r) => ({
      version: r.version,
      formula: r.formula,
      description: r.description,
      changedBy: r.changedBy,
      changedByName: nameMap.get(r.changedBy) ?? r.changedBy,
      changedAt: r.changedAt.toISOString(),
      approvedBy: r.approvedBy,
    }))
  },

  /** 回滚到指定版本：恢复该版本公式并重算依赖，写新历史与审计 */
  async rollbackMetric(id: string, version: number, ctx: AuditCtx): Promise<MetricDto> {
    const metric = await prisma.metric.findUnique({ where: { id } })
    if (!metric) throw errors.notFound('指标不存在')
    const target = await prisma.metricDefinitionHistory.findFirst({ where: { metricId: id, version } })
    if (!target) throw errors.notFound('版本不存在')
    const before = metric.formula
    const formula = target.formula || null
    let dependsOn: string[] = []
    if (formula) {
      dependsOn = metric.dataType === 'calc' ? await this.validateCalcMetric(metric.code, formula) : extractCodes(formula)
    }
    const newVersion = metric.version + 1
    const updated = await prisma.metric.update({
      where: { id },
      data: { formula, dependsOn: dependsOn as never, version: { increment: 1 } },
    })
    await prisma.metricDefinitionHistory.create({
      data: { metricId: id, version: newVersion, formula: formula ?? '', description: `回滚到 v${version}`, changedBy: ctx.userId },
    })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'metric_change', targetId: metric.code, detail: { action: 'rollback', toVersion: version, before, after: formula } }, ctx.traceId)
    return metricDto(updated)
  },

  /**
   * 公式试算：用指定公司/期间的聚合树值代入公式求值。
   * 数据源与指标页/存货页完全同口径：buildOperatingTree/buildStaticTree 输出
   * （父=子求和 + DAG 计算层 + scope 过滤），覆盖跨树引用（静态比率引用经营科目）、
   * 跨维度引用（{CODE@维度} 复合键）与无公式 calc 聚合节点（如「存货」「成本」子树根）。
   * 公司缺省 = 当前用户数据权限范围全部单体；汇总主体按「全有或全无」展开为成员。
   */
  async trialCalc(
    input: { formula: string; companyCode?: string; period?: string },
    authUser?: Pick<AuthUserContext, 'companyCode' | 'scopeValue' | 'dataScopeCodes'>,
  ): Promise<{ value: number | null; period: string | null; operands: { code: string; name: string; value: number; hasData: boolean }[]; batchInfo: { id: string; filename: string; activatedAt: string } | null }> {
    const codes = extractCodes(input.formula)
    if (codes.length === 0) return { value: null, period: null, operands: [], batchInfo: null }
    const batch = await prisma.importBatch.findFirst({ where: { dataType: 'operating', lifecycleStatus: 'active' }, select: { id: true, fileName: true, updatedAt: true } })
    if (!batch) return { value: null, period: null, operands: [], batchInfo: null }
    let period: string | undefined = input.period
    if (!period) {
      const latest = await prisma.factOperating.findFirst({ where: { batchId: batch.id }, orderBy: { period: 'desc' }, select: { period: true } })
      period = latest?.period ?? undefined
    }
    if (!period) return { value: null, period: null, operands: [], batchInfo: null }

    // 公司：缺省 = 数据权限范围全部单体；指定公司（单体/汇总主体）经映射展开（越权 403）
    const user = authUser ?? { companyCode: null, scopeValue: '*', dataScopeCodes: null }
    const companyCodes = await resolveCompanyCodes(user, input.companyCode ?? undefined)

    // 操作数引用（仅输入公式：树已求值全部 calc 指标，无需手工展开依赖链）
    const dimRefs = new Map<string, Set<string>>() // 维度码 → 引用该维度的 code 集合
    // 同期类维度：公式引用时 {DAYS_YTD} 按去年口径（对齐 buildStaticTree 同期列平移）
    const SAME_DIM_CODES = new Set(['SAME_PERIOD_ACTUAL', 'SAME_PERIOD_YTD', 'SAME_PERIOD_AMOUNT', 'LAST_YEAR_START'])
    let needsDays = false
    let samePeriodCtx = false
    for (const r of extractOperandRefs(input.formula)) {
      if (PSEUDO_OPERANDS.has(r.code)) { needsDays = true; continue }
      if (!r.dim) continue
      const set = dimRefs.get(r.dim) ?? new Set<string>()
      set.add(r.code)
      dimRefs.set(r.dim, set)
      if (SAME_DIM_CODES.has(r.dim)) samePeriodCtx = true
    }

    // 数据源：聚合树（两树内部跨树引用由 skipExternal 打破，无递归）
    const [opTree, stTree] = await Promise.all([
      AggregationService.buildOperatingTree(companyCodes, period),
      AggregationService.buildStaticTree(companyCodes, period),
    ])
    const opByCode = new Map(flattenValueTree(opTree).map((n) => [n.code, n]))
    const stByCode = new Map(flattenValueTree(stTree).map((n) => [n.code, n]))
    const nodeOf = (code: string) => (code.startsWith('ST_') ? stByCode : opByCode).get(code)

    // 裸键 {CODE}：经营=本月实际、静态=本期金额（树聚合值，含无公式 calc 聚合节点的子求和）
    const evalValues: Record<string, number> = {}
    const hasDataMap = new Map<string, boolean>()
    for (const c of codes) {
      const dim = c.startsWith('ST_') ? STATIC_DIMS.CURRENT_AMOUNT : OPERATING_DIMS.ACTUAL_MONTH
      const v = nodeOf(c)?.values[dim] ?? 0
      evalValues[c] = v
      hasDataMap.set(c, v !== 0)
    }
    // 复合键 {CODE@DIM}：按科目所属树取对应维度值（页面 crossDim 复合键同款语义）
    const derivedKeys = new Set<string>()
    for (const [dim, set] of dimRefs) {
      for (const c of set) {
        const v = nodeOf(c)?.values[dim] ?? 0
        evalValues[`${c}@${dim}`] = v
        if (v !== 0) derivedKeys.add(`${c}@${dim}`)
      }
    }
    // 伪操作数 {DAYS_YTD}：本期语境=今年财年累计天数；公式引用同期类维度时按去年天数
    if (needsDays) evalValues.DAYS_YTD = fiscalYtdDays(samePeriodCtx ? periodMinusYears(period, 1) : period)

    // 操作数回显：按直接引用（含维度后缀/伪操作数）展示，value 取展开后的值
    const DIM_LABELS: Record<string, string> = {
      BUDGET_AMOUNT: '预算', ACTUAL_MONTH: '本月实际', SAME_PERIOD_ACTUAL: '同期实际', YTD_ACTUAL: '本年累计', SAME_PERIOD_YTD: '同期累计',
      CURRENT_AMOUNT: '本期', YEAR_START: '年初', SAME_PERIOD_AMOUNT: '同期', LAST_YEAR_START: '上年年初',
    }
    const subjects = await prisma.accountSubject.findMany({ where: { code: { in: codes } }, select: { code: true, name: true } })
    const nameMap = new Map(subjects.map((s) => [s.code, s.name]))
    const seen = new Set<string>()
    const operands: { code: string; name: string; value: number; hasData: boolean }[] = []
    for (const r of extractOperandRefs(input.formula)) {
      const key = r.dim ? `${r.code}@${r.dim}` : r.code
      if (seen.has(key)) continue
      seen.add(key)
      if (PSEUDO_OPERANDS.has(r.code)) {
        operands.push({ code: key, name: '期间天数', value: evalValues[r.code] ?? 0, hasData: true })
        continue
      }
      const baseName = nameMap.get(r.code) ?? r.code
      operands.push({
        code: key,
        name: r.dim ? `${baseName}(${DIM_LABELS[r.dim] ?? r.dim})` : baseName,
        value: r.dim ? (evalValues[key] ?? 0) : (evalValues[r.code] ?? 0),
        hasData: r.dim ? derivedKeys.has(key) : (hasDataMap.get(r.code) ?? false),
      })
    }
    // 除零/非有限结果兜底：无法计算返回 null（前端显示「无法计算」）
    let value: number | null = null
    try {
      const v = evaluateFormula(input.formula, evalValues)
      value = Number.isFinite(v) ? Number(v.toFixed(2)) : null
    } catch {
      value = null
    }
    return { value, period, operands, batchInfo: { id: batch.id, filename: batch.fileName, activatedAt: batch.updatedAt.toISOString() } }
  },

  /** 审批通过：将最新一条历史标记为已审批 */
  async approveMetric(id: string, ctx: AuditCtx): Promise<{ approved: boolean }> {
    const metric = await prisma.metric.findUnique({ where: { id } })
    if (!metric) throw errors.notFound('指标不存在')
    const latest = await prisma.metricDefinitionHistory.findFirst({ where: { metricId: id }, orderBy: { version: 'desc' } })
    if (!latest) throw errors.notFound('无可审批的版本')
    await prisma.metricDefinitionHistory.update({ where: { id: latest.id }, data: { approvedBy: ctx.userId } })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'metric_change', targetId: metric.code, detail: { action: 'approve', version: latest.version } }, ctx.traceId)
    return { approved: true }
  },

  /** 审批驳回：回滚到上一版本（若仅一个版本则清空公式） */
  async rejectMetric(id: string, ctx: AuditCtx): Promise<MetricDto> {
    const metric = await prisma.metric.findUnique({ where: { id } })
    if (!metric) throw errors.notFound('指标不存在')
    const histories = await prisma.metricDefinitionHistory.findMany({ where: { metricId: id }, orderBy: { version: 'desc' } })
    if (histories.length === 0) throw errors.notFound('无可驳回的版本')
    const targetVersion = histories.length > 1 ? histories[1].version : 0
    if (targetVersion === 0) {
      // 无上一版本 → 清空公式
      const updated = await prisma.metric.update({ where: { id }, data: { formula: null, dependsOn: [] as never, version: { increment: 1 } } })
      await prisma.metricDefinitionHistory.create({ data: { metricId: id, version: metric.version + 1, formula: '', description: '审批驳回（清空）', changedBy: ctx.userId } })
      await recordAudit({ userId: ctx.userId, module: 'data', action: 'metric_change', targetId: metric.code, detail: { action: 'reject', result: 'cleared' } }, ctx.traceId)
      return metricDto(updated)
    }
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'metric_change', targetId: metric.code, detail: { action: 'reject', toVersion: targetVersion } }, ctx.traceId)
    return this.rollbackMetric(id, targetVersion, ctx)
  },

  /** 依赖影响分析：dependsOn（本指标引用）+ usedBy（引用本指标的指标） */
  async analyzeDependencies(id: string): Promise<{ code: string; dependsOn: { code: string; name: string }[]; usedBy: { code: string; name: string }[] }> {
    const metric = await prisma.metric.findUnique({ where: { id } })
    if (!metric) throw errors.notFound('指标不存在')
    const dependsOn = Array.isArray(metric.dependsOn) ? (metric.dependsOn as string[]) : []
    const all = await prisma.metric.findMany({ where: { status: 'active' }, select: { code: true, name: true, formula: true } })
    const usedBy = all
      .filter((m) => m.code !== metric.code && m.formula && extractCodes(m.formula).includes(metric.code))
      .map((m) => ({ code: m.code, name: m.name }))
    const depSubjects = await prisma.accountSubject.findMany({ where: { code: { in: dependsOn } }, select: { code: true, name: true } })
    const depMap = new Map(depSubjects.map((s) => [s.code, s.name]))
    return {
      code: metric.code,
      dependsOn: dependsOn.map((c) => ({ code: c, name: depMap.get(c) ?? c })),
      usedBy,
    }
  },

  // ===== 导出（科目体系） =====
  async exportSubjects(type?: string): Promise<Buffer> {
    const where = type ? { subjectType: type as 'operating' | 'static' } : {}
    const rows = await prisma.accountSubject.findMany({ where, orderBy: { code: 'asc' } })
    return buildExcel('科目体系', [
      { header: '编码', key: 'code' }, { header: '名称', key: 'name', width: 28 },
      { header: '类型', key: 'type' }, { header: '层级', key: 'level' },
      { header: '大类', key: 'category', width: 16 }, { header: '借贷方向', key: 'direction' },
      { header: '是否叶子', key: 'isLeaf' },
    ], rows.map((r) => ({ code: r.code, name: r.name, type: r.subjectType, level: r.level, category: r.category, direction: r.direction, isLeaf: r.isLeaf ? '是' : '否' })))
  },

  // ===== 批次差异对比（US-03） =====
  /**
   * 两批次差异对比：按 (公司, 科目, 期间) 键对比 operating/static/budget 三类批次事实值。
   * - 仅同类型、非 purged 批次可比；transaction/inventory v1 不支持；
   * - 结果按数据范围过滤（仅对比用户有权限的公司）；
   * - changed/added/removed 各上限 500 行，超出截断并在 summary 标注。
   */
  async compareBatches(aId: string, bId: string, scope?: ScopeInput): Promise<ImportDiff> {
    const [a, b] = await Promise.all([
      prisma.importBatch.findUnique({ where: { id: aId } }),
      prisma.importBatch.findUnique({ where: { id: bId } }),
    ])
    if (!a || !b) throw errors.notFound('导入批次不存在')
    if (a.lifecycleStatus === 'purged' || b.lifecycleStatus === 'purged') throw errors.badRequest('已清除的批次不可参与对比')
    if (a.dataType !== b.dataType) throw errors.badRequest('仅支持同类型批次对比')
    if (a.dataType === 'transaction' || a.dataType === 'inventory') {
      throw errors.badRequest('该数据类型暂不支持对比（v1 仅支持经营/静态/预算数据）')
    }
    const template = a.dataType

    // 数据范围过滤：'all'/无上下文不过滤；'companies' 收敛到授权单体；'none' 返回空结果
    const s = await effectiveScope(scope)
    const allowedCompanies = s !== null && s.type === 'companies' ? s.companyCodes : s?.type === 'none' ? [] : undefined
    const companyWhere = allowedCompanies ? { companyCode: { in: allowedCompanies } } : {}

    // 读取两批次事实行并归一化为统一行（periodKey 用于对比键，periodLabel 用于展示）
    // 读取上限 COMPARE_FETCH_LIMIT：防数万行全量载入内存，超限按截断处理
    type NormalizedRow = { companyCode: string; accountCode: string; value: Prisma.Decimal; periodKey: string; periodLabel: string }
    let aRows: NormalizedRow[]
    let bRows: NormalizedRow[]
    let fetchTruncated = false
    if (template === 'operating') {
      const withPeriod = { select: { companyCode: true, accountCode: true, period: true, periodDimCode: true, value: true } }
      const ra = await prisma.factOperating.findMany({ where: { batchId: aId, ...companyWhere }, take: COMPARE_FETCH_LIMIT, ...withPeriod })
      const rb = await prisma.factOperating.findMany({ where: { batchId: bId, ...companyWhere }, take: COMPARE_FETCH_LIMIT, ...withPeriod })
      fetchTruncated = ra.length === COMPARE_FETCH_LIMIT || rb.length === COMPARE_FETCH_LIMIT
      aRows = ra.map((r) => ({ companyCode: r.companyCode, accountCode: r.accountCode, value: r.value, periodKey: `${r.period}|${r.periodDimCode}`, periodLabel: r.period }))
      bRows = rb.map((r) => ({ companyCode: r.companyCode, accountCode: r.accountCode, value: r.value, periodKey: `${r.period}|${r.periodDimCode}`, periodLabel: r.period }))
    } else if (template === 'static') {
      const withSnap = { select: { companyCode: true, accountCode: true, snapshotDate: true, periodDimCode: true, value: true } }
      const ra = await prisma.factStatic.findMany({ where: { batchId: aId, ...companyWhere }, take: COMPARE_FETCH_LIMIT, ...withSnap })
      const rb = await prisma.factStatic.findMany({ where: { batchId: bId, ...companyWhere }, take: COMPARE_FETCH_LIMIT, ...withSnap })
      fetchTruncated = ra.length === COMPARE_FETCH_LIMIT || rb.length === COMPARE_FETCH_LIMIT
      aRows = ra.map((r) => ({ companyCode: r.companyCode, accountCode: r.accountCode, value: r.value, periodKey: `${ymOfDate(r.snapshotDate)}|${r.periodDimCode}`, periodLabel: ymOfDate(r.snapshotDate) }))
      bRows = rb.map((r) => ({ companyCode: r.companyCode, accountCode: r.accountCode, value: r.value, periodKey: `${ymOfDate(r.snapshotDate)}|${r.periodDimCode}`, periodLabel: ymOfDate(r.snapshotDate) }))
    } else {
      const withFy = { select: { companyCode: true, accountCode: true, fiscalYear: true, period: true, value: true } }
      const ra = await prisma.factBudget.findMany({ where: { batchId: aId, ...companyWhere }, take: COMPARE_FETCH_LIMIT, ...withFy })
      const rb = await prisma.factBudget.findMany({ where: { batchId: bId, ...companyWhere }, take: COMPARE_FETCH_LIMIT, ...withFy })
      fetchTruncated = ra.length === COMPARE_FETCH_LIMIT || rb.length === COMPARE_FETCH_LIMIT
      aRows = ra.map((r) => ({ companyCode: r.companyCode, accountCode: r.accountCode, value: r.value, periodKey: `${r.fiscalYear}|${r.period}`, periodLabel: `${r.fiscalYear}/${r.period}` }))
      bRows = rb.map((r) => ({ companyCode: r.companyCode, accountCode: r.accountCode, value: r.value, periodKey: `${r.fiscalYear}|${r.period}`, periodLabel: `${r.fiscalYear}/${r.period}` }))
    }

    // 科目名称联查
    const accountCodes = [...new Set([...aRows.map((r) => r.accountCode), ...bRows.map((r) => r.accountCode)])]
    const subjects = await prisma.accountSubject.findMany({ where: { code: { in: accountCodes } }, select: { code: true, name: true } })
    const nameMap = new Map(subjects.map((s) => [s.code, s.name]))
    const rowOf = (r: NormalizedRow): ImportDiffRow => ({
      companyCode: r.companyCode,
      accountCode: r.accountCode,
      subjectName: nameMap.get(r.accountCode) ?? r.accountCode,
      period: r.periodLabel,
      oldValue: 0,
      newValue: 0,
      delta: 0,
      deltaPercent: null,
    })

    const aMap = new Map<string, NormalizedRow>()
    const bMap = new Map<string, NormalizedRow>()
    for (const r of aRows) aMap.set(`${r.companyCode}|${r.accountCode}|${r.periodKey}`, r)
    for (const r of bRows) bMap.set(`${r.companyCode}|${r.accountCode}|${r.periodKey}`, r)

    const changed: ImportDiffRow[] = []
    const added: ImportDiffRow[] = []
    const removed: ImportDiffRow[] = []
    let totalDelta = 0
    for (const [key, ar] of aMap) {
      const br = bMap.get(key)
      if (!br) {
        removed.push({ ...rowOf(ar), oldValue: Number(ar.value), newValue: 0, delta: -Number(ar.value), deltaPercent: null })
        totalDelta -= Number(ar.value)
        continue
      }
      const oldV = Number(ar.value)
      const newV = Number(br.value)
      if (oldV === newV) continue
      const delta = newV - oldV
      totalDelta += delta
      changed.push({
        ...rowOf(ar),
        oldValue: oldV,
        newValue: newV,
        delta,
        deltaPercent: oldV === 0 ? null : Number(((delta / Math.abs(oldV)) * 100).toFixed(1)),
      })
    }
    for (const [key, br] of bMap) {
      if (aMap.has(key)) continue
      added.push({ ...rowOf(br), oldValue: 0, newValue: Number(br.value), delta: Number(br.value), deltaPercent: null })
      totalDelta += Number(br.value)
    }

    changed.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
    const truncated = changed.length > DIFF_ROW_LIMIT || added.length > DIFF_ROW_LIMIT || removed.length > DIFF_ROW_LIMIT || fetchTruncated
    return {
      a: batchMetaOf(a),
      b: batchMetaOf(b),
      changed: changed.slice(0, DIFF_ROW_LIMIT),
      added: added.slice(0, DIFF_ROW_LIMIT),
      removed: removed.slice(0, DIFF_ROW_LIMIT),
      summary: {
        changedCount: changed.length,
        addedCount: added.length,
        removedCount: removed.length,
        totalDelta: Number(totalDelta.toFixed(4)),
        truncated,
      },
    }
  },
}
