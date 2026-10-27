import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { attachScope } from '../middleware/attach-scope'
import { requirePermission } from '../middleware/permission'
import { asyncHandler } from '../lib/async-handler'
import { errors } from '../lib/errors'
import { sendOk } from '../lib/response'
import { ROW_DIMS } from '../lib/analysis-query'
import { DashboardService } from '../services/DashboardService'
import { AnalysisQueryService } from '../services/AnalysisQueryService'
import { AnalysisViewService } from '../services/AnalysisViewService'
import { resolveColMembers } from '../services/analysis/col-members'
import type { AuthUserContext } from '../types/express'

/**
 * 首页看板路由（/api/v1/dashboard）。需登录 + dashboard:view。
 */
const router = Router()

function scopeOf(authUser: AuthUserContext) {
  return { companyCode: authUser.companyCode, scopeValue: authUser.scopeValue, dataScopeCodes: authUser.dataScopeCodes }
}

router.use(authenticate, attachScope())

router.get('/overview', requirePermission('dashboard:view', 'view'), asyncHandler(async (req, res) => {
  const data = await DashboardService.getOverview(scopeOf(req.authUser as AuthUserContext), {
    period: req.query.period as string | undefined,
    companyCode: req.query.companyCode as string | undefined,
  })
  sendOk(res, data)
}))

router.get('/receivables', requirePermission('dashboard:view', 'view'), asyncHandler(async (req, res) => {
  const mode = req.query.mode === 'summary' ? 'summary' : 'single'
  const data = await DashboardService.getReceivables(scopeOf(req.authUser as AuthUserContext), {
    period: req.query.period as string | undefined,
    mode,
    companyCode: req.query.companyCode as string | undefined,
  })
  sendOk(res, data)
}))

router.get('/drill', requirePermission('dashboard:view', 'view'), asyncHandler(async (req, res) => {
  const data = await DashboardService.getDrill(scopeOf(req.authUser as AuthUserContext), {
    companyCode: req.query.companyCode as string | undefined,
    period: req.query.period as string | undefined,
  })
  sendOk(res, data)
}))

router.get('/trend', requirePermission('dashboard:view', 'view'), asyncHandler(async (req, res) => {
  const months = req.query.months ? Number(req.query.months) : undefined
  const data = await DashboardService.getTrend(scopeOf(req.authUser as AuthUserContext), { months })
  sendOk(res, data)
}))

router.get('/product-budget', requirePermission('dashboard:view', 'view'), asyncHandler(async (req, res) => {
  const data = await DashboardService.getProductBudget(scopeOf(req.authUser as AuthUserContext), {
    period: req.query.period as string | undefined,
    companyCode: req.query.companyCode as string | undefined,
  })
  sendOk(res, data)
}))

router.get('/subject-budget', requirePermission('dashboard:view', 'view'), asyncHandler(async (req, res) => {
  const mode = req.query.mode === 'summary' ? 'summary' : 'single'
  const data = await DashboardService.getSubjectBudget(scopeOf(req.authUser as AuthUserContext), {
    period: req.query.period as string | undefined,
    mode,
    companyCode: req.query.companyCode as string | undefined,
  })
  sendOk(res, data)
}))

router.get('/expense-analysis', requirePermission('dashboard:view', 'view'), asyncHandler(async (req, res) => {
  const data = await DashboardService.getExpenseAnalysis(scopeOf(req.authUser as AuthUserContext), {
    period: req.query.period as string | undefined,
    companyCode: req.query.companyCode as string | undefined,
  })
  sendOk(res, data)
}))

router.get('/analysis/key-metrics', requirePermission('dashboard:view', 'view'), asyncHandler(async (req, res) => {
  const data = await DashboardService.getKeyMetrics(scopeOf(req.authUser as AuthUserContext), {
    period: req.query.period as string | undefined,
    companyCode: req.query.companyCode as string | undefined,
  })
  sendOk(res, data)
}))

// 品类核心指标分析（产品配置全行 + 整体合计；dimension 预留渠道扩展，当前仅 product）
router.get('/analysis/product-metrics', requirePermission('dashboard:view', 'view'), asyncHandler(async (req, res) => {
  const data = await DashboardService.getProductMetrics(scopeOf(req.authUser as AuthUserContext), {
    period: req.query.period as string | undefined,
    companyCode: req.query.companyCode as string | undefined,
  })
  sendOk(res, data)
}))

router.get('/alerts', requirePermission('dashboard:view', 'view'), asyncHandler(async (req, res) => {
  const data = await DashboardService.getAlerts(scopeOf(req.authUser as AuthUserContext))
  sendOk(res, data)
}))

// 即席分析查询：以「行维度 × 指标列」为参数返回统一二维结果（见 docs/plans/即席分析模块技术方案.md §4）
// 用 POST 而非 GET：查询描述含数组字段（metrics/rowCodes），GET 查询串冗长且需转义；语义为「提交查询描述」而非创建资源
router.post('/analysis/query', requirePermission('dashboard:view', 'view'), asyncHandler(async (req, res) => {
  const data = await AnalysisQueryService.query(scopeOf(req.authUser as AuthUserContext), req.body)
  sendOk(res, data)
}))

// 列成员清单（矩阵模式选择器用）：查询描述只有 dim 一个标量，用 GET；
// 与 /analysis/query 内的 resolveColMembers 同源，避免前端另维护一份成员口径
router.get('/analysis/col-members', requirePermission('dashboard:view', 'view'), asyncHandler(async (req, res) => {
  const parsed = z.object({ dim: z.enum(ROW_DIMS) }).safeParse(req.query)
  if (!parsed.success) {
    throw errors.badRequest(`dim 须为 ${ROW_DIMS.join(' / ')}`)
  }
  const members = await resolveColMembers(parsed.data.dim)
  sendOk(res, { dim: parsed.data.dim, members })
}))

// ---- 即席分析视图（自定义报表持久化，L1-3）----
// 权限全部复用 dashboard:view；更新/删除的创建者/超管校验在服务层（需 userId/roleCode）
router.get('/analysis/views', requirePermission('dashboard:view', 'view'), asyncHandler(async (req, res) => {
  const data = await AnalysisViewService.list(req.authUser as AuthUserContext)
  sendOk(res, { views: data })
}))

router.post('/analysis/views', requirePermission('dashboard:view', 'view'), asyncHandler(async (req, res) => {
  const data = await AnalysisViewService.create(req.authUser as AuthUserContext, req.body)
  sendOk(res, data)
}))

router.put('/analysis/views/:id', requirePermission('dashboard:view', 'view'), asyncHandler(async (req, res) => {
  const data = await AnalysisViewService.update(req.authUser as AuthUserContext, req.params.id, req.body)
  sendOk(res, data)
}))

router.delete('/analysis/views/:id', requirePermission('dashboard:view', 'view'), asyncHandler(async (req, res) => {
  await AnalysisViewService.remove(req.authUser as AuthUserContext, req.params.id)
  sendOk(res, { id: req.params.id })
}))

export default router
