import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { attachScope } from '../middleware/attach-scope'
import { requirePermission } from '../middleware/permission'
import { aiRateLimiter } from '../middleware/ai-rate-limit'
import { asyncHandler } from '../lib/async-handler'
import { sendOk } from '../lib/response'
import { errors } from '../lib/errors'
import { AppError } from '../lib/errors'
import { AIProxyService } from '../services/AIProxyService'
import { ReportService } from '../services/ReportService'
import type { Response } from 'express'
import type { AuthUserContext } from '../types/express'

/**
 * AI 路由（/api/v1/ai）。本期：报告润色/追加分析/总体概述（SSE）+ 单条 LLM 公式生成。
 * 权限沿用 reports:create / data:metric:create。
 */
const router = Router()

function scopeOf(authUser: AuthUserContext) {
  return { companyCode: authUser.companyCode, scopeValue: authUser.scopeValue, dataScopeCodes: authUser.dataScopeCodes }
}

router.use(authenticate, attachScope())

/** 初始化 SSE 响应头 */
function initSSE(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
}

/** 写一个 SSE 事件 */
function sseWrite(res: Response, event: { type: string; content?: string; error?: string; finalText?: string }): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

// AI 润色（选中文本 → SSE 流式润色，不覆盖编辑器）
router.post(
  '/polish',
  requirePermission('reports:create', 'create'),
  aiRateLimiter,
  asyncHandler(async (req, res) => {
    const text = String(req.body?.text ?? '')
    const style = typeof req.body?.style === 'string' ? req.body.style : 'formal'
    const authUser = req.authUser as AuthUserContext
    initSSE(res)
    try {
      const { finalText } = await AIProxyService.polishStream(
        { text, style, userId: authUser.userId, traceId: req.traceId },
        (delta) => sseWrite(res, { type: 'token', content: delta }),
      )
      sseWrite(res, { type: 'done', finalText })
    } catch (err) {
      const message = err instanceof AppError ? err.message : 'AI 润色失败'
      sseWrite(res, { type: 'error', error: message })
    } finally {
      res.end()
    }
  }),
)

// AI 追加分析（公司×科目真实变化率 → SSE 流式生成初稿）
router.post(
  '/analyze',
  requirePermission('reports:create', 'create'),
  aiRateLimiter,
  asyncHandler(async (req, res) => {
    const authUser = req.authUser as AuthUserContext
    const b = req.body ?? {}
    initSSE(res)
    try {
      const { finalText } = await AIProxyService.analyzeStream(
        {
          scope: { companyCode: authUser.companyCode, scopeValue: authUser.scopeValue, dataScopeCodes: authUser.dataScopeCodes },
          companyCode: String(b.companyCode ?? ''),
          subjectCode: String(b.subjectCode ?? ''),
          subjectType: b.subjectType === 'static' ? 'static' : 'operating',
          period: typeof b.period === 'string' ? b.period : undefined,
          userPrompt: typeof b.userPrompt === 'string' ? b.userPrompt : undefined,
          userId: authUser.userId,
          traceId: req.traceId,
        },
        (delta) => sseWrite(res, { type: 'token', content: delta }),
      )
      sseWrite(res, { type: 'done', finalText })
    } catch (err) {
      const message = err instanceof AppError ? err.message : 'AI 分析失败'
      sseWrite(res, { type: 'error', error: message })
    } finally {
      res.end()
    }
  }),
)

// 报告总体概述（各章节摘录 → SSE 流式生成概述初稿；scope 校验在 SSE 开启前完成）
router.post(
  '/report-summary',
  requirePermission('reports:create', 'create'),
  aiRateLimiter,
  asyncHandler(async (req, res) => {
    const authUser = req.authUser as AuthUserContext
    const reportId = String(req.body?.reportId ?? '')
    if (!reportId) throw errors.badRequest('reportId 为必填项')
    // 先完成 scope/存在性校验（此时仍可返回普通 JSON 错误），再开启 SSE
    const exportData = await ReportService.exportStructured(scopeOf(authUser), reportId)
    initSSE(res)
    try {
      const { finalText } = await AIProxyService.summarizeStream(
        {
          title: exportData.title,
          sections: exportData.sections.filter((s) => !s.missing).map((s) => ({ title: s.title, plainText: s.plainText })),
          userId: authUser.userId,
          traceId: req.traceId,
        },
        (delta) => sseWrite(res, { type: 'token', content: delta }),
      )
      sseWrite(res, { type: 'done', finalText })
    } catch (err) {
      const message = err instanceof AppError ? err.message : 'AI 概述生成失败'
      sseWrite(res, { type: 'error', error: message })
    } finally {
      res.end()
    }
  }),
)

// 单条 AI 公式生成（DeepSeek，限流）
router.post(
  '/formula',
  requirePermission('data:metric:create', 'create'),
  aiRateLimiter,
  asyncHandler(async (req, res) => {
    const userDescription = String(req.body?.userDescription ?? '').trim()
    if (!userDescription) throw errors.badRequest('业务描述不能为空')
    const subjectType = req.body?.subjectType === 'static' ? 'static' : 'operating'
    const data = await AIProxyService.generateFormula({
      userDescription,
      subjectType,
      userId: (req.authUser as AuthUserContext).userId,
      traceId: req.traceId,
    })
    sendOk(res, data)
  }),
)

export default router
