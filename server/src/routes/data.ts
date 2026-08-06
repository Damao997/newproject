import { Router, type Response } from 'express'
import multer from 'multer'
import { authenticate } from '../middleware/auth'
import { attachScope } from '../middleware/attach-scope'
import { requirePermission, requireAnyPermission } from '../middleware/permission'
import { asyncHandler } from '../lib/async-handler'
import { sendOk } from '../lib/response'
import { errors } from '../lib/errors'
import { recordAudit, clientIp } from '../middleware/audit'
import { ImportService } from '../services/ImportService'
import { DataService } from '../services/DataService'
import { ProductCategoryService } from '../services/ProductCategoryService'
import { ExpenseAnalysisService } from '../services/ExpenseAnalysisService'
import { SubjectBudgetConfigService } from '../services/SubjectBudgetConfigService'
import { BudgetRatioService } from '../services/BudgetRatioService'
import { IndicatorsService } from '../services/IndicatorsService'
import { ReclassificationService } from '../services/ReclassificationService'
import { ConsolidationService } from '../services/ConsolidationService'
import { fyLabelOfDate } from '../lib/period'
import { fixUploadFilename } from '../lib/sanitize'
import { prisma } from '../lib/prisma'
import type { AuthUserContext } from '../types/express'

/**
 * 数据管理路由（/api/v1/data）。
 * 权限：浏览 data:browse:view；导入 data:import:upload；
 * 科目/指标 CRUD 对应 data:subject:* / data:metric:*；导出 data:export。
 */
const router = Router()

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } })

const VALID_TEMPLATES = new Set(['operating', 'static', 'budget', 'transaction', 'inventory'])

function ctxOf(req: { authUser?: AuthUserContext; traceId: string }) {
  return { userId: (req.authUser as AuthUserContext).userId, traceId: req.traceId }
}
function scopeOf(a: AuthUserContext) {
  return { companyCode: a.companyCode, scopeValue: a.scopeValue, dataScopeCodes: a.dataScopeCodes }
}
function pageParams(q: Record<string, unknown>) {
  const page = Math.max(Number(q.page) || 1, 1)
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 20, 1), 1000)
  return { page, pageSize }
}
function sendXlsx(res: Response, buffer: Buffer, filename: string): void {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
  res.send(buffer)
}

router.use(authenticate, attachScope())

// ===== 导入批次 =====
router.post('/imports', requirePermission('data:import:upload', 'import'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw errors.badRequest('缺少上传文件')
  const originalname = fixUploadFilename(req.file.originalname)
  if (!/\.(xlsx|xls)$/i.test(originalname)) throw errors.badRequest('仅支持 .xlsx/.xls 文件')
  const templateType = String(req.body?.templateType ?? 'operating')
  if (!VALID_TEMPLATES.has(templateType)) throw errors.badRequest('非法的模板类型')
  const fiscalYear = req.body?.fiscalYear ? String(req.body.fiscalYear) : fyLabelOfDate(new Date())
  // 数值单位：元/万元（解析期归一为万元存储）；未传默认万元（存量兼容）
  const valueUnit = req.body?.valueUnit ? String(req.body.valueUnit) : undefined
  if (valueUnit !== undefined && valueUnit !== 'yuan' && valueUnit !== 'wan') throw errors.badRequest('非法的数值单位')
  const dto = await ImportService.upload(
    { originalname, buffer: req.file.buffer, size: req.file.size },
    templateType as 'operating',
    (req.authUser as AuthUserContext).userId,
    req.traceId,
    fiscalYear,
    valueUnit as 'yuan' | 'wan' | undefined,
  )
  sendOk(res, dto)
}))

// 导入预览（dry-run，不建批次不写库）
router.post('/imports/preview', requirePermission('data:import:upload', 'import'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw errors.badRequest('缺少上传文件')
  if (!/\.(xlsx|xls)$/i.test(fixUploadFilename(req.file.originalname))) throw errors.badRequest('仅支持 .xlsx/.xls 文件')
  const templateType = String(req.body?.templateType ?? 'operating')
  if (!VALID_TEMPLATES.has(templateType)) throw errors.badRequest('非法的模板类型')
  const fiscalYear = req.body?.fiscalYear ? String(req.body.fiscalYear) : fyLabelOfDate(new Date())
  const valueUnit = req.body?.valueUnit ? String(req.body.valueUnit) : undefined
  if (valueUnit !== undefined && valueUnit !== 'yuan' && valueUnit !== 'wan') throw errors.badRequest('非法的数值单位')
  const data = await ImportService.preview({ buffer: req.file.buffer }, templateType as 'operating', fiscalYear, valueUnit as 'yuan' | 'wan' | undefined)
  sendOk(res, data)
}))

router.get('/imports', requirePermission('data:browse:view', 'view'), asyncHandler(async (req, res) => {
  const { page, pageSize } = pageParams(req.query)
  const data = await ImportService.list({ page, pageSize, templateType: req.query.templateType as string | undefined, userId: (req.authUser as AuthUserContext).userId })
  sendOk(res, data)
}))

// 下载导入模板（自动读取科目体系数据类指标生成，见 ImportService.getTemplate）；须在 /imports/:id 之前注册
router.get('/imports/template', requirePermission('data:import:upload', 'import'), asyncHandler(async (req, res) => {
  const type = req.query.type === 'static' ? 'static' : req.query.type === 'budget' ? 'budget' : 'operating'
  const buffer = await ImportService.getTemplate(type)
  sendXlsx(res, buffer, `import-template-${type}.xlsx`)
}))

// 批量激活预检（只读）：计算各批次激活后将替换的已生效组合，供前端批量激活前确认覆盖风险；须在 /imports/:id 之前注册
router.post('/imports/batch-activate-check', requirePermission('data:import:upload', 'import'), asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown): x is string => typeof x === 'string') : []
  if (ids.length === 0) throw errors.badRequest('缺少批次 ID')
  sendOk(res, { results: await ImportService.checkBatchActivateConflicts(ids) })
}))

// 批次差异对比（US-03）：两批次事实值对比（operating/static/budget）；须在 /imports/:id 之前注册
router.get('/imports/:aId/compare/:bId', requirePermission('data:browse:view', 'view'), asyncHandler(async (req, res) => {
  const data = await DataService.compareBatches(req.params.aId as string, req.params.bId as string, scopeOf(req.authUser as AuthUserContext))
  sendOk(res, data)
}))

router.get('/imports/:id', requirePermission('data:browse:view', 'view'), asyncHandler(async (req, res) => {
  sendOk(res, await ImportService.getById(req.params.id as string))
}))

router.post('/imports/:id/activate', requirePermission('data:import:upload', 'import'), asyncHandler(async (req, res) => {
  const dto = await ImportService.activate(req.params.id as string, (req.authUser as AuthUserContext).userId, req.traceId)
  sendOk(res, dto)
}))

// 回滚批次（US-03）：恢复快照数据并重新激活历史批次；高危操作，独立权限点（仅 superadmin）
router.post('/imports/:id/rollback', requirePermission('data:import:rollback', 'import'), asyncHandler(async (req, res) => {
  const dto = await ImportService.rollbackBatch(req.params.id as string, (req.authUser as AuthUserContext).userId, req.traceId)
  sendOk(res, dto)
}))

// 手动归档（高危，仅 superadmin）
router.post('/imports/:id/archive', requirePermission('data:import:archive', 'import'), asyncHandler(async (req, res) => {
  const dto = await ImportService.archive(req.params.id as string, (req.authUser as AuthUserContext).userId, req.traceId)
  sendOk(res, dto)
}))

// 清除批次数据（高危，仅 superadmin）：物理删除事实明细，批次置 purged 留痕
router.post('/imports/:id/purge', requirePermission('data:import:purge', 'delete'), asyncHandler(async (req, res) => {
  const dto = await ImportService.purge(req.params.id as string, (req.authUser as AuthUserContext).userId, req.traceId)
  sendOk(res, dto)
}))

// ===== 交叉表 =====
router.get('/cross-table', requirePermission('data:browse:view', 'view'), asyncHandler(async (req, res) => {
  const data = await IndicatorsService.getCross(scopeOf(req.authUser as AuthUserContext), {
    period: req.query.period as string | undefined,
    subjectType: req.query.subjectType === 'static' ? 'static' : 'operating',
  })
  sendOk(res, data)
}))

// ===== 公司 =====
// 公司列表是各页面筛选器（CompanySelect/CompanyMultiSelect/看板主体候选）的主数据源：
// 持有任一模块查看权限即可读取，返回范围仍由 DataService.listCompanies 内 effectiveScope 按数据权限收敛
router.get('/companies', requireAnyPermission([
  { resource: 'dashboard:view', action: 'view' },
  { resource: 'indicators:view', action: 'view' },
  { resource: 'reports:view', action: 'view' },
  { resource: 'transactions:view', action: 'view' },
  { resource: 'inventory:view', action: 'view' },
  { resource: 'data:browse:view', action: 'view' },
]), asyncHandler(async (req, res) => {
  const includeInactive = req.query.includeInactive === 'true' || req.query.includeInactive === '1'
  sendOk(res, await DataService.listCompanies(includeInactive))
}))

router.post('/companies', requirePermission('data:company:create', 'create'), asyncHandler(async (req, res) => {
  const b = req.body ?? {}
  if (!b.code || !b.name) throw errors.badRequest('公司编码与名称必填')
  sendOk(res, await DataService.createCompany(b, ctxOf(req)))
}))

router.put('/companies/:id', requirePermission('data:company:update', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await DataService.updateCompany(req.params.id as string, req.body ?? {}, ctxOf(req)))
}))

router.delete('/companies/:id', requirePermission('data:company:delete', 'delete'), asyncHandler(async (req, res) => {
  await DataService.deleteCompany(req.params.id as string, ctxOf(req))
  sendOk(res, null)
}))

// ===== 汇总映射（单体 → 汇总主体成员） =====
router.get('/aggregation-map', requirePermission('data:browse:view', 'view'), asyncHandler(async (req, res) => {
  sendOk(res, await DataService.listAggregationMap(req.query.summaryCode as string | undefined))
}))

router.post('/aggregation-map', requirePermission('data:company:update', 'update'), asyncHandler(async (req, res) => {
  const b = req.body ?? {}
  if (!b.summaryCompanyCode || !b.singleCompanyCode) throw errors.badRequest('汇总主体与单体编码必填')
  sendOk(res, await DataService.createAggregationMap(b, ctxOf(req)))
}))

router.delete('/aggregation-map/:id', requirePermission('data:company:update', 'update'), asyncHandler(async (req, res) => {
  await DataService.deleteAggregationMap(req.params.id as string, ctxOf(req))
  sendOk(res, null)
}))

// ===== 科目 =====
router.get('/subjects', requirePermission('data:browse:view', 'view'), asyncHandler(async (req, res) => {
  const { page, pageSize } = pageParams(req.query)
  const includeInactive = req.query.includeInactive === 'true' || req.query.includeInactive === '1'
  const data = await DataService.listSubjects({ page, pageSize, type: req.query.type as string | undefined, keyword: req.query.keyword as string | undefined, includeInactive })
  sendOk(res, data)
}))

router.get('/subjects/tree', requirePermission('data:browse:view', 'view'), asyncHandler(async (req, res) => {
  const type = req.query.type === 'static' ? 'static' : 'operating'
  sendOk(res, await DataService.getSubjectTree(type))
}))

router.post('/subjects', requirePermission('data:subject:create', 'create'), asyncHandler(async (req, res) => {
  const b = req.body ?? {}
  if (!b.name) throw errors.badRequest('科目名称必填（编码由系统按层级自动生成）')
  const dto = await DataService.createSubject(b, ctxOf(req))
  sendOk(res, dto)
}))

router.put('/subjects/:id', requirePermission('data:subject:update', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await DataService.updateSubject(req.params.id as string, req.body ?? {}, ctxOf(req)))
}))

router.delete('/subjects/:id', requirePermission('data:subject:delete', 'delete'), asyncHandler(async (req, res) => {
  await DataService.deleteSubject(req.params.id as string, ctxOf(req))
  sendOk(res, null)
}))

// 科目归类调整（换父，category 向下传播）
router.post('/subjects/:id/reclassify', requirePermission('data:reclassify:subject', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await DataService.reclassifySubject(req.params.id as string, { parentCode: req.body?.parentCode === undefined ? null : req.body.parentCode }, ctxOf(req)))
}))

// ===== 品类配置（品类预算达成分析）=====
router.get('/product-categories', requirePermission('data:browse:view', 'view'), asyncHandler(async (_req, res) => {
  sendOk(res, await ProductCategoryService.list())
}))

router.get('/product-categories/check', requirePermission('data:browse:view', 'view'), asyncHandler(async (_req, res) => {
  sendOk(res, await ProductCategoryService.check())
}))

router.post('/product-categories', requirePermission('data:subject:create', 'create'), asyncHandler(async (req, res) => {
  sendOk(res, await ProductCategoryService.create(req.body ?? {}, ctxOf(req)))
}))

router.put('/product-categories/:id', requirePermission('data:subject:update', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await ProductCategoryService.update(req.params.id as string, req.body ?? {}, ctxOf(req)))
}))

router.delete('/product-categories/:id', requirePermission('data:subject:delete', 'delete'), asyncHandler(async (req, res) => {
  await ProductCategoryService.remove(req.params.id as string, ctxOf(req))
  sendOk(res, null)
}))

// ===== 运营费用映射（运营费用分析）=====
router.get('/expense-mappings', requirePermission('data:browse:view', 'view'), asyncHandler(async (_req, res) => {
  sendOk(res, await ExpenseAnalysisService.list())
}))

router.get('/expense-mappings/check', requirePermission('data:browse:view', 'view'), asyncHandler(async (_req, res) => {
  sendOk(res, await ExpenseAnalysisService.check())
}))

router.post('/expense-mappings', requirePermission('data:subject:create', 'create'), asyncHandler(async (req, res) => {
  sendOk(res, await ExpenseAnalysisService.create(req.body ?? {}, ctxOf(req)))
}))

router.put('/expense-mappings/:id', requirePermission('data:subject:update', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await ExpenseAnalysisService.update(req.params.id as string, req.body ?? {}, ctxOf(req)))
}))

router.delete('/expense-mappings/:id', requirePermission('data:subject:delete', 'delete'), asyncHandler(async (req, res) => {
  await ExpenseAnalysisService.remove(req.params.id as string, ctxOf(req))
  sendOk(res, null)
}))

// ===== 主体展示配置（主体预算达成分析）=====
router.get('/subject-budget-configs', requirePermission('data:browse:view', 'view'), asyncHandler(async (_req, res) => {
  sendOk(res, await SubjectBudgetConfigService.list())
}))

router.get('/subject-budget-configs/check', requirePermission('data:browse:view', 'view'), asyncHandler(async (_req, res) => {
  sendOk(res, await SubjectBudgetConfigService.check())
}))

router.post('/subject-budget-configs', requirePermission('data:subject:create', 'create'), asyncHandler(async (req, res) => {
  sendOk(res, await SubjectBudgetConfigService.create(req.body ?? {}, ctxOf(req)))
}))

router.put('/subject-budget-configs/:id', requirePermission('data:subject:update', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await SubjectBudgetConfigService.update(req.params.id as string, req.body ?? {}, ctxOf(req)))
}))

router.delete('/subject-budget-configs/:id', requirePermission('data:subject:delete', 'delete'), asyncHandler(async (req, res) => {
  await SubjectBudgetConfigService.remove(req.params.id as string, ctxOf(req))
  sendOk(res, null)
}))

// ===== 预算月度占比（看板月度预算按占比拆分）=====
router.get('/budget-ratios', requirePermission('data:browse:view', 'view'), asyncHandler(async (req, res) => {
  sendOk(res, await BudgetRatioService.get(String(req.query.fiscalYear ?? '')))
}))

router.put('/budget-ratios/:fiscalYear', requirePermission('data:subject:update', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await BudgetRatioService.update(req.params.fiscalYear as string, req.body?.ratios, ctxOf(req)))
}))

// ===== 指标 =====
router.get('/metrics', requirePermission('data:browse:view', 'view'), asyncHandler(async (req, res) => {
  const { page, pageSize } = pageParams(req.query)
  const data = await DataService.listMetrics({ page, pageSize, keyword: req.query.keyword as string | undefined, dataType: req.query.dataType as string | undefined, includeInactive: req.query.includeInactive === 'true' })
  sendOk(res, data)
}))

router.post('/metrics', requirePermission('data:metric:create', 'create'), asyncHandler(async (req, res) => {
  const b = req.body ?? {}
  if (!b.code || !b.name) throw errors.badRequest('指标编码与名称必填')
  sendOk(res, await DataService.createMetric(b, ctxOf(req)))
}))

router.put('/metrics/:id', requirePermission('data:metric:update', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await DataService.updateMetric(req.params.id as string, req.body ?? {}, ctxOf(req)))
}))

router.delete('/metrics/:id', requirePermission('data:metric:delete', 'delete'), asyncHandler(async (req, res) => {
  await DataService.deleteMetric(req.params.id as string, ctxOf(req))
  sendOk(res, null)
}))

// 彻底删除指标（高危，仅 superadmin）：连同公式历史一并删除，需先停用
router.delete('/metrics/:id/purge', requirePermission('data:metric:purge', 'delete'), asyncHandler(async (req, res) => {
  await DataService.purgeMetric(req.params.id as string, ctxOf(req))
  sendOk(res, null)
}))

// 恢复启用已停用指标：重新校验公式有效性；clearFormula=true 时公式失效可清空后恢复
router.post('/metrics/:id/restore', requirePermission('data:metric:update', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await DataService.restoreMetric(req.params.id as string, { clearFormula: req.body?.clearFormula === true }, ctxOf(req)))
}))

// 指标类型转换（高危，仅 superadmin）：data ↔ calc、data/calc → display（display 只读不可转出），data→calc 可携带初始公式
router.post('/metrics/:id/convert', requirePermission('data:metric:convert', 'update'), asyncHandler(async (req, res) => {
  const dataType = String(req.body?.dataType ?? '')
  if (!dataType) throw errors.badRequest('目标类型必填')
  sendOk(res, await DataService.convertMetricType(req.params.id as string, { dataType, formula: req.body?.formula }, ctxOf(req)))
}))

router.get('/metrics/:id/history', requirePermission('data:metric:update', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await DataService.getMetricHistory(req.params.id as string))
}))

router.post('/metrics/:id/rollback', requirePermission('data:metric:update', 'update'), asyncHandler(async (req, res) => {
  const version = Number(req.body?.version)
  if (!Number.isFinite(version)) throw errors.badRequest('版本号非法')
  sendOk(res, await DataService.rollbackMetric(req.params.id as string, version, ctxOf(req)))
}))

router.post('/metrics/trial-calc', requirePermission('data:metric:create', 'create'), asyncHandler(async (req, res) => {
  const formula = String(req.body?.formula ?? '')
  if (!formula) throw errors.badRequest('公式不能为空')
  if (req.body?.period !== undefined && req.body?.period !== null && req.body?.period !== '' && !PERIOD_RE.test(String(req.body.period))) {
    throw errors.badRequest('请选择有效期间（YYYY-MM）')
  }
  sendOk(res, await DataService.trialCalc({ formula, companyCode: req.body?.companyCode, period: req.body?.period }))
}))

router.get('/metrics/:id/dependencies', requirePermission('data:metric:update', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await DataService.analyzeDependencies(req.params.id as string))
}))

router.post('/metrics/:id/approve', requirePermission('data:metric:approve', 'approve'), asyncHandler(async (req, res) => {
  sendOk(res, await DataService.approveMetric(req.params.id as string, ctxOf(req)))
}))

router.post('/metrics/:id/reject', requirePermission('data:metric:approve', 'approve'), asyncHandler(async (req, res) => {
  sendOk(res, await DataService.rejectMetric(req.params.id as string, ctxOf(req)))
}))

// ===== 公式导出/导入 =====
router.get('/metrics/formulas/export', requirePermission('data:metric:update', 'update'), asyncHandler(async (_req, res) => {
  const metrics = await prisma.metric.findMany({ where: { dataType: 'calc', status: 'active', formula: { not: null } }, select: { code: true, name: true, formula: true, dependsOn: true } })
  sendOk(res, metrics)
}))

router.post('/metrics/formulas/import', requirePermission('data:metric:update', 'update'), asyncHandler(async (req, res) => {
  const items = req.body?.items
  if (!Array.isArray(items) || items.length === 0) throw errors.badRequest('缺少 items 数组')
  const results: { code: string; ok: boolean; message?: string }[] = []
  for (const item of items.slice(0, 200)) {
    const code = String(item.code ?? '')
    const formula = String(item.formula ?? '')
    if (!code || !formula) { results.push({ code, ok: false, message: '编码或公式为空' }); continue }
    const metric = await prisma.metric.findFirst({ where: { code, status: 'active' } })
    if (!metric) { results.push({ code, ok: false, message: '指标不存在' }); continue }
    try {
      const { validateFormulaChange } = await import('../services/FormulaRuleService')
      const { warnings, dependsOn } = await validateFormulaChange(code, formula)
      if (warnings.length > 0) { results.push({ code, ok: false, message: warnings.join('；') }); continue }
      await prisma.metric.update({ where: { id: metric.id }, data: { formula, dependsOn: dependsOn as never, version: { increment: 1 } } })
      results.push({ code, ok: true })
    } catch (e) {
      results.push({ code, ok: false, message: e instanceof Error ? e.message : '校验失败' })
    }
  }
  sendOk(res, { applied: results.filter((r) => r.ok).length, results })
}))

// ===== 跨公司重分类 =====
const TRANSFER_MODES = ['all', 'ratio', 'amount']
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function companyReclassifyBody(b: any) {
  if (!b.templateType || !b.sourceCompanyCode || !b.targetCompanyCode) throw errors.badRequest('模板类型、源公司、目标公司必填')
  if (typeof b.period !== 'string' || !PERIOD_RE.test(b.period)) throw errors.badRequest('请选择调整期间（单月 YYYY-MM）')
  if (b.transferMode !== undefined && !TRANSFER_MODES.includes(b.transferMode)) throw errors.badRequest('转移方式不合法')
  return {
    templateType: b.templateType,
    sourceCompanyCode: b.sourceCompanyCode,
    targetCompanyCode: b.targetCompanyCode,
    accountCodes: Array.isArray(b.accountCodes) ? b.accountCodes : undefined,
    period: b.period,
    transferMode: b.transferMode || undefined,
    ratio: b.ratio !== undefined && b.ratio !== null && b.ratio !== '' ? Number(b.ratio) : undefined,
    amount: b.amount !== undefined && b.amount !== null && b.amount !== '' ? Number(b.amount) : undefined,
  }
}

router.post('/reclassify/company/preview', requirePermission('data:reclassify:company', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await ReclassificationService.previewCompany(companyReclassifyBody(req.body ?? {}), scopeOf(req.authUser as AuthUserContext)))
}))

router.post('/reclassify/company', requirePermission('data:reclassify:company', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await ReclassificationService.reclassifyCompany(companyReclassifyBody(req.body ?? {}), scopeOf(req.authUser as AuthUserContext), ctxOf(req)))
}))

// ===== 同公司科目间调整 =====
const ADJUST_MODES = ['both', 'decrease', 'increase']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function adjustSubjectBody(b: any) {
  if (!b.templateType || !b.companyCode) throw errors.badRequest('模板类型、公司必填')
  if (b.adjustMode !== undefined && !ADJUST_MODES.includes(b.adjustMode)) throw errors.badRequest('调整方式不合法')
  // 未传 adjustMode 按旧参数口径（调减侧必填）；具体模式推断与金额校验在 Service 层
  const mode = b.adjustMode as string | undefined
  if (mode !== 'increase') {
    if (!b.sourceAccountCode) throw errors.badRequest('源科目必填')
    if (b.decreaseAmount === undefined || b.decreaseAmount === null || b.decreaseAmount === '') throw errors.badRequest('调减金额必填')
  } else {
    if (!b.targetAccountCode) throw errors.badRequest('仅调增模式下目标科目必填')
    if (b.increaseAmount === undefined || b.increaseAmount === null || b.increaseAmount === '') throw errors.badRequest('仅调增模式下调增金额必填')
  }
  if (typeof b.period !== 'string' || !PERIOD_RE.test(b.period)) throw errors.badRequest('请选择调整期间（单月 YYYY-MM）')
  return {
    templateType: b.templateType,
    companyCode: b.companyCode,
    adjustMode: mode as 'both' | 'decrease' | 'increase' | undefined,
    sourceAccountCode: b.sourceAccountCode || undefined,
    targetAccountCode: b.targetAccountCode || undefined,
    decreaseAmount: b.decreaseAmount !== undefined && b.decreaseAmount !== null && b.decreaseAmount !== '' ? Number(b.decreaseAmount) : undefined,
    increaseAmount: b.increaseAmount !== undefined && b.increaseAmount !== null && b.increaseAmount !== '' ? Number(b.increaseAmount) : undefined,
    period: b.period,
    reason: typeof b.reason === 'string' ? b.reason : '',
  }
}

router.post('/reclassify/subject/preview', requirePermission('data:reclassify:subject', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await ReclassificationService.previewAdjustSubject(adjustSubjectBody(req.body ?? {}), scopeOf(req.authUser as AuthUserContext)))
}))

router.post('/reclassify/subject', requirePermission('data:reclassify:subject', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await ReclassificationService.adjustSubject(adjustSubjectBody(req.body ?? {}), scopeOf(req.authUser as AuthUserContext), ctxOf(req)))
}))

// 重分类/汇总抵消记录为只读审计视图：查看权限（data:browse:view）即可打开；写操作仍要求 data:reclassify:* update
router.get('/reclassify/logs', requirePermission('data:browse:view', 'view'), asyncHandler(async (req, res) => {
  const { page, pageSize } = pageParams(req.query)
  sendOk(res, await ReclassificationService.listLogs({ page, pageSize, type: req.query.type as string | undefined }, scopeOf(req.authUser as AuthUserContext)))
}))

// 撤销重分类/科目调整（按日志快照逆向恢复）
router.post('/reclassify/logs/:id/revert', requirePermission('data:reclassify:company', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await ReclassificationService.revertLog(req.params.id as string, scopeOf(req.authUser as AuthUserContext), ctxOf(req)))
}))

// ===== 汇总抵消调整（内部公司间交易在汇总口径的抵消，单体报表不受影响）=====
// 本版仅支持经营数据（现金流属经营科目树）；模板字段保留扩展
const CONSOLIDATION_TEMPLATES = ['operating']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function consolidationAdjustBody(b: any) {
  if (!b.summaryCompanyCode || !b.accountCode) throw errors.badRequest('汇总主体与科目必填')
  if (!b.templateType || !CONSOLIDATION_TEMPLATES.includes(b.templateType)) throw errors.badRequest('模板类型不合法（本版仅支持经营数据）')
  if (typeof b.period !== 'string' || !PERIOD_RE.test(b.period)) throw errors.badRequest('请选择调整期间（单月 YYYY-MM）')
  const amount = Number(b.amount)
  if (!Number.isFinite(amount) || amount === 0) throw errors.badRequest('调整金额必须为非 0 数值（万元，正=调增、负=调减）')
  if (!b.reason || !String(b.reason).trim()) throw errors.badRequest('调整原因必填')
  return {
    templateType: b.templateType,
    summaryCompanyCode: b.summaryCompanyCode,
    accountCode: b.accountCode,
    period: b.period,
    amount,
    reason: String(b.reason).trim(),
  }
}

router.get('/consolidation/adjustments', requirePermission('data:browse:view', 'view'), asyncHandler(async (req, res) => {
  const { page, pageSize } = pageParams(req.query)
  sendOk(res, await ConsolidationService.listAdjustments({ page, pageSize }, scopeOf(req.authUser as AuthUserContext)))
}))

router.post('/consolidation/adjustments', requirePermission('data:reclassify:company', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await ConsolidationService.createAdjustment(consolidationAdjustBody(req.body ?? {}), scopeOf(req.authUser as AuthUserContext), ctxOf(req)))
}))

// 解析两个单体公司共同所属的汇总主体（company_aggregation_map 交集 + 权限过滤），供抵消对话框自动匹配
router.post('/consolidation/common-summaries', requirePermission('data:reclassify:company', 'update'), asyncHandler(async (req, res) => {
  const b = req.body ?? {}
  if (!b.singleCompanyCodeA || !b.singleCompanyCodeB) throw errors.badRequest('请选择两个单体公司')
  sendOk(res, await ConsolidationService.commonSummariesOf(b.singleCompanyCodeA, b.singleCompanyCodeB, scopeOf(req.authUser as AuthUserContext)))
}))

router.delete('/consolidation/adjustments/:id', requirePermission('data:reclassify:company', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await ConsolidationService.deleteAdjustment(req.params.id as string, scopeOf(req.authUser as AuthUserContext), ctxOf(req)))
}))

// ===== 导出 =====
router.get('/export', requirePermission('data:export', 'export'), asyncHandler(async (req, res) => {
  const buffer = await DataService.exportSubjects(req.query.type as string | undefined)
  await recordAudit({ userId: (req.authUser as AuthUserContext).userId, module: 'data', action: 'export', targetId: 'subjects', ip: clientIp(req) }, req.traceId)
  sendXlsx(res, buffer, 'data-subjects.xlsx')
}))

export default router
