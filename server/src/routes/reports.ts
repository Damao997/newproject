import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { requirePermission } from '../middleware/permission'
import { asyncHandler } from '../lib/async-handler'
import { sendOk } from '../lib/response'
import { recordAudit, clientIp } from '../middleware/audit'
import { SubjectAnalysisService } from '../services/SubjectAnalysisService'
import { ReportService } from '../services/ReportService'
import type { AuthUserContext } from '../types/express'

/**
 * 分析报告路由（/api/v1/reports）。
 * 权限：reports:view/create/update/delete/export，写操作接审计。
 * 注意：/analyses 段须置于 /:id 之前，避免被通配路由吞并。
 */
const router = Router()

function scopeOf(authUser: AuthUserContext) {
  return { companyCode: authUser.companyCode, scopeValue: authUser.scopeValue }
}

router.use(authenticate)

// ============ 单项分析（公司 × 科目 × 期间） ============

// 批量取数（汇总编制用，ET 自动展开）—— 须置于 /analyses/:id 之前
router.get('/analyses/batch', requirePermission('reports:view', 'view'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const companyCodes = typeof req.query.companyCodes === 'string' ? req.query.companyCodes.split(',').map((s) => s.trim()).filter(Boolean) : []
  const period = req.query.period as string | undefined
  const data = await SubjectAnalysisService.batchForCompanies(scopeOf(authUser), { companyCodes, period })
  sendOk(res, data)
}))

// 列表
router.get('/analyses', requirePermission('reports:view', 'view'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const data = await SubjectAnalysisService.list(scopeOf(authUser), {
    companyCode: req.query.companyCode as string | undefined,
    subjectCode: req.query.subjectCode as string | undefined,
    period: req.query.period as string | undefined,
  })
  sendOk(res, data)
}))

// 详情
router.get('/analyses/:id', requirePermission('reports:view', 'view'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const data = await SubjectAnalysisService.getById(scopeOf(authUser), req.params.id as string)
  sendOk(res, data)
}))

// 新增（幂等 upsert）
router.post('/analyses', requirePermission('reports:create', 'create'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const b = req.body ?? {}
  const data = await SubjectAnalysisService.create(scopeOf(authUser), {
    companyCode: String(b.companyCode ?? ''),
    subjectCode: String(b.subjectCode ?? ''),
    subjectType: b.subjectType === 'static' ? 'static' : b.subjectType === 'operating' ? 'operating' : undefined,
    fiscalYear: String(b.fiscalYear ?? ''),
    period: String(b.period ?? ''),
    title: String(b.title ?? ''),
    content: String(b.content ?? ''),
    metricContext: b.metricContext && typeof b.metricContext === 'object' ? b.metricContext : null,
  }, authUser.userId)
  await recordAudit({ userId: authUser.userId, module: 'reports', action: 'analysis_create', targetId: data.id, detail: { companyCode: data.companyCode, subjectCode: data.subjectCode }, ip: clientIp(req) }, req.traceId)
  sendOk(res, data, 'success', 201)
}))

// 编辑
router.put('/analyses/:id', requirePermission('reports:update', 'update'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const b = req.body ?? {}
  const data = await SubjectAnalysisService.update(scopeOf(authUser), req.params.id as string, {
    title: typeof b.title === 'string' ? b.title : undefined,
    content: typeof b.content === 'string' ? b.content : undefined,
    metricContext: b.metricContext === null ? null : b.metricContext && typeof b.metricContext === 'object' ? b.metricContext : undefined,
  }, authUser.userId)
  await recordAudit({ userId: authUser.userId, module: 'reports', action: 'analysis_update', targetId: data.id, ip: clientIp(req) }, req.traceId)
  sendOk(res, data)
}))

// 删除（软删除）
router.delete('/analyses/:id', requirePermission('reports:delete', 'delete'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  await SubjectAnalysisService.remove(scopeOf(authUser), req.params.id as string, authUser.userId)
  await recordAudit({ userId: authUser.userId, module: 'reports', action: 'analysis_delete', targetId: req.params.id, ip: clientIp(req) }, req.traceId)
  sendOk(res, null)
}))

// ============ 汇总分析报告 ============

// 列表
router.get('/', requirePermission('reports:view', 'view'), asyncHandler(async (req, res) => {
  const data = await ReportService.list({
    page: req.query.page ? Number(req.query.page) : undefined,
    pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    status: req.query.status as string | undefined,
  })
  sendOk(res, data)
}))

// 创建
router.post('/', requirePermission('reports:create', 'create'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const b = req.body ?? {}
  const data = await ReportService.create({
    title: String(b.title ?? ''),
    fiscalYear: String(b.fiscalYear ?? ''),
    period: String(b.period ?? ''),
    companyScope: { type: b.companyScope?.type === 'summary' ? 'summary' : 'company', code: String(b.companyScope?.code ?? '') },
  }, authUser.userId)
  await recordAudit({ userId: authUser.userId, module: 'reports', action: 'report_create', targetId: data.id, detail: { scope: data.companyScope.code }, ip: clientIp(req) }, req.traceId)
  sendOk(res, data, 'success', 201)
}))

// 详情
router.get('/:id', requirePermission('reports:view', 'view'), asyncHandler(async (req, res) => {
  const data = await ReportService.getById(req.params.id as string)
  sendOk(res, data)
}))

// 更新（标题/状态）
router.put('/:id', requirePermission('reports:update', 'update'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const b = req.body ?? {}
  const data = await ReportService.update(req.params.id as string, {
    title: typeof b.title === 'string' ? b.title : undefined,
    status: typeof b.status === 'string' ? b.status : undefined,
  }, authUser.userId)
  await recordAudit({ userId: authUser.userId, module: 'reports', action: 'report_update', targetId: data.id, ip: clientIp(req) }, req.traceId)
  sendOk(res, data)
}))

// 归档（软删除）
router.delete('/:id', requirePermission('reports:delete', 'delete'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  await ReportService.archive(req.params.id as string, authUser.userId)
  await recordAudit({ userId: authUser.userId, module: 'reports', action: 'report_archive', targetId: req.params.id, ip: clientIp(req) }, req.traceId)
  sendOk(res, null)
}))

// 按 companyScope 生成章节（实时引用）
router.post('/:id/sections/generate', requirePermission('reports:update', 'update'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const data = await ReportService.generateSections(scopeOf(authUser), req.params.id as string, authUser.userId)
  await recordAudit({ userId: authUser.userId, module: 'reports', action: 'report_generate_sections', targetId: req.params.id, ip: clientIp(req) }, req.traceId)
  sendOk(res, data)
}))

// 重排/增删章节
router.put('/:id/sections', requirePermission('reports:update', 'update'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const items = Array.isArray(req.body?.items) ? req.body.items : []
  const data = await ReportService.setSections(req.params.id as string, items, authUser.userId)
  await recordAudit({ userId: authUser.userId, module: 'reports', action: 'report_set_sections', targetId: req.params.id, ip: clientIp(req) }, req.traceId)
  sendOk(res, data)
}))

// 保存版本快照
router.post('/:id/versions', requirePermission('reports:update', 'update'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const data = await ReportService.saveVersion(req.params.id as string, req.body?.changeSummary as string | undefined, authUser.userId)
  await recordAudit({ userId: authUser.userId, module: 'reports', action: 'report_save_version', targetId: req.params.id, detail: data, ip: clientIp(req) }, req.traceId)
  sendOk(res, data)
}))

// 版本历史
router.get('/:id/versions', requirePermission('reports:view', 'view'), asyncHandler(async (req, res) => {
  const data = await ReportService.listVersions(req.params.id as string)
  sendOk(res, data)
}))

// 导出结构化数据（前端生成 Word/PDF）
router.get('/:id/export', requirePermission('reports:export', 'export'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const data = await ReportService.exportStructured(req.params.id as string)
  await recordAudit({ userId: authUser.userId, module: 'reports', action: 'report_export', targetId: req.params.id, detail: { format: req.query.format ?? 'docx' }, ip: clientIp(req) }, req.traceId)
  sendOk(res, data)
}))

export default router
