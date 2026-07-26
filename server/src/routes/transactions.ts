import { Router } from 'express'
import multer from 'multer'
import { authenticate } from '../middleware/auth'
import { requirePermission } from '../middleware/permission'
import { asyncHandler } from '../lib/async-handler'
import { sendOk } from '../lib/response'
import { errors } from '../lib/errors'
import { TransactionService } from '../services/TransactionService'
import { ImportService } from '../services/ImportService'
import { fixUploadFilename } from '../lib/sanitize'
import type { AuthUserContext } from '../types/express'

/**
 * 往来分析路由（/api/v1/transactions）。
 * 权限：查看 transactions:view；导入 transactions:import。
 */
const router = Router()

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

router.use(authenticate)

// ===== 总览 =====
router.get('/overview', requirePermission('transactions', 'view'), asyncHandler(async (req, res) => {
  const companyCode = req.query.companyCode as string | undefined
  const data = await TransactionService.getOverview(companyCode)
  sendOk(res, data)
}))

// ===== 明细列表 =====
router.get('/details', requirePermission('transactions', 'view'), asyncHandler(async (req, res) => {
  const q = req.query
  const data = await TransactionService.listDetails({
    page: Number(q.page) || 1,
    pageSize: Number(q.pageSize) || 20,
    companyCode: q.companyCode as string | undefined,
    transactionType: q.transactionType as string | undefined,
    direction: q.direction as string | undefined,
    counterpartyKeyword: q.counterpartyKeyword as string | undefined,
    isInternal: q.isInternal !== undefined ? q.isInternal === 'true' : undefined,
    internalType: q.internalType as string | undefined,
    isSettled: q.isSettled !== undefined ? q.isSettled === 'true' : undefined,
    minAmount: q.minAmount ? Number(q.minAmount) : undefined,
    maxAmount: q.maxAmount ? Number(q.maxAmount) : undefined,
  })
  sendOk(res, data)
}))

// ===== 账龄分析 =====
router.get('/aging', requirePermission('transactions', 'view'), asyncHandler(async (req, res) => {
  const q = req.query
  const data = await TransactionService.getAgingAnalysis({
    companyCode: q.companyCode as string | undefined,
    transactionType: q.transactionType as string | undefined,
    groupBy: (q.groupBy as 'type' | 'counterparty' | 'account') || 'type',
  })
  sendOk(res, data)
}))

// ===== 内部往来汇总 =====
router.get('/internal/summary', requirePermission('transactions', 'view'), asyncHandler(async (req, res) => {
  const companyCode = req.query.companyCode as string | undefined
  const data = await TransactionService.getInternalSummary(companyCode)
  sendOk(res, data)
}))

// ===== 内部往来镜像校验 =====
router.get('/internal/mirror-check', requirePermission('transactions', 'view'), asyncHandler(async (req, res) => {
  const companyCode = req.query.companyCode as string | undefined
  const data = await TransactionService.getInternalMirrorCheck(companyCode)
  sendOk(res, data)
}))

// ===== 往来对象列表（筛选用） =====
router.get('/counterparties', requirePermission('transactions', 'view'), asyncHandler(async (req, res) => {
  const companyCode = req.query.companyCode as string | undefined
  const data = await TransactionService.listCounterparties(companyCode)
  sendOk(res, data)
}))

// ===== 最新截止日期 =====
router.get('/latest-cutoff', requirePermission('transactions', 'view'), asyncHandler(async (_req, res) => {
  const data = await TransactionService.getLatestCutoff()
  sendOk(res, { cutoffDate: data })
}))

// ===== 导入往来数据 =====
router.post('/import', requirePermission('transactions', 'import'), upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw errors.badRequest('缺少上传文件')
  const originalname = fixUploadFilename(req.file.originalname)
  if (!/\.(xlsx|xls)$/i.test(originalname)) throw errors.badRequest('仅支持 .xlsx/.xls 文件')

  const authUser = req.authUser as AuthUserContext
  const dto = await ImportService.upload(
    { originalname, buffer: req.file.buffer, size: req.file.size },
    'transaction',
    authUser.userId,
    req.traceId,
    req.body?.fiscalYear ? String(req.body.fiscalYear) : undefined,
  )
  sendOk(res, dto)
}))

export default router
