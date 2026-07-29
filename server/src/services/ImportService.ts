import { createHash } from 'node:crypto'
import * as XLSX from 'xlsx'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { parseImportWorkbook, emptySummary, type ImportTemplate, type Resolvers, type SampleRows, type PreviewSummary } from '../lib/excel-import'
import { parseTransactionWorkbook, type TransactionParseResult, type TransactionResolvers, type TransactionSheetInfo, type TransactionImportIssue, type TransactionParseSummary } from '../lib/transaction-import'
import { fyLabelOfDate } from '../lib/period'

/**
 * 数据导入服务：文件校验（MIME magic + 大小由 multer 保证）、解析计数、
 * 批次留痕与生命周期（draft→active，激活自动归档同类旧 active）。
 *
 * 说明：宽表→长表 unpivot 依赖 mapping_scheme.column_map 配置，作为后续增量；
 * 本期导入完成「真实文件解析 + 批次登记 + 生命周期管理」，不做占位/伪造。
 */

const XLSX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]) // PK.. (zip/xlsx)
const XLS_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) // 老式 xls 复合文档
const XML_MAGIC = Buffer.from('<?xml') // SpreadsheetML XML（ERP 导出的伪 .xls）

type TemplateType = 'operating' | 'static' | 'budget' | 'transaction' | 'inventory'

const UNPIVOT_TEMPLATES = new Set<TemplateType>(['operating', 'static', 'budget'])

async function buildResolvers(template: ImportTemplate, fiscalYear: string): Promise<Resolvers> {
  const companies = await prisma.company.findMany({ select: { code: true, name: true, shortName: true } })
  const subjectType = template === 'static' ? 'static' : 'operating'
  const subjects = await prisma.accountSubject.findMany({ where: { subjectType }, select: { code: true, name: true } })
  const companyByName = new Map<string, string>()
  for (const c of companies) {
    companyByName.set(c.name.trim(), c.code)
    if (c.shortName) companyByName.set(c.shortName.trim(), c.code)
  }
  return {
    companyByName,
    subjectByName: new Map(subjects.map((s) => [s.name.trim(), s.code])),
    defaultFiscalYear: fiscalYear,
  }
}

function assertExcelMagic(buf: Buffer): void {
  const head = buf.subarray(0, 4)
  if (head.equals(XLSX_MAGIC) || head.equals(XLS_MAGIC)) return
  // SpreadsheetML XML：跳过可能的 UTF-8 BOM 后比对 '<?xml' 前缀
  const bomOffset = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0
  if (buf.subarray(bomOffset, bomOffset + XML_MAGIC.length).equals(XML_MAGIC)) return
  throw errors.badRequest('文件格式非法：仅支持 .xlsx/.xls')
}

/** 往来导入解析辅助数据：公司编码集合 + 内部往来名称映射（name/shortName/legalEntity → code） */
async function buildTransactionResolvers(): Promise<TransactionResolvers> {
  const companies = await prisma.company.findMany({ select: { code: true, name: true, shortName: true, legalEntity: true } })
  const companyCodes = new Set<string>()
  const companyNameByCode = new Map<string, string>()
  const internalByName = new Map<string, string>()
  for (const c of companies) {
    companyCodes.add(c.code)
    companyNameByCode.set(c.code, c.name)
    internalByName.set(c.name.trim(), c.code)
    if (c.shortName) internalByName.set(c.shortName.trim(), c.code)
    if (c.legalEntity) internalByName.set(c.legalEntity.trim(), c.code)
  }
  return { companyCodes, companyNameByCode, internalByName }
}

export interface ImportErrorItem {
  row: number
  column: string
  message: string
}

/** 预览覆盖摘要（对外 DTO：剔除仅供服务层内部对比用的 periods/accountCodes） */
export type PreviewSummaryDto = Omit<PreviewSummary, 'periods' | 'accountCodes'>

/** 激活影响预告：按 activate 的按期间合并语义（budget 按财年）对比文件与当前生效批次的期间集合 */
export interface ActivationImpact {
  activeBatch: { id: string; filename: string } | null
  /** 文件有而生效批次无（激活后新增） */
  newPeriods: string[]
  /** 双方都有（激活后被本文件数据替换） */
  overlappingPeriods: string[]
  /** 生效批次有而文件无（按期间合并：激活后继续保留生效） */
  retainedPeriods: string[]
}

/** 看板 KPI 可见性检查：文件科目沿科目树上溯到根后覆盖的根类别 */
export interface KpiCoverage {
  covered: string[]
  missing: string[]
}

/** 与 DashboardService KPI 卡匹配逻辑对齐的四类根科目 */
const KPI_CATEGORIES = ['收入', '成本', '毛利', '费用']

function toSummaryDto(s: PreviewSummary): PreviewSummaryDto {
  const { periods: _periods, accountCodes: _accountCodes, ...dto } = s
  return dto
}

function ymOfDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** 查当前生效批次并对比期间集合（operating=period、static=快照月、budget=财年）；
 * 与 AggregationService 消费口径一致，汇总全部 active 批次的期间（正常不变量下同类型仅一个 active） */
async function computeActivationImpact(template: ImportTemplate, filePeriods: string[], fiscalYear: string): Promise<ActivationImpact> {
  const where =
    template === 'budget'
      ? { dataType: 'budget' as const, lifecycleStatus: 'active' as const, fiscalYear }
      : { dataType: template, lifecycleStatus: 'active' as const }
  const batches = await prisma.importBatch.findMany({ where, select: { id: true, fileName: true }, orderBy: { updatedAt: 'desc' } })
  if (batches.length === 0) {
    return { activeBatch: null, newPeriods: filePeriods, overlappingPeriods: [], retainedPeriods: [] }
  }
  const batchIds = batches.map((b) => b.id)
  let activePeriods: string[]
  if (template === 'operating') {
    const rows = await prisma.factOperating.findMany({ where: { batchId: { in: batchIds } }, distinct: ['period'], select: { period: true } })
    activePeriods = rows.map((r) => r.period)
  } else if (template === 'static') {
    const rows = await prisma.factStatic.findMany({ where: { batchId: { in: batchIds } }, distinct: ['snapshotDate'], select: { snapshotDate: true } })
    activePeriods = [...new Set(rows.map((r) => ymOfDate(r.snapshotDate)))]
  } else {
    const rows = await prisma.factBudget.findMany({ where: { batchId: { in: batchIds } }, distinct: ['fiscalYear'], select: { fiscalYear: true } })
    activePeriods = rows.map((r) => r.fiscalYear)
  }
  const fileSet = new Set(filePeriods)
  const activeSet = new Set(activePeriods)
  return {
    activeBatch: { id: batches[0].id, filename: batches[0].fileName },
    newPeriods: filePeriods.filter((p) => !activeSet.has(p)),
    overlappingPeriods: filePeriods.filter((p) => activeSet.has(p)),
    retainedPeriods: [...activeSet].filter((p) => !fileSet.has(p)).sort(),
  }
}

/** 文件科目沿 parentCode 上溯到根，检查四类看板 KPI 根科目是否均有数据落入 */
async function computeKpiCoverage(accountCodes: string[]): Promise<KpiCoverage> {
  if (accountCodes.length === 0) return { covered: [], missing: [...KPI_CATEGORIES] }
  const subjects = await prisma.accountSubject.findMany({
    where: { subjectType: 'operating' },
    select: { code: true, parentCode: true, category: true },
  })
  const byCode = new Map(subjects.map((s) => [s.code, s]))
  const rootCategories = new Set<string>()
  for (const code of accountCodes) {
    let cur = byCode.get(code)
    let depth = 0
    while (cur && cur.parentCode && depth < 20) {
      const parent = byCode.get(cur.parentCode)
      if (!parent) break
      cur = parent
      depth++
    }
    if (cur) rootCategories.add(cur.category)
  }
  return {
    covered: KPI_CATEGORIES.filter((c) => rootCategories.has(c)),
    missing: KPI_CATEGORIES.filter((c) => !rootCategories.has(c)),
  }
}

/** 往来汇总表导入预览（单文件） */
export interface TransactionActivationImpact {
  /** 当前无生效数据的新增组合 */
  newKeys: { companyCode: string; period: string; transactionType: string }[]
  /** 激活后将替换的已生效组合（含现有笔数） */
  overlappingKeys: { companyCode: string; period: string; transactionType: string; existingCount: number }[]
}

export interface TransactionPreviewDto {
  filename: string
  sheets: TransactionSheetInfo[]
  dataRowCount: number
  recordCount: number
  errorCount: number
  warningCount: number
  errors: TransactionImportIssue[]
  warnings: TransactionImportIssue[]
  summary: TransactionParseSummary
  activationImpact: TransactionActivationImpact
}

/** 多文件上传结果：单文件失败不影响其余 */
export interface TransactionUploadResult {
  filename: string
  batch: ImportBatchDto | null
  error: string | null
}

/** 解析错误映射为批次 errorsJson 的标准结构（column 携带 Sheet 名定位） */
function toIssueItems(issues: TransactionImportIssue[]): ImportErrorItem[] {
  return issues.map((e) => ({ row: e.row, column: `${e.sheet}!${e.column}`, message: e.message }))
}

/** 入库后同步客商主数据：新客商批量创建（已存在的不覆盖名称） */
async function syncCounterparties(tx: Prisma.TransactionClient, records: TransactionParseResult['records']): Promise<number> {
  const byCode = new Map<string, { code: string; name: string; companyCode: string; isInternal: boolean }>()
  for (const r of records) {
    if (!byCode.has(r.counterpartyCode)) {
      byCode.set(r.counterpartyCode, {
        code: r.counterpartyCode,
        name: r.counterpartyName ?? r.counterpartyCode,
        companyCode: r.companyCode,
        isInternal: r.isInternal,
      })
    }
  }
  if (byCode.size === 0) return 0
  const codes = [...byCode.keys()]
  const existing = await tx.counterparty.findMany({ where: { code: { in: codes } }, select: { code: true } })
  const existingSet = new Set(existing.map((e) => e.code))
  const toCreate = codes.filter((c) => !existingSet.has(c)).map((c) => byCode.get(c)!)
  if (toCreate.length === 0) return 0
  const res = await tx.counterparty.createMany({ data: toCreate, skipDuplicates: true })
  return res.count
}

export interface ImportBatchDto {
  id: string
  filename: string
  templateType: string
  status: string
  rowCount: number
  /** 入库明细数（unpivot 后的事实记录数；旧数据以解析行数近似） */
  detailCount: number
  successCount: number
  errorCount: number
  createdBy: string | null
  createdAt: string
  activatedAt?: string
  /** 解析错误明细（仅详情接口返回；列表接口为空数组以控制体积） */
  errors?: ImportErrorItem[]
}

function toDto(b: {
  id: string; fileName: string; dataType: string; lifecycleStatus: string; status: string
  rowCount: number; detailCount: number; errorCount: number; uploadedById: string | null; createdAt: Date; updatedAt: Date
  errorsJson?: unknown
}, includeErrors = false): ImportBatchDto {
  const dto: ImportBatchDto = {
    id: b.id,
    filename: b.fileName,
    templateType: b.dataType,
    status: b.lifecycleStatus,
    rowCount: b.rowCount,
    detailCount: b.detailCount || b.rowCount,
    successCount: Math.max(b.rowCount - b.errorCount, 0),
    errorCount: b.errorCount,
    createdBy: b.uploadedById,
    createdAt: b.createdAt.toISOString(),
    activatedAt: b.lifecycleStatus === 'active' ? b.updatedAt.toISOString() : undefined,
  }
  if (includeErrors) {
    dto.errors = Array.isArray(b.errorsJson) ? (b.errorsJson as ImportErrorItem[]) : []
  }
  return dto
}

export const ImportService = {
  /**
   * 导入预览（dry-run）：仅解析不建批次、不写库，返回将入库行数/各类计数/错误明细，
   * 及覆盖摘要、激活影响预告与看板 KPI 覆盖检查，供管理员入库前确认数据质量。
   */
  async preview(file: { buffer: Buffer }, templateType: TemplateType, fiscalYear = fyLabelOfDate(new Date())): Promise<{ dataRowCount: number; errorCount: number; operatingCount: number; staticCount: number; budgetCount: number; errors: ImportErrorItem[]; sampleRows: SampleRows; summary: PreviewSummaryDto; activationImpact: ActivationImpact | null; kpiCoverage: KpiCoverage | null }> {
    assertExcelMagic(file.buffer)
    if (!UNPIVOT_TEMPLATES.has(templateType)) {
      if (templateType === 'transaction') {
        // 往来汇总表：真实解析并映射为通用预览结构（专用结构见 previewTransaction）
        const resolvers = await buildTransactionResolvers()
        const parsed = parseTransactionWorkbook(file.buffer, 'preview.xls', resolvers)
        const accountCodes = new Set(parsed.records.map((r) => r.accountCode))
        const zeroValueCount = parsed.records.filter((r) => r.closingBalance === 0).length
        const sampleRows: SampleRows = {
          headers: ['往来类型', '客商', '科目', '期间', '期末余额'],
          rows: parsed.records.slice(0, 20).map((r) => [r.transactionType, r.counterpartyName ?? r.counterpartyCode, r.accountDesc ?? r.accountCode, r.period, r.closingBalance]),
        }
        const summary: PreviewSummary = {
          companyCount: parsed.summary.companies.length,
          subjectCount: accountCodes.size,
          periodRange: { min: parsed.summary.periods[0] ?? null, max: parsed.summary.periods[parsed.summary.periods.length - 1] ?? null },
          periods: parsed.summary.periods,
          totalValue: parsed.summary.totalClosingBalance,
          zeroValueCount,
          duplicateCount: parsed.summary.duplicateCount,
          duplicateSamples: parsed.summary.duplicateSamples,
          accountCodes: [...accountCodes],
        }
        return { dataRowCount: parsed.dataRowCount, errorCount: parsed.errors.length, operatingCount: 0, staticCount: 0, budgetCount: 0, errors: toIssueItems(parsed.errors).slice(0, 200), sampleRows, summary: toSummaryDto(summary), activationImpact: null, kpiCoverage: null }
      }
      // inventory：仅统计数据行数
      let rowCount = 0
      try {
        const wb = XLSX.read(file.buffer, { type: 'buffer' })
        const first = wb.SheetNames[0]
        const gridRows = first ? (XLSX.utils.sheet_to_json(wb.Sheets[first], { header: 1, blankrows: false }) as unknown[][]) : []
        rowCount = Math.max(gridRows.length - 1, 0)
      } catch {
        throw errors.badRequest('Excel 解析失败，请检查文件内容与模板类型')
      }
      return { dataRowCount: rowCount, errorCount: 0, operatingCount: 0, staticCount: 0, budgetCount: 0, errors: [], sampleRows: { headers: [], rows: [] }, summary: toSummaryDto(emptySummary()), activationImpact: null, kpiCoverage: null }
    }
    const template = templateType as ImportTemplate
    let parsed
    try {
      const resolvers = await buildResolvers(template, fiscalYear)
      parsed = parseImportWorkbook(file.buffer, template, resolvers)
    } catch {
      throw errors.badRequest('Excel 解析失败，请检查文件内容与模板类型')
    }
    const activationImpact = await computeActivationImpact(template, parsed.summary.periods, fiscalYear)
    const kpiCoverage = template === 'operating' ? await computeKpiCoverage(parsed.summary.accountCodes) : null
    return {
      dataRowCount: parsed.dataRowCount,
      errorCount: parsed.errors.length,
      operatingCount: parsed.operating.length,
      staticCount: parsed.static.length,
      budgetCount: parsed.budget.length,
      errors: parsed.errors.slice(0, 200),
      sampleRows: parsed.sampleRows,
      summary: toSummaryDto(parsed.summary),
      activationImpact,
      kpiCoverage,
    }
  },

  /**
   * 往来汇总表导入预览（dry-run，多文件）：仅解析不建批次、不写库；
   * 附激活影响预告：解析出的 (公司,期间,类型) 与当前生效数据对比（overlapping = 激活后被替换）。
   */
  async previewTransactions(files: Array<{ originalname: string; buffer: Buffer }>): Promise<TransactionPreviewDto[]> {
    const resolvers = await buildTransactionResolvers()
    const emptyImpact = (): TransactionActivationImpact => ({ newKeys: [], overlappingKeys: [] })
    const parsedList = files.map((file) => {
      let parsed: TransactionParseResult | null = null
      let fatal: string | null = null
      try {
        assertExcelMagic(file.buffer)
        parsed = parseTransactionWorkbook(file.buffer, file.originalname, resolvers)
      } catch (e) {
        fatal = e instanceof Error ? e.message : '文件解析失败'
      }
      return { file, parsed, fatal }
    })

    // 全部文件三元组并集，一次查询现有生效笔数
    const tripleKeys = new Set<string>()
    for (const p of parsedList) {
      for (const r of p.parsed?.records ?? []) tripleKeys.add(`${r.companyCode}|${r.period}|${r.transactionType}`)
    }
    const existingCount = new Map<string, number>()
    if (tripleKeys.size > 0) {
      const activeBatches = await prisma.importBatch.findMany({ where: { dataType: 'transaction', lifecycleStatus: 'active' }, select: { id: true } })
      if (activeBatches.length > 0) {
        const triples = [...tripleKeys].map((k) => {
          const [companyCode, period, transactionType] = k.split('|')
          return { companyCode, period, transactionType }
        })
        const rows = await prisma.transactionDetail.groupBy({
          by: ['companyCode', 'period', 'transactionType'],
          where: { batchId: { in: activeBatches.map((b) => b.id) }, OR: triples },
          _count: { id: true },
        })
        for (const r of rows) {
          if (r.period) existingCount.set(`${r.companyCode}|${r.period}|${r.transactionType}`, r._count.id)
        }
      }
    }

    return parsedList.map(({ file, parsed, fatal }) => {
      if (!parsed) {
        return {
          filename: file.originalname, sheets: [], dataRowCount: 0, recordCount: 0, errorCount: 1, warningCount: 0,
          errors: [{ sheet: '-', row: 0, column: '-', message: fatal ?? '文件解析失败' }], warnings: [],
          summary: { typeCounts: {}, companies: [], periods: [], totalClosingBalance: 0, duplicateCount: 0, duplicateSamples: [], counterpartyCount: 0, internalCount: 0 },
          activationImpact: emptyImpact(),
        }
      }
      const fileKeys = new Set<string>()
      for (const r of parsed.records) fileKeys.add(`${r.companyCode}|${r.period}|${r.transactionType}`)
      const impact = emptyImpact()
      for (const k of [...fileKeys].sort()) {
        const [companyCode, period, transactionType] = k.split('|')
        const existing = existingCount.get(k)
        if (existing) impact.overlappingKeys.push({ companyCode, period, transactionType, existingCount: existing })
        else impact.newKeys.push({ companyCode, period, transactionType })
      }
      return {
        filename: file.originalname,
        sheets: parsed.sheets,
        dataRowCount: parsed.dataRowCount,
        recordCount: parsed.records.length,
        errorCount: parsed.errors.length,
        warningCount: parsed.warnings.length,
        errors: parsed.errors.slice(0, 50),
        warnings: parsed.warnings.slice(0, 50),
        summary: parsed.summary,
        activationImpact: impact,
      }
    })
  },

  /**
   * 往来汇总表多文件上传：每文件独立批次，单文件失败不影响其余。
   */
  async uploadTransactions(files: Array<{ originalname: string; buffer: Buffer; size: number }>, userId: string, traceId?: string): Promise<TransactionUploadResult[]> {
    const results: TransactionUploadResult[] = []
    for (const file of files) {
      try {
        const batch = await this.uploadTransactionOne(file, userId, traceId)
        results.push({ filename: file.originalname, batch, error: null })
      } catch (e) {
        results.push({ filename: file.originalname, batch: null, error: e instanceof Error ? e.message : '导入失败' })
      }
    }
    return results
  },

  /**
   * 往来汇总表单文件入库：解析 → transaction_detail 分块写入 + 客商同步（同事务）。
   * 批次创建为 draft，需激活后生效（激活时按 公司×期间×往来类型 合并替换）。
   */
  async uploadTransactionOne(file: { originalname: string; buffer: Buffer; size: number }, userId: string, traceId?: string): Promise<ImportBatchDto> {
    assertExcelMagic(file.buffer)

    const fileHash = createHash('sha256').update(file.buffer).digest('hex')
    const dup = await prisma.importBatch.findFirst({ where: { fileHash, lifecycleStatus: 'active' }, select: { id: true } })
    if (dup) throw errors.conflict('该文件已导入并处于生效状态，请勿重复导入')

    const batch = await prisma.importBatch.create({
      data: {
        fileName: file.originalname,
        uploadedById: userId,
        status: 'processing',
        dataType: 'transaction',
        lifecycleStatus: 'draft',
        fileHash,
        sourceType: 'upload',
      },
    })

    let parsed: TransactionParseResult
    try {
      const resolvers = await buildTransactionResolvers()
      parsed = parseTransactionWorkbook(file.buffer, file.originalname, resolvers)
    } catch {
      await prisma.importBatch.update({ where: { id: batch.id }, data: { status: 'failed' } })
      throw errors.badRequest('Excel 解析失败，请检查文件内容与模板类型')
    }

    const errorList = toIssueItems(parsed.errors)
    const errorCount = parsed.errors.length
    // 申报覆盖范围：每个汇总 Sheet 的 (公司, 期间, 类型, 笔数)，含 0 条的空 Sheet，
    // 供覆盖矩阵区分“已导入·该期确无往来款”与“缺失”
    const declaredCoverage = parsed.sheets
      .filter((s) => s.declaredCompanyCode && s.cutoffDate)
      .map((s) => ({ companyCode: s.declaredCompanyCode!, period: s.cutoffDate!.slice(0, 7), transactionType: s.transactionType, recordCount: s.recordCount }))

    const updated = await prisma.$transaction(async (tx) => {
      let insertedCount = 0
      const BATCH_SIZE = 500
      for (let i = 0; i < parsed.records.length; i += BATCH_SIZE) {
        const chunk = parsed.records.slice(i, i + BATCH_SIZE).map((r) => {
          const { rawJson, ...rest } = r
          return { ...rest, batchId: batch.id, rawJson: rawJson as never }
        })
        const res = await tx.transactionDetail.createMany({ data: chunk, skipDuplicates: true })
        insertedCount += res.count
      }
      await syncCounterparties(tx, parsed.records)
      const finalStatus = errorCount > 0 ? (insertedCount > 0 ? 'partial' : 'failed') : 'success'
      return tx.importBatch.update({
        where: { id: batch.id },
        data: {
          status: parsed.records.length === 0 && errorCount > 0 ? 'failed' : finalStatus,
          rowCount: parsed.dataRowCount,
          detailCount: parsed.records.length,
          errorCount,
          errorsJson: (errorList.slice(0, 200) as never) ?? undefined,
          coverageJson: declaredCoverage as never,
        },
      })
    })
    await recordAudit({ userId, module: 'transactions', action: 'import', targetId: batch.id, detail: { rowCount: parsed.dataRowCount, detailCount: parsed.records.length, errorCount } }, traceId)
    return toDto(updated)
  },

  async upload(file: { originalname: string; buffer: Buffer; size: number }, templateType: TemplateType, userId: string, traceId?: string, fiscalYear = fyLabelOfDate(new Date())): Promise<ImportBatchDto> {
    if (templateType === 'transaction') {
      // 往来汇总表走专用解析入库链路（通用入口与 /transactions/import 行为一致）
      return this.uploadTransactionOne(file, userId, traceId)
    }
    assertExcelMagic(file.buffer)

    // 文件去重：同 hash 且 active 的批次
    const fileHash = createHash('sha256').update(file.buffer).digest('hex')
    const dup = await prisma.importBatch.findFirst({ where: { fileHash, lifecycleStatus: 'active' }, select: { id: true } })
    if (dup) {
      throw errors.conflict('该文件已导入并处于生效状态，请勿重复导入')
    }

    // 先建批次（草稿/处理中）
    const batch = await prisma.importBatch.create({
      data: {
        fileName: file.originalname,
        uploadedById: userId,
        status: 'processing',
        dataType: templateType,
        lifecycleStatus: 'draft',
        fileHash,
        sourceType: 'upload',
        fiscalYear,
      },
    })

    let rowCount = 0
    let detailCount = 0
    let errorCount = 0
    let errorList: { row: number; column: string; message: string }[] = []
    let parsedOperating: ReturnType<typeof parseImportWorkbook>['operating'] = []
    let parsedStatic: ReturnType<typeof parseImportWorkbook>['static'] = []
    let parsedBudget: ReturnType<typeof parseImportWorkbook>['budget'] = []

    // 解析阶段（CPU 密集，不涉及 DB）
    try {
      if (UNPIVOT_TEMPLATES.has(templateType)) {
        const template = templateType as ImportTemplate
        const resolvers = await buildResolvers(template, fiscalYear)
        const parsed = parseImportWorkbook(file.buffer, template, resolvers)
        rowCount = parsed.dataRowCount
        detailCount = parsed.operating.length + parsed.static.length + parsed.budget.length
        errorList = parsed.errors
        errorCount = parsed.errors.length
        parsedOperating = parsed.operating
        parsedStatic = parsed.static
        parsedBudget = parsed.budget
      } else {
        // transaction/inventory 暂仅登记：统计数据行数（transaction 已在上方分流，此处仅剩 inventory）
        const wb = XLSX.read(file.buffer, { type: 'buffer' })
        const first = wb.SheetNames[0]
        const gridRows = first ? (XLSX.utils.sheet_to_json(wb.Sheets[first], { header: 1, blankrows: false }) as unknown[][]) : []
        rowCount = Math.max(gridRows.length - 1, 0)
        detailCount = rowCount
      }
    } catch {
      await prisma.importBatch.update({ where: { id: batch.id }, data: { status: 'failed' } })
      throw errors.badRequest('Excel 解析失败，请检查文件内容与模板类型')
    }

    // 写入阶段：事务保证数据插入与批次状态更新的原子性
    const updated = await prisma.$transaction(async (tx) => {
      let insertedCount = 0
      if (parsedOperating.length > 0) {
        const res = await tx.factOperating.createMany({ data: parsedOperating.map((r) => ({ ...r, batchId: batch.id })), skipDuplicates: true })
        insertedCount += res.count
      }
      if (parsedStatic.length > 0) {
        const res = await tx.factStatic.createMany({ data: parsedStatic.map((r) => ({ ...r, batchId: batch.id })), skipDuplicates: true })
        insertedCount += res.count
      }
      if (parsedBudget.length > 0) {
        const res = await tx.factBudget.createMany({ data: parsedBudget.map((r) => ({ ...r, batchId: batch.id })), skipDuplicates: true })
        insertedCount += res.count
      }
      // 结算批次状态：有错且无有效数据→failed；有错但部分入库→partial；无错→success
      const finalStatus = errorCount > 0 ? (insertedCount > 0 ? 'partial' : 'failed') : 'success'
      return tx.importBatch.update({
        where: { id: batch.id },
        data: {
          status: finalStatus,
          rowCount,
          detailCount,
          errorCount,
          errorsJson: (errorList.slice(0, 200) as never) ?? undefined,
        },
      })
    })
    await recordAudit({ userId, module: 'data', action: 'import', targetId: batch.id, detail: { templateType, rowCount, errorCount } }, traceId)
    return toDto(updated)
  },

  async list(params: { page: number; pageSize: number; templateType?: string }): Promise<{ items: ImportBatchDto[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const where = params.templateType ? { dataType: params.templateType as TemplateType } : {}
    const [rows, total] = await Promise.all([
      prisma.importBatch.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
      prisma.importBatch.count({ where }),
    ])
    return {
      items: rows.map((r) => toDto(r)),
      total,
      page: params.page,
      pageSize: params.pageSize,
      totalPages: Math.ceil(total / params.pageSize),
    }
  },

  async getById(id: string): Promise<ImportBatchDto> {
    const b = await prisma.importBatch.findUnique({ where: { id } })
    if (!b) throw errors.notFound('导入批次不存在')
    return toDto(b, true)
  },

  /**
   * 激活批次：置 active。期间策略：
   * - operating/static 按期间合并：删除旧 active 批次中与本批次重叠期间的事实行（operating 按 period、static 按快照月），
   *   旧批次清空后自动归档，否则保持 active（多批次按期间共存）；
   * - transaction 按 (公司, 期间, 往来类型) 合并：删除旧 active 批次中与本批次三元组重叠的明细，旧批次清空后自动归档；
   * - budget 按财年整体替换：归档同 dataType 且同 fiscalYear 的旧 active；
   * - inventory 维持整体替换。
   */
  async activate(id: string, userId: string, traceId?: string): Promise<ImportBatchDto> {
    const b = await prisma.importBatch.findUnique({ where: { id } })
    if (!b) throw errors.notFound('导入批次不存在')
    if (b.lifecycleStatus === 'active') return toDto(b)

    const { updated, replacedPeriods, deletedRows } = await prisma.$transaction(async (tx) => {
      let replaced: string[] = []
      let deleted = 0
      if (b.dataType === 'operating' || b.dataType === 'static') {
        const oldActive = await tx.importBatch.findMany({
          where: { dataType: b.dataType, lifecycleStatus: 'active' },
          select: { id: true },
        })
        const oldIds = oldActive.map((x) => x.id)
        if (oldIds.length > 0) {
          if (b.dataType === 'operating') {
            const rows = await tx.factOperating.findMany({ where: { batchId: id }, distinct: ['period'], select: { period: true } })
            const newPeriods = rows.map((r) => r.period)
            if (newPeriods.length > 0) {
              const res = await tx.factOperating.deleteMany({ where: { batchId: { in: oldIds }, period: { in: newPeriods } } })
              deleted = res.count
              replaced = newPeriods.sort()
            }
            for (const oldId of oldIds) {
              const remaining = await tx.factOperating.count({ where: { batchId: oldId } })
              if (remaining === 0) await tx.importBatch.update({ where: { id: oldId }, data: { lifecycleStatus: 'archived' } })
            }
          } else {
            const snaps = await tx.factStatic.findMany({ where: { batchId: id }, distinct: ['snapshotDate'], select: { snapshotDate: true } })
            const newMonths = new Set(snaps.map((s) => ymOfDate(s.snapshotDate)))
            if (newMonths.size > 0) {
              const oldSnaps = await tx.factStatic.findMany({ where: { batchId: { in: oldIds } }, distinct: ['snapshotDate'], select: { snapshotDate: true } })
              const delDates = oldSnaps.map((s) => s.snapshotDate).filter((d) => newMonths.has(ymOfDate(d)))
              if (delDates.length > 0) {
                const res = await tx.factStatic.deleteMany({ where: { batchId: { in: oldIds }, snapshotDate: { in: delDates } } })
                deleted = res.count
              }
              replaced = [...newMonths].sort()
            }
            for (const oldId of oldIds) {
              const remaining = await tx.factStatic.count({ where: { batchId: oldId } })
              if (remaining === 0) await tx.importBatch.update({ where: { id: oldId }, data: { lifecycleStatus: 'archived' } })
            }
          }
        }
      } else if (b.dataType === 'transaction') {
        // 按 (公司, 期间, 往来类型) 三元组合并替换
        const oldActive = await tx.importBatch.findMany({
          where: { dataType: 'transaction', lifecycleStatus: 'active' },
          select: { id: true },
        })
        const oldIds = oldActive.map((x) => x.id)
        if (oldIds.length > 0) {
          const keys = await tx.transactionDetail.findMany({
            where: { batchId: id },
            distinct: ['companyCode', 'period', 'transactionType'],
            select: { companyCode: true, period: true, transactionType: true },
          })
          if (keys.length > 0) {
            const res = await tx.transactionDetail.deleteMany({
              where: {
                batchId: { in: oldIds },
                OR: keys.map((k) => ({ companyCode: k.companyCode, period: k.period, transactionType: k.transactionType })),
              },
            })
            deleted = res.count
            replaced = keys.map((k) => `${k.companyCode}|${k.period ?? '-'}|${k.transactionType}`).sort()
          }
          for (const oldId of oldIds) {
            const remaining = await tx.transactionDetail.count({ where: { batchId: oldId } })
            if (remaining === 0) await tx.importBatch.update({ where: { id: oldId }, data: { lifecycleStatus: 'archived' } })
          }
        }
      } else {
        // budget 按财年隔离；其余类型整体替换
        const archiveWhere =
          b.dataType === 'budget'
            ? { dataType: b.dataType, lifecycleStatus: 'active' as const, fiscalYear: b.fiscalYear }
            : { dataType: b.dataType, lifecycleStatus: 'active' as const }
        await tx.importBatch.updateMany({
          where: archiveWhere,
          data: { lifecycleStatus: 'archived' },
        })
      }
      const batch = await tx.importBatch.update({
        where: { id },
        data: { lifecycleStatus: 'active', status: 'success' },
      })
      return { updated: batch, replacedPeriods: replaced, deletedRows: deleted }
    })
    await recordAudit({ userId, module: 'data', action: 'update', targetId: id, detail: { action: 'activate', replacedPeriods, deletedRows } }, traceId)
    return toDto(updated)
  },

  /** 手动归档批次（高危，仅 superadmin）：置 archived，已归档则幂等返回 */
  async archive(id: string, userId: string, traceId?: string): Promise<ImportBatchDto> {
    const b = await prisma.importBatch.findUnique({ where: { id } })
    if (!b) throw errors.notFound('导入批次不存在')
    if (b.lifecycleStatus === 'archived') return toDto(b)
    if (b.lifecycleStatus === 'purged') throw errors.conflict('已清除的批次不可归档')
    const updated = await prisma.importBatch.update({ where: { id }, data: { lifecycleStatus: 'archived' } })
    await recordAudit({ userId, module: 'data', action: 'update', targetId: id, detail: { action: 'archive' } }, traceId)
    return toDto(updated)
  },

  /**
   * 清除批次数据（高危，仅 superadmin）：物理删除该批次的全部事实明细，
   * 批次记录保留并置 lifecycleStatus='purged' 留痕。生效中（active）批次拒绝。
   */
  async purge(id: string, userId: string, traceId?: string): Promise<ImportBatchDto> {
    const b = await prisma.importBatch.findUnique({ where: { id } })
    if (!b) throw errors.notFound('导入批次不存在')
    if (b.lifecycleStatus === 'purged') return toDto(b)
    if (b.lifecycleStatus === 'active') throw errors.conflict('生效中批次不可清除，请先归档')
    const { updated, deletedRows } = await prisma.$transaction(async (tx) => {
      const [op, st, bg, txn, inv] = await Promise.all([
        tx.factOperating.deleteMany({ where: { batchId: id } }),
        tx.factStatic.deleteMany({ where: { batchId: id } }),
        tx.factBudget.deleteMany({ where: { batchId: id } }),
        tx.transactionDetail.deleteMany({ where: { batchId: id } }),
        tx.inventoryRecord.deleteMany({ where: { batchId: id } }),
      ])
      const batch = await tx.importBatch.update({ where: { id }, data: { lifecycleStatus: 'purged' } })
      return { updated: batch, deletedRows: op.count + st.count + bg.count + txn.count + inv.count }
    })
    await recordAudit({ userId, module: 'data', action: 'delete', targetId: id, detail: { action: 'purge', deletedRows } }, traceId)
    return toDto(updated)
  },
}
