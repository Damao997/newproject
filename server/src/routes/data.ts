import { Router, type Response } from 'express'
import multer from 'multer'
import { authenticate } from '../middleware/auth'
import { requirePermission } from '../middleware/permission'
import { asyncHandler } from '../lib/async-handler'
import { sendOk } from '../lib/response'
import { errors } from '../lib/errors'
import { recordAudit, clientIp } from '../middleware/audit'
import { ImportService } from '../services/ImportService'
import { DataService } from '../services/DataService'
import { IndicatorsService } from '../services/IndicatorsService'
import { ReclassificationService } from '../services/ReclassificationService'
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

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

const VALID_TEMPLATES = new Set(['operating', 'static', 'budget', 'transaction', 'inventory'])

function ctxOf(req: { authUser?: AuthUserContext; traceId: string }) {
  return { userId: (req.authUser as AuthUserContext).userId, traceId: req.traceId }
}
function scopeOf(a: AuthUserContext) {
  return { companyCode: a.companyCode, scopeValue: a.scopeValue }
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

router.use(authenticate)

// ===== 导入批次 =====
router.post('/imports', requirePermission('data:import:upload', 'import'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw errors.badRequest('缺少上传文件')
  const originalname = fixUploadFilename(req.file.originalname)
  if (!/\.(xlsx|xls)$/i.test(originalname)) throw errors.badRequest('仅支持 .xlsx/.xls 文件')
  const templateType = String(req.body?.templateType ?? 'operating')
  if (!VALID_TEMPLATES.has(templateType)) throw errors.badRequest('非法的模板类型')
  const fiscalYear = req.body?.fiscalYear ? String(req.body.fiscalYear) : fyLabelOfDate(new Date())
  const dto = await ImportService.upload(
    { originalname, buffer: req.file.buffer, size: req.file.size },
    templateType as 'operating',
    (req.authUser as AuthUserContext).userId,
    req.traceId,
    fiscalYear,
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
  const data = await ImportService.preview({ buffer: req.file.buffer }, templateType as 'operating', fiscalYear)
  sendOk(res, data)
}))

router.get('/imports', requirePermission('data:browse:view', 'view'), asyncHandler(async (req, res) => {
  const { page, pageSize } = pageParams(req.query)
  const data = await ImportService.list({ page, pageSize, templateType: req.query.templateType as string | undefined })
  sendOk(res, data)
}))

router.get('/imports/:id', requirePermission('data:browse:view', 'view'), asyncHandler(async (req, res) => {
  sendOk(res, await ImportService.getById(req.params.id as string))
}))

router.post('/imports/:id/activate', requirePermission('data:import:upload', 'import'), asyncHandler(async (req, res) => {
  const dto = await ImportService.activate(req.params.id as string, (req.authUser as AuthUserContext).userId, req.traceId)
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
router.get('/companies', requirePermission('data:browse:view', 'view'), asyncHandler(async (_req, res) => {
  sendOk(res, await DataService.listCompanies())
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

// 彻底删除公司（高危，仅 superadmin）：需先停用
router.delete('/companies/:id/purge', requirePermission('data:company:purge', 'delete'), asyncHandler(async (req, res) => {
  await DataService.purgeCompany(req.params.id as string, ctxOf(req))
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
  const data = await DataService.listSubjects({ page, pageSize, type: req.query.type as string | undefined, keyword: req.query.keyword as string | undefined })
  sendOk(res, data)
}))

router.get('/subjects/tree', requirePermission('data:browse:view', 'view'), asyncHandler(async (req, res) => {
  const type = req.query.type === 'static' ? 'static' : 'operating'
  sendOk(res, await DataService.getSubjectTree(type))
}))

router.post('/subjects', requirePermission('data:subject:create', 'create'), asyncHandler(async (req, res) => {
  const b = req.body ?? {}
  if (!b.code || !b.name) throw errors.badRequest('科目编码与名称必填')
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

// 彻底删除科目（高危，仅 superadmin）：需先停用
router.delete('/subjects/:id/purge', requirePermission('data:subject:purge', 'delete'), asyncHandler(async (req, res) => {
  await DataService.purgeSubject(req.params.id as string, ctxOf(req))
  sendOk(res, null)
}))

// 科目归类调整（换父，category 向下传播）
router.post('/subjects/:id/reclassify', requirePermission('data:reclassify:subject', 'update'), asyncHandler(async (req, res) => {
  sendOk(res, await DataService.reclassifySubject(req.params.id as string, { parentCode: req.body?.parentCode === undefined ? null : req.body.parentCode }, ctxOf(req)))
}))

// ===== 指标 =====
router.get('/metrics', requirePermission('data:browse:view', 'view'), asyncHandler(async (req, res) => {
  const { page, pageSize } = pageParams(req.query)
  const data = await DataService.listMetrics({ page, pageSize, keyword: req.query.keyword as string | undefined, dataType: req.query.dataType as string | undefined })
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
router.post('/reclassify/company/preview', requirePermission('data:reclassify:company', 'update'), asyncHandler(async (req, res) => {
  const b = req.body ?? {}
  if (!b.templateType || !b.sourceCompanyCode || !b.targetCompanyCode) throw errors.badRequest('模板类型、源公司、目标公司必填')
  sendOk(res, await ReclassificationService.previewCompany({
    templateType: b.templateType,
    sourceCompanyCode: b.sourceCompanyCode,
    targetCompanyCode: b.targetCompanyCode,
    accountCodes: Array.isArray(b.accountCodes) ? b.accountCodes : undefined,
    periodFrom: b.periodFrom || undefined,
    periodTo: b.periodTo || undefined,
  }, scopeOf(req.authUser as AuthUserContext)))
}))

router.post('/reclassify/company', requirePermission('data:reclassify:company', 'update'), asyncHandler(async (req, res) => {
  const b = req.body ?? {}
  if (!b.templateType || !b.sourceCompanyCode || !b.targetCompanyCode) throw errors.badRequest('模板类型、源公司、目标公司必填')
  sendOk(res, await ReclassificationService.reclassifyCompany({
    templateType: b.templateType,
    sourceCompanyCode: b.sourceCompanyCode,
    targetCompanyCode: b.targetCompanyCode,
    accountCodes: Array.isArray(b.accountCodes) ? b.accountCodes : undefined,
    periodFrom: b.periodFrom || undefined,
    periodTo: b.periodTo || undefined,
  }, scopeOf(req.authUser as AuthUserContext), ctxOf(req)))
}))

router.get('/reclassify/logs', requirePermission('data:reclassify:company', 'update'), asyncHandler(async (req, res) => {
  const { page, pageSize } = pageParams(req.query)
  sendOk(res, await ReclassificationService.listLogs({ page, pageSize, type: req.query.type as string | undefined }))
}))

// ===== 导出 =====
router.get('/export', requirePermission('data:export', 'export'), asyncHandler(async (req, res) => {
  const buffer = await DataService.exportSubjects(req.query.type as string | undefined)
  await recordAudit({ userId: (req.authUser as AuthUserContext).userId, module: 'data', action: 'export', targetId: 'subjects', ip: clientIp(req) }, req.traceId)
  sendXlsx(res, buffer, 'data-subjects.xlsx')
}))

export default router
