import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import type { Request, Response } from 'express'
import { asyncHandler } from '../lib/async-handler'
import { sendOk, sendFail } from '../lib/response'
import { recordAudit, clientIp } from '../middleware/audit'
import { ReportService } from '../services/ReportService'

/**
 * 报告公开分享路由（GET /api/v1/reports/shared/:token）。
 *
 * 该路由不经 authenticate / attachScope——shareToken（uuid v4，不可枚举）即授权。
 * 安全措施（优化方案 §9.2）：
 *   - 独立限流 20 次/分钟/IP（在 app.ts 注册于通用限流之前）
 *   - 仅已发布（published）报告可访问；token 过期/吊销即失效
 *   - 每次访问自增 viewCount 并写审计（userId=null，含 IP/UA）
 *   - 只读：不暴露任何写操作
 */
const router = Router()

/** 分享链接限流：20 次/分钟/IP（token 爆破/爬取防护；与登录限流同款响应格式） */
export const shareRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req: Request, res: Response) => {
    sendFail(res, 429, '访问频率超限，请约 1 分钟后重试', 429)
  },
})

router.get(
  '/shared/:token',
  shareRateLimiter,
  asyncHandler(async (req, res) => {
    const token = req.params.token ?? ''
    const data = await ReportService.getSharedReport(token)
    // 公开访问审计：无 userId（token 即授权），记录 IP/UA 供泄露溯源
    await recordAudit({
      userId: null,
      module: 'reports',
      action: 'share_view',
      targetId: data.id,
      detail: { ip: clientIp(req), ua: String(req.headers['user-agent'] ?? '').slice(0, 200) },
      ip: clientIp(req),
    }, req.traceId)
    sendOk(res, data)
  }),
)

export default router
