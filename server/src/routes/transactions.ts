import { Router } from 'express'
import multer from 'multer'
import type { Response } from 'express'
import { authenticate } from '../middleware/auth'
import { attachScope } from '../middleware/attach-scope'
import { requirePermission } from '../middleware/permission'
import { asyncHandler } from '../lib/async-handler'
import { sendOk } from '../lib/response'
import { errors, AppError } from '../lib/errors'
import { TransactionService } from '../services/TransactionService'
import { ImportService } from '../services/ImportService'
import { CollectionService } from '../services/CollectionService'
import { resolveCompanyCodes, resolveDashboardCompany } from '../services/AggregationService'
import { fixUploadFilename } from '../lib/sanitize'
import { recordAudit, clientIp } from '../middleware/audit'
import type { AuthUserContext } from '../types/express'

/**
 * 往来分析路由（/api/v1/transactions）。
 * 权限：查看 transactions:view；导入 transactions:import；催收 transactions:create/update；导出 transactions:export。
 */
const router = Router()

function sendXlsx(res: Response, buffer: Buffer, filename: string): void {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`)
  res.send(buffer)
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } })

/** 关联方过滤参数校验：仅接受 internal/related/external，其余视为不过滤 */
function parsePartyType(v: unknown): 'internal' | 'related' | 'external' | undefined {
  const s = String(v ?? '')
  return s === 'internal' || s === 'related' || s === 'external' ? s : undefined
}

function scopeOf(authUser: AuthUserContext) {
  return { companyCode: authUser.companyCode, scopeValue: authUser.scopeValue, dataScopeCodes: authUser.dataScopeCodes }
}

/**
 * 公司筛选参数归一化（单值或逗号分隔多值）。
 * - 未传 → undefined：不加显式过滤，由 scopeContext 扩展按数据范围兜底
 * - 汇总主体 → 展开为成员单体；未被完整授权则降级为有权默认主体（不抛 403）
 * - 单体 → 校验在数据范围内，越权降级为有权默认主体
 * 降级顺序与看板一致：ET0001 → 任一授权汇总主体 → 任一授权单体（「全有或全无」授权，口径不得失真）。
 */
async function normalizeCompanies(authUser: AuthUserContext, raw: unknown): Promise<string[] | undefined> {
  const codes = raw ? String(raw).split(',').map((s) => s.trim()).filter(Boolean) : []
  if (codes.length === 0) return undefined
  const out = new Set<string>()
  let degradedOnce = false
  for (const c of codes) {
    try {
      for (const r of await resolveCompanyCodes(scopeOf(authUser), c)) out.add(r)
    } catch (e) {
      // 越权 403 / 主体不存在 404 → 用有权默认主体替换该编码；其它异常（如 DB 故障）照常上抛
      if (!(e instanceof AppError)) throw e
      if (!degradedOnce) {
        degradedOnce = true
        const eff = await resolveDashboardCompany(scopeOf(authUser))
        for (const r of eff.codes) out.add(r)
      }
    }
  }
  return [...out]
}

router.use(authenticate, attachScope())

// ===== 总览 =====
router.get('/overview', requirePermission('transactions:view', 'view'), asyncHandler(async (req, res) => {
  const companyCodes = await normalizeCompanies(req.authUser as AuthUserContext, req.query.companyCodes)
  const period = req.query.period as string | undefined
  const data = await TransactionService.getOverview({ companyCodes, period })
  sendOk(res, data)
}))

// ===== 已导入期间列表 =====
router.get('/periods', requirePermission('transactions:view', 'view'), asyncHandler(async (_req, res) => {
  const data = await TransactionService.listPeriods()
  sendOk(res, data)
}))

// ===== 账龄分析 =====
router.get('/aging', requirePermission('transactions:view', 'view'), asyncHandler(async (req, res) => {
  const q = req.query
  const data = await TransactionService.getAgingAnalysis({
    companyCodes: await normalizeCompanies(req.authUser as AuthUserContext, q.companyCode),
    transactionType: q.transactionType as string | undefined,
    groupBy: (q.groupBy as 'type' | 'counterparty' | 'account') || 'type',
    period: q.period as string | undefined,
    accountCodes: q.accountCodes ? String(q.accountCodes).split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    partyType: parsePartyType(q.partyType),
    counterpartyKeyword: q.counterpartyKeyword as string | undefined,
  })
  sendOk(res, data)
}))

// ===== 账龄分析导出（Excel；与 /aging 同口径，subtotalOnly 时仅小计/合计） =====
router.get('/aging/export', requirePermission('transactions:export', 'export'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const q = req.query
  const buffer = await TransactionService.exportAgingAnalysis({
    companyCodes: await normalizeCompanies(authUser, q.companyCode),
    transactionType: q.transactionType as string | undefined,
    groupBy: (q.groupBy as 'type' | 'counterparty' | 'account') || 'type',
    period: q.period as string | undefined,
    accountCodes: q.accountCodes ? String(q.accountCodes).split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    partyType: parsePartyType(q.partyType),
    counterpartyKeyword: q.counterpartyKeyword as string | undefined,
    subtotalOnly: q.subtotalOnly === 'true',
  })
  await recordAudit({
    userId: authUser.userId,
    module: 'transactions',
    action: 'export',
    targetId: 'aging',
    detail: { period: q.period, transactionType: q.transactionType, groupBy: q.groupBy, subtotalOnly: q.subtotalOnly === 'true', companyCode: q.companyCode },
    ip: clientIp(req),
  }, req.traceId)
  sendXlsx(res, buffer, `aging-analysis-${q.period ?? 'all'}.xlsx`)
}))

// ===== 会计科目列表（去重，供科目多选筛选；可按往来类型过滤） =====
router.get('/accounts', requirePermission('transactions:view', 'view'), asyncHandler(async (req, res) => {
  const data = await TransactionService.listAccounts({ transactionType: req.query.transactionType as string | undefined })
  sendOk(res, data)
}))

// ===== 科目过滤管理：全部科目（含排除项）=====
router.get('/accounts/manage', requirePermission('transactions:view', 'view'), asyncHandler(async (_req, res) => {
  const data = await TransactionService.listAccountsForManage()
  sendOk(res, data)
}))

// ===== 科目过滤管理：切换纳入/排除分析状态 =====
router.patch('/accounts/:code/status', requirePermission('transactions:update', 'update'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const status = req.body?.status === 'active' ? 'active' : 'inactive'
  const data = await TransactionService.updateAccountStatus(req.params.code as string, status, authUser.userId, req.traceId)
  sendOk(res, data)
}))

// ===== 内部往来汇总 =====
router.get('/internal/summary', requirePermission('transactions:view', 'view'), asyncHandler(async (req, res) => {
  const companyCodes = await normalizeCompanies(req.authUser as AuthUserContext, req.query.companyCode)
  const data = await TransactionService.getInternalSummary(companyCodes)
  sendOk(res, data)
}))

// ===== 内部往来镜像校验 =====
router.get('/internal/mirror-check', requirePermission('transactions:view', 'view'), asyncHandler(async (req, res) => {
  const companyCodes = await normalizeCompanies(req.authUser as AuthUserContext, req.query.companyCode)
  const data = await TransactionService.getInternalMirrorCheck(companyCodes)
  sendOk(res, data)
}))

// ===== 往来对象列表（筛选用） =====
router.get('/counterparties', requirePermission('transactions:view', 'view'), asyncHandler(async (req, res) => {
  const companyCodes = await normalizeCompanies(req.authUser as AuthUserContext, req.query.companyCode)
  const data = await TransactionService.listCounterparties(companyCodes)
  sendOk(res, data)
}))

// ===== 最新截止日期 =====
router.get('/latest-cutoff', requirePermission('transactions:view', 'view'), asyncHandler(async (_req, res) => {
  const data = await TransactionService.getLatestCutoff()
  sendOk(res, { cutoffDate: data })
}))

// ===== 往来余额变动趋势（单类型，按 公司×月份 聚合） =====
const TREND_TYPES = new Set(['应收账款', '其他应收款', '预收账款', '应付账款', '其他应付款', '预付账款'])

router.get('/trend', requirePermission('transactions:view', 'view'), asyncHandler(async (req, res) => {
  const transactionType = String(req.query.transactionType || '')
  if (!TREND_TYPES.has(transactionType)) throw errors.badRequest('往来类型不合法，需为六大往来类型之一')
  const companyCodes = await normalizeCompanies(req.authUser as AuthUserContext, req.query.companyCodes)
  const months = req.query.months ? Number(req.query.months) : undefined
  const fiscalYear = req.query.fiscalYear ? String(req.query.fiscalYear) : undefined
  if (fiscalYear && !/^FY\d{4}$/i.test(fiscalYear)) throw errors.badRequest('财年格式不合法，应形如 FY2026')
  const periodFrom = req.query.periodFrom ? String(req.query.periodFrom) : undefined
  const periodTo = req.query.periodTo ? String(req.query.periodTo) : undefined
  if ((periodFrom && !periodTo) || (!periodFrom && periodTo)) throw errors.badRequest('自定义期间需同时提供开始与结束期间')
  const data = await TransactionService.getTrend({ transactionType, companyCodes, months, fiscalYear, periodFrom, periodTo })
  sendOk(res, data)
}))

// ===== 往来数据涉及的财年列表（趋势图财年筛选） =====
router.get('/fiscal-years', requirePermission('transactions:view', 'view'), asyncHandler(async (_req, res) => {
  const data = await TransactionService.listFiscalYears()
  sendOk(res, data)
}))

// ===== 导入往来数据（六大往来账龄汇总表，多文件） =====
function pickUploadFiles(req: { files?: unknown }): Array<{ originalname: string; buffer: Buffer; size: number }> {
  const files = (req.files ?? []) as Express.Multer.File[]
  if (!files.length) throw errors.badRequest('缺少上传文件')
  return files.map((f) => {
    const originalname = fixUploadFilename(f.originalname)
    if (!/\.(xlsx|xls)$/i.test(originalname)) throw errors.badRequest(`仅支持 .xlsx/.xls 文件：${originalname}`)
    return { originalname, buffer: f.buffer, size: f.size }
  })
}

/** 数值单位：元/万元（解析期归一为元存储）；未传默认元（ERP 报表存量口径） */
function pickValueUnit(body: Record<string, unknown> | undefined): 'yuan' | 'wan' {
  const v = body?.valueUnit ? String(body.valueUnit) : 'yuan'
  if (v !== 'yuan' && v !== 'wan') throw errors.badRequest('非法的数值单位')
  return v
}

// 导入预览（dry-run，不建批次不写库）
router.post('/import/preview', requirePermission('transactions:import', 'import'), upload.array('files', 12), asyncHandler(async (req, res) => {
  const files = pickUploadFiles(req)
  const data = await ImportService.previewTransactions(files, pickValueUnit(req.body as Record<string, unknown>))
  sendOk(res, data)
}))

// 导入覆盖矩阵：公司×期间×六大类型 的 已生效/草稿/缺失 状态
router.get('/import/coverage', requirePermission('transactions:view', 'view'), asyncHandler(async (req, res) => {
  const months = req.query.months ? Number(req.query.months) : undefined
  // 矩阵行集合按数据范围收敛，避免暴露范围外公司及其申报覆盖
  const companyCodes = await resolveCompanyCodes(scopeOf(req.authUser as AuthUserContext))
  const data = await TransactionService.getImportCoverage({ months, companyCodes })
  sendOk(res, data)
}))

// 批次覆盖明细：该批次包含的三元组及笔数
router.get('/import/batches/:id/coverage', requirePermission('transactions:view', 'view'), asyncHandler(async (req, res) => {
  const data = await TransactionService.getBatchCoverage(req.params.id as string)
  sendOk(res, data)
}))

router.post('/import', requirePermission('transactions:import', 'import'), upload.array('files', 12), asyncHandler(async (req, res) => {
  const files = pickUploadFiles(req)
  const authUser = req.authUser as AuthUserContext
  const data = await ImportService.uploadTransactions(files, authUser.userId, req.traceId, pickValueUnit(req.body as Record<string, unknown>))
  sendOk(res, data)
}))

// ===== 业务员与客商选项 =====
router.get('/salesmen', requirePermission('transactions:view', 'view'), asyncHandler(async (req, res) => {
  const companyCodes = await normalizeCompanies(req.authUser as AuthUserContext, req.query.companyCode)
  const data = await CollectionService.listSalesmen({ companyCodes })
  sendOk(res, data)
}))

router.post('/salesmen', requirePermission('transactions:update', 'update'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const body = req.body ?? {}
  // 业务员归属单体公司：汇总主体归一化后取第一个成员（排序确定化，避免依赖 DB 返回顺序）
  const companyCodes = await normalizeCompanies(authUser, body.companyCode)
  const companyCode = [...(companyCodes ?? [])].sort()[0] ?? ''
  const data = await CollectionService.createSalesman({ companyCode, name: body.name, phone: body.phone, remark: body.remark }, { userId: authUser.userId, traceId: req.traceId })
  sendOk(res, data)
}))

router.get('/collections/counterparties', requirePermission('transactions:view', 'view'), asyncHandler(async (req, res) => {
  const companyCodes = await normalizeCompanies(req.authUser as AuthUserContext, req.query.companyCode)
  const data = await CollectionService.listCounterparties({ companyCodes, keyword: req.query.keyword ? String(req.query.keyword) : undefined })
  sendOk(res, data)
}))

// ===== 催收管理 =====
router.get('/collections', requirePermission('transactions:view', 'view'), asyncHandler(async (req, res) => {
  const q = req.query
  const data = await CollectionService.list({
    page: Number(q.page) || 1,
    pageSize: Number(q.pageSize) || 20,
    companyCodes: await normalizeCompanies(req.authUser as AuthUserContext, q.companyCode),
    status: q.status as string | undefined,
    counterpartyKeyword: q.counterpartyKeyword as string | undefined,
  })
  sendOk(res, data)
}))

router.post('/collections', requirePermission('transactions:create', 'create'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const data = await CollectionService.create(req.body ?? {}, { userId: authUser.userId, traceId: req.traceId })
  sendOk(res, data)
}))

// 从账龄数据批量生成催收建议
router.post('/collections/generate', requirePermission('transactions:create', 'create'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const data = await CollectionService.generateSuggestions({
    companyCodes: await normalizeCompanies(authUser, req.body?.companyCode),
    minAgingBucket: req.body?.minAgingBucket ? String(req.body.minAgingBucket) : undefined,
  }, { userId: authUser.userId, traceId: req.traceId })
  sendOk(res, data)
}))

router.patch('/collections/:id', requirePermission('transactions:update', 'update'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const data = await CollectionService.update(req.params.id as string, req.body ?? {}, { userId: authUser.userId, traceId: req.traceId })
  sendOk(res, data)
}))

router.get('/collections/:id/logs', requirePermission('transactions:view', 'view'), asyncHandler(async (req, res) => {
  const data = await CollectionService.listLogs(req.params.id as string)
  sendOk(res, data)
}))

router.post('/collections/:id/logs', requirePermission('transactions:update', 'update'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const data = await CollectionService.addLog(req.params.id as string, req.body ?? {}, { userId: authUser.userId, traceId: req.traceId })
  sendOk(res, data)
}))

export default router
