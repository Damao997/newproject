import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'

/**
 * 主体展示配置服务：主体预算达成分析的展示主体管理（主体 ↔ 排序/启停）。
 * 与品类配置同构：未配置的主体不展示，公司表变化后由管理员在管理界面维护。
 */

interface AuditCtx { userId: string; traceId?: string }

export interface SubjectBudgetConfigDto {
  id: string
  companyCode: string
  companyName: string
  entityType: 'single' | 'summary'
  sortOrder: number
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}

/** 检测结果：已配置状态 + 公司表新增但未配置的主体 */
export interface SubjectBudgetConfigCheckResult {
  configs: SubjectBudgetConfigDto[]
  unconfiguredSubjects: { code: string; name: string; entityType: 'single' | 'summary' }[]
}

function toDto(row: {
  id: string; companyCode: string; companyName: string; entityType: string; sortOrder: number; status: string; createdAt: Date; updatedAt: Date
}): SubjectBudgetConfigDto {
  return {
    id: row.id,
    companyCode: row.companyCode,
    companyName: row.companyName,
    entityType: row.entityType === 'summary' ? 'summary' : 'single',
    sortOrder: row.sortOrder,
    status: row.status === 'inactive' ? 'inactive' : 'active',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export const SubjectBudgetConfigService = {
  /** 全部配置（sortOrder 升序，联表取公司名/类型） */
  async list(): Promise<SubjectBudgetConfigDto[]> {
    const rows = await prisma.subjectBudgetConfig.findMany({ orderBy: { sortOrder: 'asc' } })
    const companies = await prisma.company.findMany({
      where: { code: { in: rows.map((r) => r.companyCode) } },
      select: { code: true, name: true, shortName: true, entityType: true },
    })
    const byCode = new Map(companies.map((c) => [c.code, c]))
    return rows.map((r) => {
      const c = byCode.get(r.companyCode)
      return toDto({
        ...r,
        companyName: c ? (c.shortName ?? c.name) : r.companyCode,
        entityType: c?.entityType ?? 'single',
      })
    })
  },

  /** 新增配置：从公司表选择未配置的主体加入展示列表 */
  async create(input: { companyCode: string; sortOrder?: number; status?: string }, ctx: AuditCtx): Promise<SubjectBudgetConfigDto> {
    const companyCode = String(input.companyCode ?? '').trim()
    if (!companyCode) throw errors.badRequest('主体编码必填')
    const company = await prisma.company.findUnique({ where: { code: companyCode } })
    if (!company) throw errors.notFound('主体不存在')
    const exists = await prisma.subjectBudgetConfig.findUnique({ where: { companyCode } })
    if (exists) throw errors.conflict('该主体已配置')
    const created = await prisma.subjectBudgetConfig.create({
      data: {
        companyCode,
        sortOrder: input.sortOrder ?? 0,
        status: input.status === 'inactive' ? 'inactive' : 'active',
      },
    })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'create', targetId: companyCode, detail: { entity: 'subject_budget_config' } }, ctx.traceId)
    const c = { code: company.code, name: company.shortName ?? company.name, entityType: company.entityType }
    return toDto({ ...created, companyName: c.name, entityType: c.entityType })
  },

  async update(id: string, input: { sortOrder?: number; status?: string }, ctx: AuditCtx): Promise<SubjectBudgetConfigDto> {
    const found = await prisma.subjectBudgetConfig.findUnique({ where: { id } })
    if (!found) throw errors.notFound('主体配置不存在')
    await prisma.subjectBudgetConfig.update({
      where: { id },
      data: {
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.status === 'active' || input.status === 'inactive' ? { status: input.status } : {}),
      },
    })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'update', targetId: found.companyCode, detail: { entity: 'subject_budget_config' } }, ctx.traceId)
    const all = await this.list()
    return all.find((r) => r.id === id) as SubjectBudgetConfigDto
  },

  async remove(id: string, ctx: AuditCtx): Promise<void> {
    const found = await prisma.subjectBudgetConfig.findUnique({ where: { id } })
    if (!found) throw errors.notFound('主体配置不存在')
    await prisma.subjectBudgetConfig.delete({ where: { id } })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'delete', targetId: found.companyCode, detail: { entity: 'subject_budget_config' } }, ctx.traceId)
  },

  /** 公司变化检测：公司表 active 主体 vs 配置，返回未配置的主体（新增公司提示） */
  async check(): Promise<SubjectBudgetConfigCheckResult> {
    const [configs, companies] = await Promise.all([
      this.list(),
      prisma.company.findMany({
        where: { status: 'active', entityType: { in: ['single', 'summary'] } },
        select: { code: true, name: true, shortName: true, entityType: true },
        orderBy: { orderNo: 'asc' },
      }),
    ])
    const configured = new Set(configs.map((c) => c.companyCode))
    return {
      configs,
      unconfiguredSubjects: companies
        .filter((c) => !configured.has(c.code))
        .map((c) => ({ code: c.code, name: c.shortName ?? c.name, entityType: c.entityType === 'summary' ? 'summary' as const : 'single' as const })),
    }
  },
}
