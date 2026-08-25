import { Router, type Response } from 'express'
import { authenticate } from '../middleware/auth'
import { attachScope } from '../middleware/attach-scope'
import { requirePermission, requireAnyPermission } from '../middleware/permission'
import { asyncHandler } from '../lib/async-handler'
import { sendOk } from '../lib/response'
import { errors } from '../lib/errors'
import { recordAudit, clientIp } from '../middleware/audit'
import { IndicatorsService } from '../services/IndicatorsService'
import type { AuthUserContext } from '../types/express'

/**
 * 财务指标路由（/api/v1/indicators）。
 * 需登录；业务端点（operating/static/cross/:code）要求 indicators:view，导出需 indicators:export。
 * /tree 与 /periods 为多模块共享元数据端点（科目结构/可用期间，不含业务值），
 * 持有任一模块查看权限即可读取（与 /data/companies 同款权限门）。
 */
const router = Router()

/** 共享元数据端点候选权限清单：与 /data/companies 保持一致 */
const SHARED_VIEW_GRANTS = [
  { resource: 'dashboard:view', action: 'view' as const },
  { resource: 'indicators:view', action: 'view' as const },
  { resource: 'reports:view', action: 'view' as const },
  { resource: 'transactions:view', action: 'view' as const },
  { resource: 'inventory:view', action: 'view' as const },
  { resource: 'data:browse:view', action: 'view' as const },
]

function scopeOf(authUser: AuthUserContext) {
  return { companyCode: authUser.companyCode, scopeValue: authUser.scopeValue, dataScopeCodes: authUser.dataScopeCodes }
}

function sendXlsx(res: Response, buffer: Buffer, filename: string): void {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
  res.send(buffer)
}

/** 解析布尔查询参数（'1'/'true' 视为 true） */
function boolQuery(v: unknown): boolean {
  return v === '1' || v === 'true'
}

router.use(authenticate, attachScope())

// GET /indicators/tree?type=operating|static|cashflow（科目树元数据，库存页/指标页共用）
router.get('/tree', requireAnyPermission(SHARED_VIEW_GRANTS), asyncHandler(async (req, res) => {
  const type = req.query.type === 'static' ? 'static' : req.query.type === 'cashflow' ? 'cashflow' : 'operating'
  const tree = await IndicatorsService.getTree(type)
  sendOk(res, tree)
}))

// GET /indicators/operating
router.get('/operating', requirePermission('indicators:view', 'view'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const data = await IndicatorsService.getOperating(scopeOf(authUser), {
    companyCode: req.query.companyCode as string | undefined,
    period: req.query.period as string | undefined,
    excludeReclassify: boolQuery(req.query.excludeReclassify),
  })
  sendOk(res, data)
}))

// GET /indicators/static
router.get('/static', requirePermission('indicators:view', 'view'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const data = await IndicatorsService.getStatic(scopeOf(authUser), {
    companyCode: req.query.companyCode as string | undefined,
    period: req.query.period as string | undefined,
    excludeReclassify: boolQuery(req.query.excludeReclassify),
  })
  sendOk(res, data)
}))

// GET /indicators/cashflow
router.get('/cashflow', requirePermission('indicators:view', 'view'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const data = await IndicatorsService.getCashflow(scopeOf(authUser), {
    companyCode: req.query.companyCode as string | undefined,
    period: req.query.period as string | undefined,
  })
  sendOk(res, data)
}))

// GET /indicators/periods（可用期间/财年元数据，header 财年选择器与各页期间筛选共用）
router.get('/periods', requireAnyPermission(SHARED_VIEW_GRANTS), asyncHandler(async (_req, res) => {
  const periods = await IndicatorsService.getAvailablePeriods()
  sendOk(res, periods)
}))

// POST /indicators/cross
router.post('/cross', requirePermission('indicators:view', 'view'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const body = req.body ?? {}
  const data = await IndicatorsService.getCross(scopeOf(authUser), {
    companyCodes: Array.isArray(body.companyCodes) ? body.companyCodes : undefined,
    metricCodes: Array.isArray(body.metricCodes) ? body.metricCodes : undefined,
    period: typeof body.period === 'string' ? body.period : undefined,
  })
  sendOk(res, data)
}))

// GET /indicators/export?type=operating|static|cashflow&format=excel
router.get('/export', requirePermission('indicators:export', 'export'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const type = req.query.type === 'static' ? 'static' : req.query.type === 'cashflow' ? 'cashflow' : 'operating'
  const buffer = await IndicatorsService.exportIndicators(scopeOf(authUser), type, {
    companyCode: req.query.companyCode as string | undefined,
    period: req.query.period as string | undefined,
  })
  await recordAudit({ userId: authUser.userId, module: 'indicators', action: 'export', targetId: type, ip: clientIp(req) }, req.traceId)
  sendXlsx(res, buffer, `indicators-${type}.xlsx`)
}))

// GET /indicators/:code
router.get('/:code', requirePermission('indicators:view', 'view'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const code = req.params.code
  if (!code) throw errors.badRequest('缺少科目编码')
  const data = await IndicatorsService.getByCode(scopeOf(authUser), code, {
    companyCode: req.query.companyCode as string | undefined,
    period: req.query.period as string | undefined,
  })
  sendOk(res, data)
}))

export default router
