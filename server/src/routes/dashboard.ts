import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { attachScope } from '../middleware/attach-scope'
import { requirePermission } from '../middleware/permission'
import { asyncHandler } from '../lib/async-handler'
import { sendOk } from '../lib/response'
import { DashboardService } from '../services/DashboardService'
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

export default router
