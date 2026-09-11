import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { attachScope } from '../middleware/attach-scope'
import { requirePermission } from '../middleware/permission'
import { asyncHandler } from '../lib/async-handler'
import { sendOk } from '../lib/response'
import { recordAudit, clientIp } from '../middleware/audit'
import { EnterpriseInfoService } from '../services/EnterpriseInfoService'
import type { AuthUserContext } from '../types/express'

/**
 * 其他工具路由（/api/v1/tools）。
 * 本期：企业工商信息查询（tools:view）。
 */
const router = Router()

router.use(authenticate, attachScope())

// ===== 企业工商查询 =====
router.get('/enterprise/search', requirePermission('tools:view', 'view'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const keyword = String(req.query.keyword ?? '')
  const data = await EnterpriseInfoService.search(keyword, authUser.userId, req.traceId)
  await recordAudit({ userId: authUser.userId, module: 'tools', action: 'enterprise_search', targetId: data?.creditCode ?? null, detail: { keyword: keyword.trim() }, ip: clientIp(req) }, req.traceId)
  sendOk(res, data)
}))

// ===== 本人查询历史 =====
router.get('/enterprise/history', requirePermission('tools:view', 'view'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const page = Math.max(Number(req.query.page) || 1, 1)
  const pageSize = Math.min(Math.max(Number(req.query.pageSize) || 10, 1), 100)
  sendOk(res, await EnterpriseInfoService.listHistory(authUser.userId, { page, pageSize }))
}))

export default router
