import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { attachScope } from '../middleware/attach-scope'
import { requirePermission } from '../middleware/permission'
import { asyncHandler } from '../lib/async-handler'
import { sendOk } from '../lib/response'
import { errors } from '../lib/errors'
import { InventoryService } from '../services/InventoryService'
import type { AuthUserContext } from '../types/express'

/**
 * 存货管理路由（/api/v1/inventory）。
 * 数据源为 fact_static 静态数据（存货品类叶子科目），只读查看，权限：inventory:view。
 */
const router = Router()

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

function scopeOf(authUser: AuthUserContext) {
  return { companyCode: authUser.companyCode, scopeValue: authUser.scopeValue, dataScopeCodes: authUser.dataScopeCodes }
}

/** 公司筛选参数（单值或逗号分隔多值；未传 → undefined，由数据范围兜底） */
function parseCompanies(raw: unknown): string[] | undefined {
  const codes = raw ? String(raw).split(',').map((s) => s.trim()).filter(Boolean) : []
  return codes.length > 0 ? codes : undefined
}

function requirePeriod(raw: unknown): string {
  const period = String(raw ?? '')
  if (!PERIOD_RE.test(period)) throw errors.badRequest('期间格式应为 YYYY-MM')
  return period
}

router.use(authenticate, attachScope())

// ===== 总览：存货总额 + 品类占比/排名 + 存货周转天数 =====
router.get('/overview', requirePermission('inventory:view', 'view'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const data = await InventoryService.getOverview(scopeOf(authUser), {
    companyCodes: parseCompanies(req.query.companyCodes),
    period: requirePeriod(req.query.period),
  })
  sendOk(res, data)
}))

// ===== 明细：公司 × 品类（本期/年初/同期） =====
router.get('/details', requirePermission('inventory:view', 'view'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const data = await InventoryService.getDetails(scopeOf(authUser), {
    companyCodes: parseCompanies(req.query.companyCodes),
    period: requirePeriod(req.query.period),
  })
  sendOk(res, data)
}))

// ===== 趋势：财年内各月存货总额与品类值 =====
router.get('/trend', requirePermission('inventory:view', 'view'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const fiscalYear = String(req.query.fiscalYear ?? '')
  if (!fiscalYear) throw errors.badRequest('缺少财年参数')
  const data = await InventoryService.getTrend(scopeOf(authUser), {
    companyCodes: parseCompanies(req.query.companyCodes),
    fiscalYear,
  })
  sendOk(res, data)
}))

export default router
