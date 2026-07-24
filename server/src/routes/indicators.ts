import { Router, type Response } from 'express'
import { authenticate } from '../middleware/auth'
import { requirePermission } from '../middleware/permission'
import { asyncHandler } from '../lib/async-handler'
import { sendOk } from '../lib/response'
import { errors } from '../lib/errors'
import { recordAudit, clientIp } from '../middleware/audit'
import { IndicatorsService } from '../services/IndicatorsService'
import type { AuthUserContext } from '../types/express'

/**
 * 财务指标路由（/api/v1/indicators）。
 * 全部需登录 + indicators:view 权限；导出需 indicators:export。
 */
const router = Router()

function scopeOf(authUser: AuthUserContext) {
  return { companyCode: authUser.companyCode, scopeValue: authUser.scopeValue }
}

function sendXlsx(res: Response, buffer: Buffer, filename: string): void {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
  res.send(buffer)
}

router.use(authenticate)

// GET /indicators/tree?type=operating|static
router.get('/tree', requirePermission('indicators:view', 'view'), asyncHandler(async (req, res) => {
  const type = req.query.type === 'static' ? 'static' : 'operating'
  const tree = await IndicatorsService.getTree(type)
  sendOk(res, tree)
}))

// GET /indicators/operating
router.get('/operating', requirePermission('indicators:view', 'view'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const data = await IndicatorsService.getOperating(scopeOf(authUser), {
    companyCode: req.query.companyCode as string | undefined,
    period: req.query.period as string | undefined,
  })
  sendOk(res, data)
}))

// GET /indicators/static
router.get('/static', requirePermission('indicators:view', 'view'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const data = await IndicatorsService.getStatic(scopeOf(authUser), {
    companyCode: req.query.companyCode as string | undefined,
  })
  sendOk(res, data)
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

// GET /indicators/export?type=operating|static&format=excel
router.get('/export', requirePermission('indicators:export', 'export'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const type = req.query.type === 'static' ? 'static' : 'operating'
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
