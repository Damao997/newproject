import * as XLSX from 'xlsx'
import { derivePartyType, type PartyType } from './party'

/**
 * 六大往来账龄汇总表解析器（数据源：CUX_AR/AP 账龄报表的《{前缀}-账龄汇总表》Sheet）。
 *
 * 文件特征（已实测）：
 *  - 物理格式为 SpreadsheetML XML（伪 .xls）或 BIFF 复合文档 .xls，统一交由 xlsx 包读取；
 *  - 文件名不可靠，按 Sheet 名前缀识别往来类型：
 *      AR→应收账款 / AROT→其他应收款 / PER_AR→预收账款（direction=AR）
 *      AP→应付账款 / APOT→其他应付款 / PER_AP→预付账款（direction=AP）
 *  - 表头行含「公司编码」，AR 类客户列为 客户编码/客户名称，AP 类为 供应商/供应商名称；
 *  - 账龄 10 段 + 合计在表头次行子表头，自「期末余额账龄分析」锚点列展开；
 *  - 截止日期在数据区上方行：「截止日期:YYYY-MM-DD」；
 *  - 数据区混有小计行（公司编码为空）与页脚行（制单人/打印时间），需静默过滤。
 *
 * 数据粒度 = 客商 × 科目（×子目），无单据级字段（单据号/记账日期/到期日/账龄天数）。
 * 清洗规则：行过滤 / 阻断性错误跳行 / 账龄一致性警告 / 金额两位标准化 / 文件内按业务键求和去重 / 内部往来标记。
 */

export interface TransactionImportIssue {
  sheet: string
  row: number
  column: string
  message: string
}

/** 与 transaction_detail 宽表字段对齐的入库记录 */
export interface TransactionImportRecord {
  companyCode: string
  companyName: string | null
  transactionType: string
  direction: string
  cutoffDate: string
  period: string
  counterpartyCode: string
  counterpartyName: string | null
  accountCode: string
  accountDesc: string | null
  subCode: string | null
  subName: string | null
  openingBalance: number
  debitAmount: number
  creditAmount: number
  closingBalance: number
  aging1m: number
  aging2m: number
  aging3m: number
  aging4m: number
  aging5m: number
  aging6m: number
  aging6mTo1y: number
  aging1yTo2y: number
  aging2yTo3y: number
  aging3yPlus: number
  agingTotal: number
  isInternal: boolean
  internalType: string
  internalPeerCode: string | null
  partyType: PartyType
  sourceFile: string
  rawJson: Record<string, unknown>
}

export interface TransactionSheetInfo {
  sheetName: string
  transactionType: string
  direction: string
  cutoffDate: string | null
  recordCount: number
  /** 申报公司编码：标题行「公司:名称」解析，失败时回退首条记录公司；空 Sheet 也能据此申报覆盖范围 */
  declaredCompanyCode: string | null
}

export interface TransactionParseSummary {
  /** 各往来类型入库记录数 */
  typeCounts: Record<string, number>
  companies: string[]
  periods: string[]
  totalClosingBalance: number
  duplicateCount: number
  duplicateSamples: string[]
  counterpartyCount: number
  internalCount: number
}

export interface TransactionParseResult {
  records: TransactionImportRecord[]
  sheets: TransactionSheetInfo[]
  errors: TransactionImportIssue[]
  warnings: TransactionImportIssue[]
  /** 解析扫描到的数据行数（过滤小计/页脚前） */
  dataRowCount: number
  summary: TransactionParseSummary
}

export interface TransactionResolvers {
  /** 有效公司编码集合（EN+6位） */
  companyCodes: Set<string>
  /** 公司编码 → 公司名称（入库 companyName 以主数据为准） */
  companyNameByCode: Map<string, string>
  /** 内部往来识别：公司 name/shortName/legalEntity → 公司编码 */
  internalByName: Map<string, string>
}

// Sheet 名前缀 → 往来类型/方向（顺序注意：长前缀优先匹配）
const SHEET_TYPE_MAP: Array<{ prefix: string; transactionType: string; direction: string }> = [
  { prefix: 'PER_AR', transactionType: '预收账款', direction: 'AR' },
  { prefix: 'PER_AP', transactionType: '预付账款', direction: 'AP' },
  { prefix: 'AROT', transactionType: '其他应收款', direction: 'AR' },
  { prefix: 'APOT', transactionType: '其他应付款', direction: 'AP' },
  { prefix: 'AR', transactionType: '应收账款', direction: 'AR' },
  { prefix: 'AP', transactionType: '应付账款', direction: 'AP' },
]

const AGING_LABELS = ['1个月', '2个月', '3个月', '4个月', '5个月', '6个月', '半年到1年', '1年到2年', '2年到3年', '3年以上'] as const

const AGING_FIELDS = ['aging1m', 'aging2m', 'aging3m', 'aging4m', 'aging5m', 'aging6m', 'aging6mTo1y', 'aging1yTo2y', 'aging2yTo3y', 'aging3yPlus'] as const

/**
 * 贷方性质类型：ERP 账龄报表按借方正号口径输出，此三类余额原始为负。
 * 入库时统一翻转符号（余额/账龄转正），使六类展示口径一致；
 * 翻转后仍为负的行表示反方向余额（如应付科目的借方余额），保留负号。
 */
const CREDIT_NATURE_TYPES = new Set(['预收账款', '应付账款', '其他应付款'])

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  return String(v).trim()
}

/** 金额解析：空→0；千分位容忍；非数字→null */
function parseAmount(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return 0
  if (typeof v === 'number') return Number.isFinite(v) ? round2(v) : null
  const n = Number(String(v).replace(/,/g, '').trim())
  return Number.isNaN(n) ? null : round2(n)
}

function round2(n: number): number {
  return Number(n.toFixed(2))
}

function excelColLabel(index: number): string {
  let n = index + 1
  let label = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    label = String.fromCharCode(65 + rem) + label
    n = Math.floor((n - 1) / 26)
  }
  return label
}

/** 截止日期提取：兼容 "截止日期:2026-04-30" / 全角冒号 / Date 单元格 */
function extractCutoffDate(rows: unknown[][], headerRowIdx: number): string | null {
  for (let r = 0; r < headerRowIdx; r++) {
    const row = rows[r]
    if (!row) continue
    for (const cell of row) {
      if (cell instanceof Date) continue
      const text = cellText(cell)
      const m = text.match(/截止日期[:：]\s*(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/)
      if (m) {
        return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
      }
    }
  }
  return null
}

/** 申报公司提取：表头行上方的「公司:名称」行，经公司名称映射解析为编码（空 Sheet 也可申报覆盖范围） */
function extractDeclaredCompany(rows: unknown[][], headerRowIdx: number, resolvers: TransactionResolvers): string | null {
  for (let r = 0; r < headerRowIdx; r++) {
    const row = rows[r]
    if (!row) continue
    for (const cell of row) {
      if (cell instanceof Date) continue
      const m = cellText(cell).match(/^公司[:：]\s*(.+)$/)
      if (m) {
        const code = resolvers.internalByName.get(m[1].trim())
        if (code) return code
      }
    }
  }
  return null
}

interface ColumnMap {
  companyCode: number
  companyName: number
  counterpartyCode: number
  counterpartyName: number
  counterpartyNature: number
  accountCode: number
  accountDesc: number
  subCode: number
  subName: number
  naturalYearOpening: number
  fiscalYearOpening: number
  closingBalance: number
  monthlyAmount: number
  agingCols: number[]
  agingTotalCol: number
}

/** 定位表头行（含「公司编码」与科目列），按表头名建列映射；账龄段取次行子表头 */
function buildColumnMap(rows: unknown[][], sheetName: string, errors: TransactionImportIssue[]): { headerRowIdx: number; map: ColumnMap } | null {
  let headerRowIdx = -1
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const texts = (rows[r] ?? []).map(cellText)
    if (texts.includes('公司编码') && texts.includes('会计科目编码')) {
      headerRowIdx = r
      break
    }
  }
  if (headerRowIdx < 0) {
    errors.push({ sheet: sheetName, row: 0, column: '-', message: '未找到表头行（缺少「公司编码/会计科目编码」列）' })
    return null
  }
  const headers = (rows[headerRowIdx] ?? []).map(cellText)
  const idxOf = (...names: string[]): number => {
    for (const name of names) {
      const i = headers.indexOf(name)
      if (i >= 0) return i
    }
    return -1
  }
  const map: ColumnMap = {
    companyCode: idxOf('公司编码'),
    companyName: idxOf('公司名称'),
    counterpartyCode: idxOf('客户编码', '供应商'),
    counterpartyName: idxOf('客户名称', '供应商名称'),
    counterpartyNature: idxOf('客户性质'),
    accountCode: idxOf('会计科目编码'),
    accountDesc: idxOf('会计科目说明', '会计科目描述'),
    subCode: idxOf('子目编码'),
    subName: idxOf('子目说明', '子目名称'),
    naturalYearOpening: idxOf('自然年年初余额', '自然年初余额'),
    fiscalYearOpening: idxOf('财年年初余额'),
    closingBalance: idxOf('期末余额'),
    monthlyAmount: idxOf('本月收款额', '本月收付额'),
    agingCols: [],
    agingTotalCol: -1,
  }
  if (map.counterpartyCode < 0 || map.closingBalance < 0) {
    errors.push({ sheet: sheetName, row: headerRowIdx + 1, column: '-', message: '表头缺少客商编码或期末余额列' })
    return null
  }
  // 账龄子表头：表头次行，按 10 段标签逐一定位
  const subHeaders = (rows[headerRowIdx + 1] ?? []).map(cellText)
  map.agingCols = AGING_LABELS.map((label) => subHeaders.indexOf(label))
  map.agingTotalCol = subHeaders.lastIndexOf('合计')
  if (map.agingCols.some((c) => c < 0)) {
    errors.push({ sheet: sheetName, row: headerRowIdx + 2, column: '-', message: '账龄子表头不完整（缺少 10 段账龄标签）' })
    return null
  }
  return { headerRowIdx, map }
}

/** 解析单个账龄汇总 Sheet，产出清洗后的入库记录 */
function parseSummarySheet(
  rows: unknown[][],
  sheetName: string,
  typeInfo: { transactionType: string; direction: string },
  sourceFile: string,
  resolvers: TransactionResolvers,
  result: TransactionParseResult,
): TransactionSheetInfo {
  const info: TransactionSheetInfo = { sheetName, transactionType: typeInfo.transactionType, direction: typeInfo.direction, cutoffDate: null, recordCount: 0, declaredCompanyCode: null }
  const located = buildColumnMap(rows, sheetName, result.errors)
  if (!located) return info
  const { headerRowIdx, map } = located

  info.declaredCompanyCode = extractDeclaredCompany(rows, headerRowIdx, resolvers)
  const cutoffDate = extractCutoffDate(rows, headerRowIdx)
  info.cutoffDate = cutoffDate
  if (!cutoffDate) {
    result.errors.push({ sheet: sheetName, row: headerRowIdx, column: '-', message: '未找到「截止日期」，整个 Sheet 跳过' })
    return info
  }
  const period = cutoffDate.slice(0, 7)

  for (let r = headerRowIdx + 2; r < rows.length; r++) {
    const row = rows[r]
    if (!row || row.length === 0) continue
    const firstText = cellText(row.find((c) => cellText(c) !== ''))
    if (!firstText) continue
    // 页脚行：制单人 / 打印时间
    if (/^(制单人|打印时间)/.test(firstText)) continue

    const rawCompany = cellText(row[map.companyCode])
    const counterpartyName = cellText(row[map.counterpartyName])
    // 小计/合计行：公司编码为空，或客商名称含小计/合计
    if (!rawCompany || /小计|合计/.test(counterpartyName)) continue

    result.dataRowCount++
    const rowNo = r + 1

    const companyCode = /^EN/i.test(rawCompany) ? rawCompany.toUpperCase() : `EN${rawCompany.padStart(6, '0')}`
    if (!resolvers.companyCodes.has(companyCode)) {
      result.errors.push({ sheet: sheetName, row: rowNo, column: excelColLabel(map.companyCode), message: `公司编码未匹配：'${rawCompany}'` })
      continue
    }
    const accountCode = cellText(row[map.accountCode])
    if (!accountCode) {
      result.errors.push({ sheet: sheetName, row: rowNo, column: excelColLabel(map.accountCode), message: '科目编码为空' })
      continue
    }
    const counterpartyCode = cellText(row[map.counterpartyCode])
    if (!counterpartyCode) {
      result.errors.push({ sheet: sheetName, row: rowNo, column: excelColLabel(map.counterpartyCode), message: '客商编码为空' })
      continue
    }
    const closingBalance = parseAmount(row[map.closingBalance])
    if (closingBalance === null) {
      result.errors.push({ sheet: sheetName, row: rowNo, column: excelColLabel(map.closingBalance), message: `期末余额非数字：'${cellText(row[map.closingBalance])}'` })
      continue
    }

    const openingBalance = (map.fiscalYearOpening >= 0 ? parseAmount(row[map.fiscalYearOpening]) : 0) ?? 0
    const aging = map.agingCols.map((c) => parseAmount(row[c]) ?? 0)
    const agingTotal = (map.agingTotalCol >= 0 ? parseAmount(row[map.agingTotalCol]) : null) ?? round2(aging.reduce((s, v) => s + v, 0))

    // 账龄一致性校验（警告，不阻断；基于原始符号比对）
    const agingSum = round2(aging.reduce((s, v) => s + v, 0))
    if (Math.abs(agingSum - closingBalance) > 0.01) {
      result.warnings.push({ sheet: sheetName, row: rowNo, column: '-', message: `账龄10段之和(${agingSum})与期末余额(${closingBalance})不一致` })
    } else if (Math.abs(agingTotal - closingBalance) > 0.01) {
      result.warnings.push({ sheet: sheetName, row: rowNo, column: excelColLabel(map.agingTotalCol), message: `账龄合计列(${agingTotal})与期末余额(${closingBalance})不一致` })
    }

    // 贷方性质类型符号归一：借方正号口径 → 余额/账龄转正
    const sign = CREDIT_NATURE_TYPES.has(typeInfo.transactionType) ? -1 : 1

    // 内部往来标记：客商名称命中公司主数据
    const internalPeerCode = counterpartyName ? resolvers.internalByName.get(counterpartyName) ?? null : null
    const isInternal = internalPeerCode !== null

    const record: TransactionImportRecord = {
      companyCode,
      companyName: resolvers.companyNameByCode.get(companyCode) ?? (cellText(row[map.companyName]) || null),
      transactionType: typeInfo.transactionType,
      direction: typeInfo.direction,
      cutoffDate,
      period,
      counterpartyCode,
      counterpartyName: counterpartyName || null,
      accountCode,
      accountDesc: map.accountDesc >= 0 ? cellText(row[map.accountDesc]) || null : null,
      subCode: map.subCode >= 0 ? cellText(row[map.subCode]) || null : null,
      subName: map.subName >= 0 ? cellText(row[map.subName]) || null : null,
      openingBalance: round2(openingBalance * sign),
      debitAmount: 0,
      creditAmount: 0,
      closingBalance: round2(closingBalance * sign),
      aging1m: round2(aging[0] * sign), aging2m: round2(aging[1] * sign), aging3m: round2(aging[2] * sign), aging4m: round2(aging[3] * sign), aging5m: round2(aging[4] * sign),
      aging6m: round2(aging[5] * sign), aging6mTo1y: round2(aging[6] * sign), aging1yTo2y: round2(aging[7] * sign), aging2yTo3y: round2(aging[8] * sign), aging3yPlus: round2(aging[9] * sign),
      agingTotal: round2(agingTotal * sign),
      isInternal,
      internalType: isInternal ? '内部关联' : '外部',
      internalPeerCode,
      partyType: derivePartyType(isInternal, counterpartyCode),
      sourceFile,
      rawJson: {
        sheet: sheetName,
        // 原始口径快照（未翻转），供追溯对账
        rawClosingBalance: closingBalance,
        naturalYearOpening: map.naturalYearOpening >= 0 ? parseAmount(row[map.naturalYearOpening]) ?? 0 : 0,
        monthlyAmount: map.monthlyAmount >= 0 ? parseAmount(row[map.monthlyAmount]) ?? 0 : 0,
        counterpartyNature: map.counterpartyNature >= 0 ? cellText(row[map.counterpartyNature]) || null : null,
      },
    }
    result.records.push(record)
    info.recordCount++
    // 标题解析失败时回退：取首条记录公司作为申报公司
    if (!info.declaredCompanyCode) info.declaredCompanyCode = companyCode
  }
  return info
}

/** 文件内去重：业务键完全重复的行金额字段求和合并（与激活期的期间合并语义无关） */
function mergeDuplicates(result: TransactionParseResult): void {
  const byKey = new Map<string, TransactionImportRecord>()
  let duplicateCount = 0
  const duplicateSamples: string[] = []
  const MONEY_FIELDS = ['openingBalance', 'closingBalance', 'agingTotal', ...AGING_FIELDS] as const
  for (const rec of result.records) {
    const key = [rec.companyCode, rec.transactionType, rec.counterpartyCode, rec.accountCode, rec.subCode ?? ''].join('|')
    const prev = byKey.get(key)
    if (prev) {
      duplicateCount++
      if (duplicateSamples.length < 5) {
        duplicateSamples.push(`${rec.counterpartyName ?? rec.counterpartyCode} × ${rec.accountCode} × ${rec.transactionType}`)
      }
      for (const f of MONEY_FIELDS) {
        prev[f] = round2(prev[f] + rec[f])
      }
    } else {
      byKey.set(key, { ...rec })
    }
  }
  result.records = [...byKey.values()]
  result.summary.duplicateCount = duplicateCount
  result.summary.duplicateSamples = duplicateSamples
}

function buildSummary(result: TransactionParseResult): void {
  const typeCounts: Record<string, number> = {}
  const companies = new Set<string>()
  const periods = new Set<string>()
  const counterparties = new Set<string>()
  let totalClosingBalance = 0
  let internalCount = 0
  for (const rec of result.records) {
    typeCounts[rec.transactionType] = (typeCounts[rec.transactionType] || 0) + 1
    companies.add(rec.companyCode)
    periods.add(rec.period)
    counterparties.add(rec.counterpartyCode)
    totalClosingBalance += rec.closingBalance
    if (rec.isInternal) internalCount++
  }
  result.summary.typeCounts = typeCounts
  result.summary.companies = [...companies].sort()
  result.summary.periods = [...periods].sort()
  result.summary.totalClosingBalance = round2(totalClosingBalance)
  result.summary.counterpartyCount = counterparties.size
  result.summary.internalCount = internalCount
}

/** 按 Sheet 名识别账龄汇总表并返回类型信息；非汇总表返回 null */
export function matchSummarySheet(sheetName: string): { transactionType: string; direction: string } | null {
  const m = sheetName.match(/^([A-Z_]+)-账龄汇总表$/)
  if (!m) return null
  const entry = SHEET_TYPE_MAP.find((e) => e.prefix === m[1])
  return entry ? { transactionType: entry.transactionType, direction: entry.direction } : null
}

export function parseTransactionWorkbook(buffer: Buffer, sourceFile: string, resolvers: TransactionResolvers): TransactionParseResult {
  const result: TransactionParseResult = {
    records: [],
    sheets: [],
    errors: [],
    warnings: [],
    dataRowCount: 0,
    summary: { typeCounts: {}, companies: [], periods: [], totalClosingBalance: 0, duplicateCount: 0, duplicateSamples: [], counterpartyCount: 0, internalCount: 0 },
  }
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  } catch {
    result.errors.push({ sheet: '-', row: 0, column: '-', message: '文件解析失败，请检查文件格式' })
    return result
  }

  let matched = 0
  for (const sheetName of wb.SheetNames) {
    const typeInfo = matchSummarySheet(sheetName)
    if (!typeInfo) continue
    matched++
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, blankrows: false, defval: null }) as unknown[][]
    const info = parseSummarySheet(rows, sheetName, typeInfo, sourceFile, resolvers, result)
    result.sheets.push(info)
  }
  if (matched === 0) {
    result.errors.push({ sheet: '-', row: 0, column: '-', message: '未找到账龄汇总表 Sheet（如「AR-账龄汇总表」），请确认文件为六大往来账龄报表' })
    return result
  }

  mergeDuplicates(result)
  buildSummary(result)
  return result
}
