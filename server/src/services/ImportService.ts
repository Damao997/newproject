import { createHash } from 'node:crypto'
import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'
import type { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { parseImportWorkbook, emptySummary, type ImportTemplate, type Resolvers, type SampleRows, type PreviewSummary, type ValueUnit } from '../lib/excel-import'
import { parseTransactionWorkbook, type TransactionParseResult, type TransactionResolvers, type TransactionSheetInfo, type TransactionImportIssue, type TransactionParseSummary } from '../lib/transaction-import'
import { fyLabelOfDate, parsePeriod, formatPeriod } from '../lib/period'
import { assertCompaniesInScope, effectiveScope } from '../lib/scope-guard'
import { latestOperatingPeriod, latestStaticPeriod } from './IndicatorsService'

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

/** 从批次 coverageJson 提取申报覆盖的公司编码（无申报信息返回空数组） */
function declaredCoverageCompanies(coverageJson: unknown): string[] {
  if (!Array.isArray(coverageJson)) return []
  const codes = new Set<string>()
  for (const item of coverageJson) {
    const code = (item as { companyCode?: unknown })?.companyCode
    if (typeof code === 'string' && code) codes.add(code)
  }
  return [...codes]
}

/** 批次 coverageJson 申报项结构（导入时由汇总 Sheet 产出，含 0 条的空 Sheet） */
interface DeclaredCoverageItem {
  companyCode: string
  period: string
  transactionType: string
  recordCount: number
}

/** 解析批次 coverageJson 申报项（无申报信息返回空数组） */
function parseDeclaredCoverage(coverageJson: unknown): DeclaredCoverageItem[] {
  if (!Array.isArray(coverageJson)) return []
  return coverageJson.filter((x): x is DeclaredCoverageItem =>
    !!x && typeof x === 'object' && typeof (x as DeclaredCoverageItem).companyCode === 'string'
    && typeof (x as DeclaredCoverageItem).period === 'string'
    && typeof (x as DeclaredCoverageItem).transactionType === 'string')
}

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

/**
 * 预算导入口径告警：聚合层对预算行的消费规则是「仅无子节点的数据类科目生效」，
 * 计算类科目由公式层重算（毛利=收入-成本）、父级科目被子级求和覆盖，导入值均被忽略；
 * 毛利类数据类叶子的预算只能来自直接导入，缺行即恒为 0。导入前显式提示，避免静默丢失。
 */
export interface BudgetWarnings {
  /** 文件含行的计算类科目：聚合时由公式层重算，导入值被忽略 */
  recalcSubjects: string[]
  /** 文件含行的父级科目：聚合时为子级求和，导入值被忽略 */
  parentSubjects: string[]
  /** 毛利类数据类叶子中文件未包含行者：其预算金额将为 0 */
  missingProfitLeaves: string[]
}

/** 依据文件科目编码集合产出预算口径告警（无告警返回 null） */
async function computeBudgetWarnings(accountCodes: string[]): Promise<BudgetWarnings | null> {
  if (accountCodes.length === 0) return null
  const subjects = await prisma.accountSubject.findMany({
    where: { subjectType: 'operating' },
    select: { code: true, name: true, category: true, isLeaf: true },
  })
  const fileCodes = new Set(accountCodes)
  // 毛利数据类叶子的 dataType 也需可查（它们通常不在文件内），故并集后一次查询
  const profitLeafCodes = subjects.filter((s) => s.category === '毛利' && s.isLeaf).map((s) => s.code)
  const metrics = await prisma.metric.findMany({
    where: { code: { in: [...fileCodes, ...profitLeafCodes] } },
    select: { code: true, dataType: true },
  })
  const dtByCode = new Map(metrics.map((m) => [m.code, m.dataType]))
  const byCode = new Map(subjects.map((s) => [s.code, s]))
  const recalcSubjects: string[] = []
  const parentSubjects: string[] = []
  for (const code of accountCodes) {
    const s = byCode.get(code)
    if (!s) continue
    if (dtByCode.get(code) === 'calc') recalcSubjects.push(s.name)
    else if (!s.isLeaf) parentSubjects.push(s.name)
  }
  const missingProfitLeaves = subjects
    .filter((s) => s.category === '毛利' && s.isLeaf && dtByCode.get(s.code) !== 'calc' && !fileCodes.has(s.code))
    .map((s) => s.name)
  if (recalcSubjects.length === 0 && parentSubjects.length === 0 && missingProfitLeaves.length === 0) return null
  return { recalcSubjects, parentSubjects, missingProfitLeaves }
}

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
  const byCode = new Map<string, { code: string; name: string; companyCode: string; isInternal: boolean; partyType: string }>()
  for (const r of records) {
    if (!byCode.has(r.counterpartyCode)) {
      byCode.set(r.counterpartyCode, {
        code: r.counterpartyCode,
        name: r.counterpartyName ?? r.counterpartyCode,
        companyCode: r.companyCode,
        isInternal: r.isInternal,
        partyType: r.partyType,
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

/** 激活冲突项：transaction 为 (公司, 期间, 往来类型) 三元组；operating/static 为期间；budget/inventory 为整体替换文案 */
export interface ActivateConflict {
  companyCode?: string
  period?: string
  transactionType?: string
  /** 已生效数据中的现有笔数（transaction 类型） */
  existingCount?: number
  /** 整体替换场景的展示文案（budget 财年 / inventory 存货数据） */
  label?: string
}

/** 批量激活预检结果：单批次激活后将替换的已生效组合 */
export interface BatchActivateCheckItem {
  id: string
  filename: string
  /** draft=可激活；active/archived/purged=不可激活（skipped）；不存在时为空字符串 */
  status: string
  conflictCount: number
  conflicts: ActivateConflict[]
  /** 选中批次之间互相重叠的三元组数（激活顺序靠后的覆盖靠前的） */
  crossBatchConflictCount: number
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
   * 生成导入模板（转置宽表，与 parseImportWorkbook 转置布局解析对齐）：
   * 科目行自动取自科目体系的数据类（data）指标，按树前序排列并随层级缩进；
   * 公司列为全部 active 单体公司；期间列取最新生效期间及其前一月（budget 无月份行）。
   */
  async getTemplate(type: ImportTemplate): Promise<Buffer> {
    // 1) 数据类指标：account_subject 无 dataType 字段，经 metric（code 与科目一一对应）关联筛选
    const subjectType = type === 'static' ? 'static' : 'operating'
    const subjects = await prisma.accountSubject.findMany({
      where: { subjectType, status: 'active' },
      orderBy: { orderNo: 'asc' },
      select: { code: true, name: true, level: true, parentCode: true },
    })
    const metrics = await prisma.metric.findMany({
      where: { code: { in: subjects.map((s) => s.code) }, status: 'active' },
      select: { code: true, dataType: true },
    })
    const dtMap = new Map(metrics.map((m) => [m.code, m.dataType]))
    const dataSubjects = subjects.filter((s) => dtMap.get(s.code) === 'data')

    // 2) 树前序排序（父在前、子紧随其后，与交叉表行序一致）
    const byCode = new Map(dataSubjects.map((s) => [s.code, s]))
    const childrenMap = new Map<string, string[]>()
    const roots: string[] = []
    for (const s of dataSubjects) {
      if (s.parentCode && byCode.has(s.parentCode)) {
        const list = childrenMap.get(s.parentCode) ?? []
        list.push(s.code)
        childrenMap.set(s.parentCode, list)
      } else {
        roots.push(s.code)
      }
    }
    const ordered: typeof dataSubjects = []
    const walk = (code: string): void => {
      ordered.push(byCode.get(code) as (typeof dataSubjects)[number])
      for (const ch of childrenMap.get(code) ?? []) walk(ch)
    }
    roots.forEach(walk)

    // 3) 公司列：active 单体公司（汇总主体由系统聚合，不进填报模板）
    const companies = await prisma.company.findMany({
      where: { entityType: 'single', status: 'active' },
      orderBy: { orderNo: 'asc' },
      select: { name: true },
    })

    // 4) 期间列：最新生效期间及其前一月（budget 无月份行）
    const latest = type === 'static' ? await latestStaticPeriod() : await latestOperatingPeriod()
    const { year, month } = parsePeriod(latest)
    const prev = formatPeriod(year, month - 1)

    // 5) 转置宽表：行1=科目名称+公司名，行2=月份（budget 无），行3+=科目行（按层级缩进）
    const wb = new ExcelJS.Workbook()
    wb.creator = 'yipinhui-finance'
    wb.created = new Date()
    const ws = wb.addWorksheet('导入模板')
    ws.getColumn(1).width = 28
    const companyNames = companies.map((c) => c.name)
    const colCount = 1 + companyNames.length * (type === 'budget' ? 1 : 2)
    for (let i = 2; i <= colCount; i++) ws.getColumn(i).width = 16

    const subjectRows = ordered.map((s) => [`${'  '.repeat(s.level)}${s.name}`])
    if (type === 'budget') {
      ws.addRow(['科目名称（金额单位导入时可选：元/万元；年度预算归属财年在导入页面选择）', ...companyNames])
      ws.getRow(1).font = { bold: true }
      subjectRows.forEach((r) => ws.addRow(r))
    } else {
      ws.addRow(['科目名称（金额单位导入时可选：元/万元）', ...companyNames, ...companyNames])
      ws.getRow(1).font = { bold: true }
      ws.addRow(['', ...companyNames.map(() => latest), ...companyNames.map(() => prev)])
      ws.getRow(2).font = { bold: true }
      subjectRows.forEach((r) => ws.addRow(r))
    }
    const arrayBuffer = await wb.xlsx.writeBuffer()
    return Buffer.from(arrayBuffer)
  },

  /**
   * 导入预览（dry-run）：仅解析不建批次、不写库，返回将入库行数/各类计数/错误明细，
   * 及覆盖摘要、激活影响预告与看板 KPI 覆盖检查，供管理员入库前确认数据质量。
   * valueUnit 未传时按分支存量兼容默认：unpivot（operating/static/budget）归一目标为万元→默认 wan；
   * transaction 归一目标为元→默认 yuan。
   */
  async preview(file: { buffer: Buffer }, templateType: TemplateType, fiscalYear = fyLabelOfDate(new Date()), valueUnit?: ValueUnit): Promise<{ dataRowCount: number; errorCount: number; operatingCount: number; staticCount: number; budgetCount: number; errors: ImportErrorItem[]; sampleRows: SampleRows; summary: PreviewSummaryDto; activationImpact: ActivationImpact | null; kpiCoverage: KpiCoverage | null; budgetWarnings: BudgetWarnings | null }> {
    assertExcelMagic(file.buffer)
    if (!UNPIVOT_TEMPLATES.has(templateType)) {
      if (templateType === 'transaction') {
        // 往来汇总表：真实解析并映射为通用预览结构（专用结构见 previewTransaction）
        const resolvers = await buildTransactionResolvers()
        const parsed = parseTransactionWorkbook(file.buffer, 'preview.xls', resolvers, valueUnit ?? 'yuan')
        // 数据范围守卫：预览会回显公司/期间/余额，越权文件不得回显
        await assertCompaniesInScope(parsed.records.map((r) => r.companyCode), undefined, '预览导入')
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
        return { dataRowCount: parsed.dataRowCount, errorCount: parsed.errors.length, operatingCount: 0, staticCount: 0, budgetCount: 0, errors: toIssueItems(parsed.errors).slice(0, 200), sampleRows, summary: toSummaryDto(summary), activationImpact: null, kpiCoverage: null, budgetWarnings: null }
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
      return { dataRowCount: rowCount, errorCount: 0, operatingCount: 0, staticCount: 0, budgetCount: 0, errors: [], sampleRows: { headers: [], rows: [] }, summary: toSummaryDto(emptySummary()), activationImpact: null, kpiCoverage: null, budgetWarnings: null }
    }
    const template = templateType as ImportTemplate
    let parsed
    try {
      const resolvers = await buildResolvers(template, fiscalYear)
      parsed = parseImportWorkbook(file.buffer, template, resolvers, valueUnit ?? 'wan')
    } catch {
      throw errors.badRequest('Excel 解析失败，请检查文件内容与模板类型')
    }
    // 数据范围守卫：预览会回显解析结果，越权文件不得回显
    await assertCompaniesInScope(
      [
        ...parsed.operating.map((r) => r.companyCode),
        ...parsed.static.map((r) => r.companyCode),
        ...parsed.budget.map((r) => r.companyCode),
      ],
      undefined,
      '预览导入',
    )
    const activationImpact = await computeActivationImpact(template, parsed.summary.periods, fiscalYear)
    const kpiCoverage = template === 'operating' ? await computeKpiCoverage(parsed.summary.accountCodes) : null
    // 预算模板附加口径告警：计算类/父级科目行将被重算或忽略、毛利直导叶子缺行将为 0
    const budgetWarnings = template === 'budget' ? await computeBudgetWarnings(parsed.summary.accountCodes) : null
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
      budgetWarnings,
    }
  },

  /**
   * 往来汇总表导入预览（dry-run，多文件）：仅解析不建批次、不写库；
   * 附激活影响预告：解析出的 (公司,期间,类型) 与当前生效数据对比（overlapping = 激活后被替换）。
   */
  async previewTransactions(files: Array<{ originalname: string; buffer: Buffer }>, valueUnit: ValueUnit = 'yuan'): Promise<TransactionPreviewDto[]> {
    const resolvers = await buildTransactionResolvers()
    const emptyImpact = (): TransactionActivationImpact => ({ newKeys: [], overlappingKeys: [] })
    const parsedList = files.map((file) => {
      let parsed: TransactionParseResult | null = null
      let fatal: string | null = null
      try {
        assertExcelMagic(file.buffer)
        parsed = parseTransactionWorkbook(file.buffer, file.originalname, resolvers, valueUnit)
      } catch (e) {
        fatal = e instanceof Error ? e.message : '文件解析失败'
      }
      return { file, parsed, fatal }
    })

    // 文件申报三元组：实际明细 + 空 Sheet 申报范围（空模板激活时同样按申报替换旧数据，预览预告保持一致）
    const declaredKeysOf = (p: { parsed: TransactionParseResult | null }): Set<string> => {
      const keys = new Set<string>()
      for (const r of p.parsed?.records ?? []) keys.add(`${r.companyCode}|${r.period}|${r.transactionType}`)
      for (const s of p.parsed?.sheets ?? []) {
        if (s.declaredCompanyCode && s.cutoffDate) keys.add(`${s.declaredCompanyCode}|${s.cutoffDate.slice(0, 7)}|${s.transactionType}`)
      }
      return keys
    }

    // 数据范围守卫：预览会回显解析出的公司/期间/余额，越权文件不得回显（含空 Sheet 申报公司）
    await assertCompaniesInScope(
      parsedList.flatMap((p) => [
        ...(p.parsed?.records ?? []).map((r) => r.companyCode),
        ...(p.parsed?.sheets ?? []).filter((s) => s.declaredCompanyCode).map((s) => s.declaredCompanyCode!),
      ]),
      undefined,
      '预览导入',
    )

    // 全部文件三元组并集，一次查询现有生效笔数
    const tripleKeys = new Set<string>()
    for (const p of parsedList) {
      for (const k of declaredKeysOf(p)) tripleKeys.add(k)
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
      const fileKeys = declaredKeysOf({ parsed })
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
  async uploadTransactions(files: Array<{ originalname: string; buffer: Buffer; size: number }>, userId: string, traceId?: string, valueUnit: ValueUnit = 'yuan'): Promise<TransactionUploadResult[]> {
    const results: TransactionUploadResult[] = []
    for (const file of files) {
      try {
        const batch = await this.uploadTransactionOne(file, userId, traceId, valueUnit)
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
  async uploadTransactionOne(file: { originalname: string; buffer: Buffer; size: number }, userId: string, traceId?: string, valueUnit: ValueUnit = 'yuan'): Promise<ImportBatchDto> {
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
      parsed = parseTransactionWorkbook(file.buffer, file.originalname, resolvers, valueUnit)
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

    // 数据范围守卫：createMany 无 where 可注入，须在写入前校验目标公司均在操作者范围内
    const targetCompanies = [
      ...parsed.records.map((r) => r.companyCode),
      ...declaredCoverage.map((d) => d.companyCode),
    ]
    try {
      await assertCompaniesInScope(targetCompanies, undefined, '导入')
    } catch (e) {
      await prisma.importBatch.update({ where: { id: batch.id }, data: { status: 'failed' } })
      throw e
    }

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

  async upload(file: { originalname: string; buffer: Buffer; size: number }, templateType: TemplateType, userId: string, traceId?: string, fiscalYear = fyLabelOfDate(new Date()), valueUnit?: ValueUnit): Promise<ImportBatchDto> {
    if (templateType === 'transaction') {
      // 往来汇总表走专用解析入库链路（通用入口与 /transactions/import 行为一致；归一目标为元，默认 yuan）
      return this.uploadTransactionOne(file, userId, traceId, valueUnit ?? 'yuan')
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
        // 归一目标为万元，默认 wan（存量兼容；前端显式传 yuan 时解析期 ÷10000）
        const parsed = parseImportWorkbook(file.buffer, template, resolvers, valueUnit ?? 'wan')
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

    // 数据范围守卫：createMany 无 where 可注入，须在写入前校验目标公司均在操作者范围内
    try {
      await assertCompaniesInScope(
        [
          ...parsedOperating.map((r) => r.companyCode),
          ...parsedStatic.map((r) => r.companyCode),
          ...parsedBudget.map((r) => r.companyCode),
        ],
        undefined,
        '导入',
      )
    } catch (e) {
      await prisma.importBatch.update({ where: { id: batch.id }, data: { status: 'failed' } })
      throw e
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
    await recordAudit({ userId, module: 'data', action: 'import', targetId: batch.id, detail: { templateType, rowCount, errorCount, valueUnit: valueUnit ?? 'wan' } }, traceId)
    return toDto(updated)
  },

  async list(params: { page: number; pageSize: number; templateType?: string; userId?: string }): Promise<{ items: ImportBatchDto[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const where: Record<string, unknown> = params.templateType ? { dataType: params.templateType as TemplateType } : {}
    // 元数据（文件名/行数）按数据范围收敛：仅保留申报覆盖与范围有交集的批次；
    // 无申报覆盖信息的历史批次仅上传者本人可见。
    const scope = await effectiveScope()
    if (scope && scope.type !== 'all') {
      const allowed = new Set(scope.type === 'companies' ? scope.companyCodes : [])
      const candidates = await prisma.importBatch.findMany({
        where,
        select: { id: true, coverageJson: true, uploadedById: true },
      })
      const visibleIds = candidates
        .filter((b) => {
          const declared = declaredCoverageCompanies(b.coverageJson)
          if (declared.length === 0) return !!params.userId && b.uploadedById === params.userId
          return declared.some((c) => allowed.has(c))
        })
        .map((b) => b.id)
      where.id = { in: visibleIds }
    }
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
          select: { id: true, coverageJson: true },
        })
        const oldIds = oldActive.map((x) => x.id)
        if (oldIds.length > 0) {
          // 实际明细三元组 + 申报覆盖三元组并集：空模板申报"该期确无往来款"，
          // 激活时同样按申报范围替换（删除）旧生效数据，覆盖矩阵随之显示为 empty
          const keys = await tx.transactionDetail.findMany({
            where: { batchId: id },
            distinct: ['companyCode', 'period', 'transactionType'],
            select: { companyCode: true, period: true, transactionType: true },
          })
          const keySet = new Map<string, { companyCode: string; period: string | null; transactionType: string }>()
          for (const k of keys) keySet.set(`${k.companyCode}|${k.period ?? ''}|${k.transactionType}`, k)
          for (const d of parseDeclaredCoverage(b.coverageJson)) {
            keySet.set(`${d.companyCode}|${d.period}|${d.transactionType}`, { companyCode: d.companyCode, period: d.period, transactionType: d.transactionType })
          }
          const mergedKeys = [...keySet.values()]
          if (mergedKeys.length > 0) {
            const res = await tx.transactionDetail.deleteMany({
              where: {
                batchId: { in: oldIds },
                OR: mergedKeys.map((k) => ({ companyCode: k.companyCode, period: k.period, transactionType: k.transactionType })),
              },
            })
            deleted = res.count
            replaced = mergedKeys.map((k) => `${k.companyCode}|${k.period ?? '-'}|${k.transactionType}`).sort()
            const replacedKeySet = new Set(mergedKeys.map((k) => `${k.companyCode}|${k.period ?? ''}|${k.transactionType}`))
            for (const oldBatch of oldActive) {
              const remaining = await tx.transactionDetail.count({ where: { batchId: oldBatch.id } })
              if (remaining > 0) continue
              // 空模板（无明细）但申报范围未被本次激活全部替换 → 保持 active，
              // 维持"该期确无往来款"的 empty 状态（否则矩阵将退化为 missing）
              const stillDeclared = parseDeclaredCoverage(oldBatch.coverageJson).some(
                (d) => !replacedKeySet.has(`${d.companyCode}|${d.period}|${d.transactionType}`),
              )
              if (!stillDeclared) {
                await tx.importBatch.update({ where: { id: oldBatch.id }, data: { lifecycleStatus: 'archived' } })
              }
            }
          }
          // mergedKeys 为空（新批次无任何明细与申报）时不执行替换与归档
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

  /**
   * 批量激活预检（只读，不写库不记审计）：计算各批次激活后将替换的已生效组合，供前端批量激活前确认覆盖风险。
   * - transaction：申报三元组（明细 distinct ∪ coverageJson）与 active 批次明细重叠（含现有笔数）；
   * - operating/static：本批次期间/快照月与 active 批次重叠；
   * - budget：同财年 active 批次整体替换；inventory：同类型 active 整体替换。
   * 另统计所选批次之间的三元组重叠（激活顺序靠后的覆盖靠前的）。批次不存在时返回 status=''。
   */
  async checkBatchActivateConflicts(ids: string[]): Promise<BatchActivateCheckItem[]> {
    const uniqueIds = [...new Set(ids)]
    const batches = await prisma.importBatch.findMany({ where: { id: { in: uniqueIds } } })
    const byId = new Map(batches.map((b) => [b.id, b]))

    // 全部选中 transaction 草稿批次的三元组并集（一次查询 active 重叠计数）
    const txnBatchKeys = new Map<string, Set<string>>()
    const txnTriples: { companyCode: string; period: string; transactionType: string }[] = []
    for (const b of batches) {
      if (b.dataType !== 'transaction' || b.lifecycleStatus !== 'draft') continue
      const keys = new Set<string>()
      const rows = await prisma.transactionDetail.findMany({
        where: { batchId: b.id },
        distinct: ['companyCode', 'period', 'transactionType'],
        select: { companyCode: true, period: true, transactionType: true },
      })
      for (const r of rows) {
        if (!r.period) continue
        keys.add(`${r.companyCode}|${r.period}|${r.transactionType}`)
      }
      for (const d of parseDeclaredCoverage(b.coverageJson)) keys.add(`${d.companyCode}|${d.period}|${d.transactionType}`)
      txnBatchKeys.set(b.id, keys)
      for (const k of keys) {
        const [companyCode, period, transactionType] = k.split('|')
        txnTriples.push({ companyCode, period, transactionType })
      }
    }
    const existingCount = new Map<string, number>()
    const activeTxnIds = (await prisma.importBatch.findMany({ where: { dataType: 'transaction', lifecycleStatus: 'active' }, select: { id: true } })).map((x) => x.id)
    if (activeTxnIds.length > 0 && txnTriples.length > 0) {
      const rows = await prisma.transactionDetail.groupBy({
        by: ['companyCode', 'period', 'transactionType'],
        where: { batchId: { in: activeTxnIds }, OR: txnTriples },
        _count: { id: true },
      })
      for (const r of rows) {
        if (r.period) existingCount.set(`${r.companyCode}|${r.period}|${r.transactionType}`, r._count.id)
      }
    }

    // 批次间重叠：同一三元组出现在多个选中批次中
    const keyFrequency = new Map<string, number>()
    for (const keys of txnBatchKeys.values()) {
      for (const k of keys) keyFrequency.set(k, (keyFrequency.get(k) ?? 0) + 1)
    }

    const results: BatchActivateCheckItem[] = []
    for (const id of uniqueIds) {
      const b = byId.get(id)
      if (!b) {
        results.push({ id, filename: '', status: '', conflictCount: 0, conflicts: [], crossBatchConflictCount: 0 })
        continue
      }
      if (b.lifecycleStatus !== 'draft') {
        results.push({ id, filename: b.fileName, status: b.lifecycleStatus, conflictCount: 0, conflicts: [], crossBatchConflictCount: 0 })
        continue
      }
      const conflicts: ActivateConflict[] = []
      if (b.dataType === 'transaction') {
        for (const k of txnBatchKeys.get(id) ?? []) {
          const [companyCode, period, transactionType] = k.split('|')
          const existing = existingCount.get(k)
          if (existing) conflicts.push({ companyCode, period, transactionType, existingCount: existing })
        }
      } else if (b.dataType === 'operating') {
        const periods = await prisma.factOperating.findMany({ where: { batchId: id }, distinct: ['period'], select: { period: true } })
        const fileSet = new Set(periods.map((p) => p.period))
        if (fileSet.size > 0) {
          const oldIds = (await prisma.importBatch.findMany({ where: { dataType: 'operating', lifecycleStatus: 'active' }, select: { id: true } })).map((x) => x.id)
          if (oldIds.length > 0) {
            const overlap = await prisma.factOperating.findMany({
              where: { batchId: { in: oldIds }, period: { in: [...fileSet] } },
              distinct: ['period'],
              select: { period: true },
            })
            for (const p of overlap) conflicts.push({ period: p.period })
          }
        }
      } else if (b.dataType === 'static') {
        const snaps = await prisma.factStatic.findMany({ where: { batchId: id }, distinct: ['snapshotDate'], select: { snapshotDate: true } })
        const fileMonths = new Set(snaps.map((s) => ymOfDate(s.snapshotDate)))
        if (fileMonths.size > 0) {
          const oldIds = (await prisma.importBatch.findMany({ where: { dataType: 'static', lifecycleStatus: 'active' }, select: { id: true } })).map((x) => x.id)
          if (oldIds.length > 0) {
            const oldSnaps = await prisma.factStatic.findMany({ where: { batchId: { in: oldIds } }, distinct: ['snapshotDate'], select: { snapshotDate: true } })
            const months = new Set(oldSnaps.map((s) => ymOfDate(s.snapshotDate)))
            for (const m of months) {
              if (fileMonths.has(m)) conflicts.push({ period: m })
            }
          }
        }
      } else if (b.dataType === 'budget') {
        const old = await prisma.importBatch.findMany({ where: { dataType: 'budget', lifecycleStatus: 'active', fiscalYear: b.fiscalYear }, select: { fileName: true } })
        for (const x of old) conflicts.push({ label: `替换《${x.fileName}》的 ${b.fiscalYear} 财年预算` })
      } else {
        const old = await prisma.importBatch.findMany({ where: { dataType: b.dataType, lifecycleStatus: 'active' }, select: { fileName: true } })
        for (const x of old) conflicts.push({ label: `替换当前生效的数据《${x.fileName}》` })
      }
      let crossBatchConflictCount = 0
      for (const k of txnBatchKeys.get(id) ?? []) {
        if ((keyFrequency.get(k) ?? 0) > 1) crossBatchConflictCount++
      }
      results.push({ id, filename: b.fileName, status: 'draft', conflictCount: conflicts.length, conflicts, crossBatchConflictCount })
    }
    return results
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
