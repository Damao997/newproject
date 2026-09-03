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
import type { OperatingRow, StaticRow } from '../services/IndicatorsService'
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

/** 客户端断开监听：SSE 连接提前关闭时中止上游 LLM 流，避免继续消耗 token 配额 */
function onClientAbort(res: Response): AbortSignal {
  const controller = new AbortController()
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })
  return controller.signal
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
    const signal = onClientAbort(res)
    try {
      const { finalText } = await AIProxyService.polishStream(
        { text, style, userId: authUser.userId, traceId: req.traceId, signal },
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
          signal: onClientAbort(res),
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
          signal: onClientAbort(res),
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

// AI 全局预分析（当前显示主体的经营+静态指标 → SSE 流式生成预分析报告）
router.post(
  '/overview',
  requirePermission('reports:create', 'create'),
  aiRateLimiter,
  asyncHandler(async (req, res) => {
    const authUser = req.authUser as AuthUserContext
    const b = req.body ?? {}
    const operating = normalizeOverviewRows(Array.isArray(b.operating) ? (b.operating as OperatingRow[]) : [], OP_NUMERIC_KEYS)
    const staticRows = normalizeOverviewRows(Array.isArray(b.static) ? (b.static as StaticRow[]) : [], ST_NUMERIC_KEYS)
    // 行数上限防 payload 滥用（前端全量行远低于该值，超限视为异常请求）
    if (operating.length > 500 || staticRows.length > 500) throw errors.badRequest('指标数据超出单次分析上限')
    initSSE(res)
    try {
      const { finalText } = await AIProxyService.overviewStream(
        {
          companyCode: typeof b.companyCode === 'string' && b.companyCode ? b.companyCode : undefined,
          period: typeof b.period === 'string' ? b.period : undefined,
          operating,
          static: staticRows,
          userId: authUser.userId,
          traceId: req.traceId,
          scope: { companyCode: authUser.companyCode, scopeValue: authUser.scopeValue, dataScopeCodes: authUser.dataScopeCodes },
          signal: onClientAbort(res),
        },
        (delta) => sseWrite(res, { type: 'token', content: delta }),
      )
      sseWrite(res, { type: 'done', finalText })
    } catch (err) {
      const message = err instanceof AppError ? err.message : 'AI 预分析生成失败'
      sseWrite(res, { type: 'error', error: message })
    } finally {
      res.end()
    }
  }),
)

/** 经营行数值字段（归一化用） */
const OP_NUMERIC_KEYS = ['budget', 'actual', 'samePeriod', 'ytd', 'samePeriodYtd', 'yoy', 'achievement', 'ytdYoy'] as const
/** 静态行数值字段（归一化用） */
const ST_NUMERIC_KEYS = ['current', 'yearStart', 'samePeriod', 'lastYearStart', 'yoy'] as const

/**
 * 行内字段轻量归一：数值字段非法值（NaN/字符串/缺省）归 0、名称截断至 100 字、level 收敛为非负整数。
 * 防异常 payload 破坏服务端筛选排序（Math.abs/toFixed 抛错被兜底吞掉）或污染注入 prompt。
 */
function normalizeOverviewRows<T>(rows: T[], numericKeys: readonly string[]): T[] {
  return rows
    .filter((r) => !!r && typeof r === 'object')
    .map((r) => {
      const n = { ...(r as Record<string, unknown>) }
      for (const k of numericKeys) {
        const v = Number(n[k])
        n[k] = Number.isFinite(v) ? v : 0
      }
      n.name = String(n.name ?? '').slice(0, 100)
      n.level = Number.isFinite(Number(n.level)) ? Math.max(0, Math.floor(Number(n.level))) : 0
      return n as T
    })
}

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
