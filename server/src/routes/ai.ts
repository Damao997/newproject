import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { requirePermission } from '../middleware/permission'
import { aiRateLimiter } from '../middleware/ai-rate-limit'
import { asyncHandler } from '../lib/async-handler'
import { sendOk } from '../lib/response'
import { errors } from '../lib/errors'
import { AppError } from '../lib/errors'
import { AIProxyService } from '../services/AIProxyService'
import { FormulaRuleService } from '../services/FormulaRuleService'
import type { Response } from 'express'
import type { AuthUserContext } from '../types/express'

/**
 * AI 路由（/api/v1/ai）。本期：公式生成（单条 LLM + 批量规则）。
 * 权限沿用 data:metric:create / data:metric:update。
 */
const router = Router()

router.use(authenticate)

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
          scope: { companyCode: authUser.companyCode, orgScopeBu: authUser.orgScopeBu, scopeValue: authUser.scopeValue },
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

// 公式规则列表
router.get(
  '/formula-rules',
  requirePermission('data:metric:create', 'create'),
  asyncHandler(async (_req, res) => {
    sendOk(res, await FormulaRuleService.listRules())
  }),
)

// 公式规则新增
router.post(
  '/formula-rules',
  requirePermission('data:metric:create', 'create'),
  asyncHandler(async (req, res) => {
    const b = req.body ?? {}
    if (!b.name || !b.formulaTemplate) throw errors.badRequest('规则名称与公式模板必填')
    sendOk(res, await FormulaRuleService.createRule(b, { userId: (req.authUser as AuthUserContext).userId, traceId: req.traceId }))
  }),
)

// 公式规则修改
router.put(
  '/formula-rules/:id',
  requirePermission('data:metric:update', 'update'),
  asyncHandler(async (req, res) => {
    sendOk(res, await FormulaRuleService.updateRule(req.params.id as string, req.body ?? {}, { userId: (req.authUser as AuthUserContext).userId, traceId: req.traceId }))
  }),
)

// 公式规则启停
router.post(
  '/formula-rules/:id/toggle',
  requirePermission('data:metric:update', 'update'),
  asyncHandler(async (req, res) => {
    const enabled = Boolean(req.body?.enabled)
    sendOk(res, await FormulaRuleService.toggleRule(req.params.id as string, enabled, { userId: (req.authUser as AuthUserContext).userId, traceId: req.traceId }))
  }),
)

// 公式规则删除
router.delete(
  '/formula-rules/:id',
  requirePermission('data:metric:delete', 'delete'),
  asyncHandler(async (req, res) => {
    await FormulaRuleService.deleteRule(req.params.id as string, { userId: (req.authUser as AuthUserContext).userId, traceId: req.traceId })
    sendOk(res, null)
  }),
)

// 批量生成公式（预览，不落库）
router.post(
  '/formula/batch-preview',
  requirePermission('data:metric:create', 'create'),
  asyncHandler(async (req, res) => {
    const subjectType = req.body?.subjectType === 'static' ? 'static' : 'operating'
    sendOk(res, await FormulaRuleService.batchGenerate({ subjectType }))
  }),
)

// 批量应用公式（落库）
router.post(
  '/formula/batch-apply',
  requirePermission('data:metric:update', 'update'),
  asyncHandler(async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : []
    const validItems = items
      .filter((it: { code?: unknown; formula?: unknown }) => typeof it.code === 'string' && typeof it.formula === 'string' && it.formula)
      .map((it: { code: string; formula: string; dependsOn?: string[] }) => ({
        code: it.code,
        formula: it.formula,
        dependsOn: Array.isArray(it.dependsOn) ? it.dependsOn : [],
      }))
    if (validItems.length === 0) throw errors.badRequest('没有可应用的有效公式')
    const data = await FormulaRuleService.batchApply(validItems, (req.authUser as AuthUserContext).userId, req.traceId)
    sendOk(res, data)
  }),
)

export default router
