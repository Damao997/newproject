import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { validateFormulaChange, extractCodes, extractOperandRefs, PSEUDO_OPERANDS } from './FormulaRuleService'
import { evaluateFormula, topoSortMetrics } from '../lib/formula'
import { OPERATING_DIMS } from '../lib/metric-values'
import { fiscalYearStartPeriod, periodMinusYears, fiscalYtdDays } from '../lib/period'
import { buildExcel } from '../lib/excel'
import { effectiveScope } from '../lib/scope-guard'
import { withoutScope } from '../middleware/scope-context'

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
export interface SubjectDto { id: string; code: string; name: string; type: string; level: number; parentCode: string | null; category: string; direction: string; valueType: string; isLeaf: boolean; status: string }

function subjectDto(s: { id: string; code: string; name: string; subjectType: string; level: number; parentCode: string | null; category: string; direction: string; valueType: string; isLeaf: boolean; status: string }): SubjectDto {
  return { id: s.id, code: s.code, name: s.name, type: s.subjectType, level: s.level, parentCode: s.parentCode, category: s.category, direction: s.direction, valueType: s.valueType, isLeaf: s.isLeaf, status: s.status }
}

/** 校验并归一化值类型入参；非法/缺省返回 undefined（update 不改动） */
function normalizeValueType(v?: string): 'amount' | 'quantity' | 'ratio' | undefined {
  return v === 'amount' || v === 'quantity' || v === 'ratio' ? v : undefined
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
      prisma.accountSubject.findMany({ where, orderBy: { orderNo: 'asc' }, skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
      prisma.accountSubject.count({ where }),
    ])
    return { items: rows.map(subjectDto), total, page: params.page, pageSize: params.pageSize, totalPages: Math.ceil(total / params.pageSize) }
  },

  async createSubject(input: { code: string; name: string; type?: string; level?: number; parentCode?: string | null; category?: string; direction?: string; valueType?: string; isLeaf?: boolean }, ctx: AuditCtx): Promise<SubjectDto> {
    const exists = await prisma.accountSubject.findUnique({ where: { code: input.code } })
    if (exists) throw errors.conflict('科目编码已存在')
    const created = await prisma.accountSubject.create({
      data: {
        code: input.code, name: input.name,
        subjectType: (input.type === 'static' ? 'static' : 'operating'),
        level: input.level ?? 0,
        parentCode: input.parentCode ?? null,
        category: input.category ?? input.name,
        direction: (input.direction === 'credit' ? 'credit' : 'debit'),
        valueType: normalizeValueType(input.valueType) ?? 'amount',
        isLeaf: input.isLeaf ?? true,
      },
    })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'create', targetId: created.code, detail: { entity: 'subject' } }, ctx.traceId)
    return subjectDto(created)
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
    const subjects = await prisma.accountSubject.findMany({ where: { subjectType: type, status: 'active' }, orderBy: { orderNo: 'asc' } })
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

  /** 公式试算：用指定公司/期间的本月实际值代入公式求值 */
  async trialCalc(input: { formula: string; companyCode?: string; period?: string }): Promise<{ value: number | null; period: string | null; operands: { code: string; name: string; value: number; hasData: boolean }[]; batchInfo: { id: string; filename: string; activatedAt: string } | null }> {
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

    // 1）递归展开 calc 依赖：先取全部计算类指标公式，再从直接 code 出发逐层收集传递依赖
    const calcMetrics = await prisma.metric.findMany({
      where: { dataType: 'calc', formula: { not: null }, status: 'active' },
      select: { code: true, formula: true },
    })
    const calcFormulaByCode = new Map(calcMetrics.map((m) => [m.code, m.formula as string]))
    const allCodes = new Set<string>(codes)
    const expandQueue = [...codes]
    while (expandQueue.length > 0) {
      const c = expandQueue.shift() as string
      const f = calcFormulaByCode.get(c)
      if (!f) continue
      for (const dep of extractCodes(f)) {
        if (!allCodes.has(dep)) {
          allCodes.add(dep)
          expandQueue.push(dep)
        }
      }
    }
    const allCodeList = [...allCodes]

    // 2）一次性取全量 code 的事实值（经营科目取 ACTUAL_MONTH，静态科目取同期间快照月，支持跨类型公式如 ROA）
    const where: Record<string, unknown> = { batchId: batch.id, period, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, accountCode: { in: allCodeList } }
    if (input.companyCode) where.companyCode = input.companyCode
    const facts = await prisma.factOperating.groupBy({ by: ['accountCode'], where, _sum: { value: true } })
    const valueMap = new Map(facts.map((f) => [f.accountCode, Number(f._sum.value ?? 0)]))

    // 2b）跨维度引用（{CODE@维度}/{DAYS_YTD}）：收集全部公式的复合键需求并逐维取值
    const evalValues: Record<string, number> = {}
    const allFormulas = [input.formula, ...allCodeList.filter((c) => calcFormulaByCode.has(c)).map((c) => calcFormulaByCode.get(c) as string)]
    const dimRefs = new Map<string, Set<string>>() // 维度码 → 引用该维度的 code 集合
    let needsDays = false
    for (const f of allFormulas) {
      for (const r of extractOperandRefs(f)) {
        if (PSEUDO_OPERANDS.has(r.code)) { needsDays = true; continue }
        if (!r.dim) continue
        const set = dimRefs.get(r.dim) ?? new Set<string>()
        set.add(r.code)
        dimRefs.set(r.dim, set)
      }
    }
    if (needsDays) evalValues.DAYS_YTD = fiscalYtdDays(period)
    const prevPeriod = periodMinusYears(period, 1)
    const fyStart = fiscalYearStartPeriod(period)
    const prevFyStart = fiscalYearStartPeriod(prevPeriod)
    // 经营维度复合键：单期（本月/同期）或区间求和（本年累计/同期累计）；预算维度试算不支持（记 0）
    const opDimRanges: Record<string, { gte: string; lte: string }> = {
      ACTUAL_MONTH: { gte: period, lte: period },
      SAME_PERIOD_ACTUAL: { gte: prevPeriod, lte: prevPeriod },
      YTD_ACTUAL: { gte: fyStart, lte: period },
      SAME_PERIOD_YTD: { gte: prevFyStart, lte: prevPeriod },
    }
    for (const [dim, codeSet] of dimRefs) {
      const range = opDimRanges[dim]
      const opRefCodes = [...codeSet].filter((c) => !c.startsWith('ST_'))
      if (!range || opRefCodes.length === 0) continue
      const dimWhere: Record<string, unknown> = { batchId: batch.id, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, period: range, accountCode: { in: opRefCodes } }
      if (input.companyCode) dimWhere.companyCode = input.companyCode
      const grouped = await prisma.factOperating.groupBy({ by: ['accountCode'], where: dimWhere, _sum: { value: true } })
      for (const g of grouped) evalValues[`${g.accountCode}@${dim}`] = Number(g._sum.value ?? 0)
    }
    // 静态维度复合键目标快照月
    const stDimMonths: Record<string, string> = {
      CURRENT_AMOUNT: period,
      YEAR_START: fyStart,
      SAME_PERIOD_AMOUNT: prevPeriod,
      LAST_YEAR_START: prevFyStart,
    }
    const stCodes = allCodeList.filter((c) => c.startsWith('ST_'))
    if (stCodes.length > 0) {
      const stBatches = await prisma.importBatch.findMany({ where: { dataType: 'static', lifecycleStatus: 'active' }, select: { id: true } })
      if (stBatches.length > 0) {
        const stWhere: Record<string, unknown> = { batchId: { in: stBatches.map((b) => b.id) }, accountCode: { in: stCodes } }
        if (input.companyCode) stWhere.companyCode = input.companyCode
        const stFacts = await prisma.factStatic.groupBy({ by: ['accountCode', 'snapshotDate'], where: stWhere, _sum: { value: true } })
        for (const g of stFacts) {
          const d = g.snapshotDate as Date
          const mon = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
          if (mon === period) valueMap.set(g.accountCode, (valueMap.get(g.accountCode) ?? 0) + Number(g._sum.value ?? 0))
          // 静态复合键：命中目标快照月的维度引用累加
          for (const [dim, mon2] of Object.entries(stDimMonths)) {
            if (mon === mon2 && dimRefs.get(dim)?.has(g.accountCode)) {
              const k = `${g.accountCode}@${dim}`
              evalValues[k] = (evalValues[k] ?? 0) + Number(g._sum.value ?? 0)
            }
          }
        }
      }
    }

    // 3）拓扑序求值 calc 指标（环检测由 topoSortMetrics 负责），写回 evalValues
    for (const c of allCodeList) evalValues[c] = valueMap.get(c) ?? 0
    const calcNodes = allCodeList
      .filter((c) => calcFormulaByCode.has(c))
      .map((c) => ({ code: c, dependsOn: extractCodes(calcFormulaByCode.get(c) as string) }))
    const hasDataMap = new Map<string, boolean>(allCodeList.map((c) => [c, valueMap.has(c)]))
    if (calcNodes.length > 0) {
      const order = topoSortMetrics(calcNodes)
      for (const c of order) {
        const f = calcFormulaByCode.get(c) as string
        try {
          evalValues[c] = evaluateFormula(f, evalValues)
        } catch {
          evalValues[c] = 0
        }
        const deps = extractCodes(f)
        hasDataMap.set(c, deps.some((d) => hasDataMap.get(d) ?? false))
      }
    }

    // 4）操作数回显：按直接引用（含维度后缀/伪操作数）展示，value 取展开后的值
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
        hasData: r.dim ? evalValues[key] !== undefined : (hasDataMap.get(r.code) ?? false),
      })
    }
    let value: number | null = null
    try {
      value = Number(evaluateFormula(input.formula, evalValues).toFixed(2))
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
    const rows = await prisma.accountSubject.findMany({ where, orderBy: { orderNo: 'asc' } })
    return buildExcel('科目体系', [
      { header: '编码', key: 'code' }, { header: '名称', key: 'name', width: 28 },
      { header: '类型', key: 'type' }, { header: '层级', key: 'level' },
      { header: '大类', key: 'category', width: 16 }, { header: '借贷方向', key: 'direction' },
      { header: '是否叶子', key: 'isLeaf' },
    ], rows.map((r) => ({ code: r.code, name: r.name, type: r.subjectType, level: r.level, category: r.category, direction: r.direction, isLeaf: r.isLeaf ? '是' : '否' })))
  },
}
