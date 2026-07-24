import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { validateFormulaChange, extractCodes } from './FormulaRuleService'
import { evaluateFormula } from '../lib/formula'
import { OPERATING_DIMS } from '../lib/metric-values'
import { buildExcel } from '../lib/excel'

/**
 * 数据管理服务：公司主体、科目体系 CRUD、指标 CRUD（含公式与 DAG 校验）、导出。
 */

interface AuditCtx { userId: string; traceId?: string }

// ---------------- 公司 ----------------
export interface CompanyDto { id: string; code: string; name: string; type: string; entityType: string; businessUnit: string | null; parentCode: string | null; legalEntity: string | null; managementEntity: string | null; orderNo: number; status: string }

function companyDto(c: { id: string; code: string; name: string; entityType: string; businessUnit: string | null; parentCode: string | null; legalEntity: string | null; managementEntity: string | null; orderNo: number; status: string }): CompanyDto {
  return {
    id: c.id, code: c.code, name: c.name,
    type: c.entityType === 'single' ? 'entity' : 'summary',
    entityType: c.entityType,
    businessUnit: c.businessUnit,
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
export interface SubjectDto { id: string; code: string; name: string; type: string; level: number; parentCode: string | null; category: string; direction: string; isLeaf: boolean; status: string }

function subjectDto(s: { id: string; code: string; name: string; subjectType: string; level: number; parentCode: string | null; category: string; direction: string; isLeaf: boolean; status: string }): SubjectDto {
  return { id: s.id, code: s.code, name: s.name, type: s.subjectType, level: s.level, parentCode: s.parentCode, category: s.category, direction: s.direction, isLeaf: s.isLeaf, status: s.status }
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
  async listCompanies(): Promise<CompanyDto[]> {
    const rows = await prisma.company.findMany({ orderBy: { orderNo: 'asc' } })
    return rows.map(companyDto)
  },

  async createCompany(input: { code: string; name: string; entityType?: string; businessUnit?: string | null; parentCode?: string | null; legalEntity?: string | null; managementEntity?: string | null; orderNo?: number }, ctx: AuditCtx): Promise<CompanyDto> {
    const exists = await prisma.company.findUnique({ where: { code: input.code } })
    if (exists) throw errors.conflict('公司编码已存在')
    const created = await prisma.company.create({
      data: {
        code: input.code,
        name: input.name,
        entityType: input.entityType === 'summary' ? 'summary' : 'single',
        businessUnit: input.businessUnit ?? null,
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

  async updateCompany(id: string, input: { name?: string; entityType?: string; businessUnit?: string | null; parentCode?: string | null; legalEntity?: string | null; managementEntity?: string | null; orderNo?: number; status?: string }, ctx: AuditCtx): Promise<CompanyDto> {
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
        entityType: input.entityType === 'summary' ? 'summary' : input.entityType === 'single' ? 'single' : undefined,
        businessUnit: input.businessUnit === undefined ? undefined : input.businessUnit,
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
    const [opCount, stCount, bgCount, userCount, mapCount] = await Promise.all([
      prisma.factOperating.count({ where: { companyCode: code } }),
      prisma.factStatic.count({ where: { companyCode: code } }),
      prisma.factBudget.count({ where: { companyCode: code } }),
      prisma.user.count({ where: { companyCode: code } }),
      prisma.companyAggregationMap.count({ where: { OR: [{ summaryCompanyCode: code }, { singleCompanyCode: code }] } }),
    ])
    if (opCount + stCount + bgCount > 0 || userCount > 0 || mapCount > 0) {
      throw errors.conflict('公司已被事实数据、用户或汇总映射引用，无法停用/删除')
    }
  },

  // ===== 汇总映射（单体 → 汇总主体成员） =====
  async listAggregationMap(summaryCode?: string): Promise<AggregationMapDto[]> {
    const where = summaryCode ? { summaryCompanyCode: summaryCode } : {}
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
  async listSubjects(params: { page: number; pageSize: number; type?: string; keyword?: string }): Promise<{ items: SubjectDto[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const where: Record<string, unknown> = {}
    if (params.type) where.subjectType = params.type
    if (params.keyword) where.OR = [{ name: { contains: params.keyword } }, { code: { contains: params.keyword } }]
    const [rows, total] = await Promise.all([
      prisma.accountSubject.findMany({ where, orderBy: { orderNo: 'asc' }, skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
      prisma.accountSubject.count({ where }),
    ])
    return { items: rows.map(subjectDto), total, page: params.page, pageSize: params.pageSize, totalPages: Math.ceil(total / params.pageSize) }
  },

  async createSubject(input: { code: string; name: string; type?: string; level?: number; parentCode?: string | null; category?: string; direction?: string; isLeaf?: boolean }, ctx: AuditCtx): Promise<SubjectDto> {
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
        isLeaf: input.isLeaf ?? true,
      },
    })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'create', targetId: created.code, detail: { entity: 'subject' } }, ctx.traceId)
    return subjectDto(created)
  },

  async updateSubject(id: string, input: { name?: string; category?: string; direction?: string; isLeaf?: boolean; parentCode?: string | null; status?: string }, ctx: AuditCtx): Promise<SubjectDto> {
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
        isLeaf: input.isLeaf ?? undefined,
        parentCode: input.parentCode === undefined ? undefined : input.parentCode,
        status: input.status === 'inactive' ? 'inactive' : input.status === 'active' ? 'active' : undefined,
      },
    })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'update', targetId: updated.code, detail: { entity: 'subject', before: { name: found.name, status: found.status }, after: { name: updated.name, status: updated.status } } }, ctx.traceId)
    return subjectDto(updated)
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

  /** 科目树（扁平列表，含 dataType）：取该 type 全部 active 科目 + 左联 metric 取 dataType */
  async getSubjectTree(type: 'operating' | 'static'): Promise<{ id: string; code: string; name: string; level: number; parentCode: string | null; category: string; direction: string; isLeaf: boolean; dataType: string }[]> {
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
      isLeaf: s.isLeaf,
      dataType: dtMap.get(s.code) ?? 'data',
    }))
  },

  // ===== 指标 =====
  async listMetrics(params: { page: number; pageSize: number; keyword?: string; dataType?: string }): Promise<{ items: MetricDto[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const where: Record<string, unknown> = {}
    if (params.dataType) where.dataType = params.dataType
    if (params.keyword) where.OR = [{ name: { contains: params.keyword } }, { code: { contains: params.keyword } }]
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
        isDerived: dataType === 'calc',
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

  async deleteMetric(id: string, ctx: AuditCtx): Promise<void> {
    const found = await prisma.metric.findUnique({ where: { id } })
    if (!found) throw errors.notFound('指标不存在')
    await prisma.metric.update({ where: { id }, data: { status: 'inactive' } })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'metric_change', targetId: found.code, detail: { action: 'delete' } }, ctx.traceId)
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
  async trialCalc(input: { formula: string; companyCode?: string; period?: string }): Promise<{ value: number | null; period: string | null; operands: { code: string; name: string; value: number }[] }> {
    const codes = extractCodes(input.formula)
    if (codes.length === 0) return { value: null, period: null, operands: [] }
    const batch = await prisma.importBatch.findFirst({ where: { dataType: 'operating', lifecycleStatus: 'active' }, select: { id: true } })
    if (!batch) return { value: null, period: null, operands: [] }
    let period: string | undefined = input.period
    if (!period) {
      const latest = await prisma.factOperating.findFirst({ where: { batchId: batch.id }, orderBy: { period: 'desc' }, select: { period: true } })
      period = latest?.period ?? undefined
    }
    if (!period) return { value: null, period: null, operands: [] }
    const where: Record<string, unknown> = { batchId: batch.id, period, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, accountCode: { in: codes } }
    if (input.companyCode) where.companyCode = input.companyCode
    const facts = await prisma.factOperating.groupBy({ by: ['accountCode'], where, _sum: { value: true } })
    const valueMap = new Map(facts.map((f) => [f.accountCode, Number(f._sum.value ?? 0)]))
    const subjects = await prisma.accountSubject.findMany({ where: { code: { in: codes } }, select: { code: true, name: true } })
    const nameMap = new Map(subjects.map((s) => [s.code, s.name]))
    const operands = codes.map((code) => ({ code, name: nameMap.get(code) ?? code, value: valueMap.get(code) ?? 0 }))
    const evalValues: Record<string, number> = {}
    for (const c of codes) evalValues[c] = valueMap.get(c) ?? 0
    let value: number | null = null
    try {
      value = Number(evaluateFormula(input.formula, evalValues).toFixed(2))
    } catch {
      value = null
    }
    return { value, period, operands }
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
