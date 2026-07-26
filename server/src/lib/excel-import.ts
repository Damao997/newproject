import { inflateRawSync } from 'node:zlib'
import { OPERATING_DIMS, STATIC_DIMS } from './metric-values'
import { fyLabelOfDate, getFiscalStartMonth } from './period'

/**
 * Excel 宽表 → 长表 unpivot 解析器（见 数据模型规范 §4.4）。
 *
 * 布局（按 templateType）：
 *  - operating：行0=公司名、行1=月份(日期)，行2+=科目值；每列=(公司×月份)。
 *  - static   ：行0=公司名、行1=快照月份，行2+=科目值。
 *  - budget   ：行0=公司名，行1+=科目年度预算值（无日期）。
 *
 * 读取方式：直接解压 xlsx(zip) 内的工作表 XML，仅解析含值的单元格（稀疏解析），
 * 适配「声明了海量空样式单元格」的大文件（避免同步全量 DOM 解析阻塞事件循环）。
 * 名称→编码解析：公司名经 companyByName、科目名经 subjectByName（外部注入，来自 DB）。
 * 无法解析或值非数字的单元格记入 errors（{row,column,message}），不中断整体解析。
 */

export type ImportTemplate = 'operating' | 'static' | 'budget'

export interface ImportError {
  row: number
  column: string
  message: string
}

export interface OperatingUnpivotRow {
  companyCode: string
  accountCode: string
  period: string
  periodDimCode: string
  fiscalYear: string
  value: number
}
export interface StaticUnpivotRow {
  companyCode: string
  accountCode: string
  snapshotDate: Date
  periodDimCode: string
  fiscalYear: string
  value: number
}
export interface BudgetUnpivotRow {
  companyCode: string
  accountCode: string
  fiscalYear: string
  period: string
  value: number
}

export interface SampleRows {
  headers: string[]
  rows: (string | number)[][]
}

/** 预览覆盖摘要：解析完成后单遍后置扫描得出（转置/标准布局共用） */
export interface PreviewSummary {
  companyCount: number
  subjectCount: number
  periodRange: { min: string | null; max: string | null }
  /** 去重升序期间列表（operating=月份、static=快照月、budget=财年），供服务层做生效数据对比 */
  periods: string[]
  totalValue: number
  zeroValueCount: number
  /** 文件内重复条数（唯一键与 DB 约束一致），入库时将被 skipDuplicates 跳过 */
  duplicateCount: number
  /** 重复示例（最多 5 条，"公司名 × 科目名 × 期间"） */
  duplicateSamples: string[]
  /** 去重科目编码，供服务层做看板 KPI 覆盖检查 */
  accountCodes: string[]
}

export function emptySummary(): PreviewSummary {
  return { companyCount: 0, subjectCount: 0, periodRange: { min: null, max: null }, periods: [], totalValue: 0, zeroValueCount: 0, duplicateCount: 0, duplicateSamples: [], accountCodes: [] }
}

export interface ParseResult {
  template: ImportTemplate
  operating: OperatingUnpivotRow[]
  static: StaticUnpivotRow[]
  budget: BudgetUnpivotRow[]
  errors: ImportError[]
  dataRowCount: number
  sampleRows: SampleRows
  summary: PreviewSummary
}

export interface Resolvers {
  companyByName: Map<string, string>
  subjectByName: Map<string, string>
  defaultFiscalYear: string
}

// ---------------- xlsx(zip) 稀疏解析 ----------------

interface ZipEntry {
  name: string
  data: Buffer
}

function readZipEntries(buf: Buffer): ZipEntry[] {
  const eocdSig = 0x06054b50
  let eocd = -1
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === eocdSig) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('非法的 xlsx 文件（缺少 zip 中央目录）')
  const cdCount = buf.readUInt16LE(eocd + 10)
  let cdOffset = buf.readUInt32LE(eocd + 16)
  const entries: ZipEntry[] = []
  for (let k = 0; k < cdCount; k++) {
    if (cdOffset + 46 > buf.length || buf.readUInt32LE(cdOffset) !== 0x02014b50) break
    const method = buf.readUInt16LE(cdOffset + 10)
    const compSize = buf.readUInt32LE(cdOffset + 20)
    const nameLen = buf.readUInt16LE(cdOffset + 28)
    const extraLen = buf.readUInt16LE(cdOffset + 30)
    const commentLen = buf.readUInt16LE(cdOffset + 32)
    const localOffset = buf.readUInt32LE(cdOffset + 42)
    const name = buf.subarray(cdOffset + 46, cdOffset + 46 + nameLen).toString('utf8')
    const lnLen = buf.readUInt16LE(localOffset + 26)
    const leLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lnLen + leLen
    const compData = buf.subarray(dataStart, dataStart + compSize)
    let data: Buffer
    if (method === 0) data = compData
    else {
      try {
        data = inflateRawSync(compData)
      } catch {
        data = Buffer.alloc(0)
      }
    }
    entries.push({ name, data })
    cdOffset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = []
  const siRe = /<si>([\s\S]*?)<\/si>/g
  let m: RegExpExecArray | null
  while ((m = siRe.exec(xml)) !== null) {
    const inner = m[1]
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g
    let t: RegExpExecArray | null
    let text = ''
    while ((t = tRe.exec(inner)) !== null) text += t[1]
    out.push(decodeXml(text))
  }
  return out
}

function colLetterToIndex(letters: string): number {
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

function excelSerialToDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000)
}

/** 解析 styles.xml，返回 cellXfs 中每个 xf 是否为日期格式 */
function parseDateXfSet(stylesXml: string): Set<number> {
  const dateFmtIds = new Set<number>([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47])
  const numFmtRe = /<numFmt[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = numFmtRe.exec(stylesXml)) !== null) {
    const id = parseInt(m[1], 10)
    const code = m[2].toLowerCase()
    if (/[ymd]/.test(code) && !/[#0]/.test(code)) dateFmtIds.add(id)
  }
  const dateXf = new Set<number>()
  const xfSection = stylesXml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)
  if (xfSection) {
    const xfRe = /<xf\b[^>]*>/g
    let x: RegExpExecArray | null
    let idx = 0
    while ((x = xfRe.exec(xfSection[1])) !== null) {
      const nf = x[0].match(/numFmtId="(\d+)"/)
      if (nf && dateFmtIds.has(parseInt(nf[1], 10))) dateXf.add(idx)
      idx++
    }
  }
  return dateXf
}

interface Cell {
  col: number
  value: string | number | Date
}

function parseSheetCells(sheetXml: string, shared: string[], dateXf: Set<number>): Map<number, Cell[]> {
  const rows = new Map<number, Cell[]>()
  const rowRe = /<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g
  let rm: RegExpExecArray | null
  while ((rm = rowRe.exec(sheetXml)) !== null) {
    const rowNumber = parseInt(rm[1], 10)
    const inner = rm[2]
    const cells: Cell[] = []
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let cm: RegExpExecArray | null
    while ((cm = cellRe.exec(inner)) !== null) {
      const attrs = cm[1]
      const innerXml = cm[2]
      if (!innerXml) continue // 空单元格
      const vMatch = innerXml.match(/<v>([\s\S]*?)<\/v>/)
      const isMatch = innerXml.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/)
      const refMatch = attrs.match(/r="([A-Z]+)\d+"/)
      if (!refMatch) continue
      const col = colLetterToIndex(refMatch[1])
      const typeMatch = attrs.match(/t="([^"]+)"/)
      const type = typeMatch ? typeMatch[1] : 'n'
      const styleMatch = attrs.match(/s="(\d+)"/)
      const styleIdx = styleMatch ? parseInt(styleMatch[1], 10) : -1
      if (type === 's') {
        if (vMatch) cells.push({ col, value: shared[parseInt(vMatch[1], 10)] ?? '' })
      } else if (type === 'inlineStr') {
        if (isMatch) cells.push({ col, value: decodeXml(isMatch[1]) })
      } else if (type === 'str') {
        if (vMatch) cells.push({ col, value: decodeXml(vMatch[1]) })
      } else if (type === 'b') {
        if (vMatch) cells.push({ col, value: vMatch[1] === '1' ? 1 : 0 })
      } else {
        if (vMatch) {
          const num = Number(vMatch[1])
          if (Number.isFinite(num)) {
            if (styleIdx >= 0 && dateXf.has(styleIdx)) cells.push({ col, value: excelSerialToDate(num) })
            else cells.push({ col, value: num })
          }
        }
      }
    }
    if (cells.length > 0) rows.set(rowNumber, cells)
  }
  return rows
}

/** 解压并稀疏解析首个工作表为网格（行号→单元格数组），转为按 0 起索引的稀疏数组 */
function readGrid(buffer: Buffer): unknown[][] {
  const entries = readZipEntries(buffer)
  const sharedEntry = entries.find((e) => e.name === 'xl/sharedStrings.xml')
  const shared = sharedEntry ? parseSharedStrings(sharedEntry.data.toString('utf8')) : []
  const stylesEntry = entries.find((e) => e.name === 'xl/styles.xml')
  const dateXf = stylesEntry ? parseDateXfSet(stylesEntry.data.toString('utf8')) : new Set<number>()
  const sheetEntry = entries.find((e) => /^xl\/worksheets\/sheet1\.xml$/.test(e.name)) ?? entries.find((e) => /^xl\/worksheets\/.*\.xml$/.test(e.name))
  if (!sheetEntry) return []
  const rowsMap = parseSheetCells(sheetEntry.data.toString('utf8'), shared, dateXf)
  const grid: unknown[][] = []
  for (const [rowNumber, cells] of rowsMap) {
    const arr: unknown[] = []
    for (const cell of cells) arr[cell.col - 1] = cell.value
    grid[rowNumber - 1] = arr
  }
  return grid
}

// ---------------- 布局检测 ----------------

const TRANSPOSED_KEYWORDS = ['科目', '指标', '主要指标', '单体维度', '公司维度']

function detectStandardLayout(grid: unknown[][]): boolean {
  const headerRow = (grid[0] ?? []) as unknown[]
  const headers = headerRow.map((h) => (h == null ? '' : String(h).trim()))
  const hasCompany = headers.some((h) => h === '公司名' || h === '公司')
  const hasPeriod = headers.some((h) => h === '月份' || h === '期间')
  return hasCompany && hasPeriod
}

function isTransposedLayout(grid: unknown[][]): boolean {
  const first = grid[0]?.[0]
  if (first == null) return false
  const text = String(first).trim()
  return TRANSPOSED_KEYWORDS.some((kw) => text.includes(kw))
}

// ---------------- unpivot ----------------

function excelColLabel(index: number): string {
  let n = index
  let label = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    label = String.fromCharCode(65 + rem) + label
    n = Math.floor((n - 1) / 26)
  }
  return label
}

function toDate(cell: unknown): Date | null {
  if (cell instanceof Date) return cell
  if (typeof cell === 'number' && Number.isFinite(cell)) return excelSerialToDate(cell)
  if (typeof cell === 'string') {
    // 匹配 "YYYY年M月" / "YYYY-MM" / "YYYY/MM" / "YYYYMM"
    const m = cell.trim().match(/^(\d{4})\s*[年\-/]\s*(\d{1,2})\s*月?$/)
    if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1))
    // 纯6位数字 YYYYMM
    const m2 = cell.trim().match(/^(\d{4})(\d{2})$/)
    if (m2) return new Date(Date.UTC(Number(m2[1]), Number(m2[2]) - 1, 1))
    const d = new Date(cell)
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

function ym(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function parseValue(cell: unknown): { value: number | null; empty: boolean } {
  if (cell === undefined || cell === null || cell === '') return { value: null, empty: true }
  if (cell instanceof Date) return { value: null, empty: true }
  if (typeof cell === 'number') return { value: cell, empty: false }
  const n = Number(String(cell).replace(/,/g, '').trim())
  if (Number.isNaN(n)) return { value: null, empty: false }
  return { value: n, empty: false }
}

export function parseImportWorkbook(buffer: Buffer, template: ImportTemplate, resolvers: Resolvers): ParseResult {
  const result: ParseResult = { template, operating: [], static: [], budget: [], errors: [], dataRowCount: 0, sampleRows: { headers: [], rows: [] }, summary: emptySummary() }
  const fiscalStartMonth = getFiscalStartMonth()
  let grid: unknown[][]
  try {
    grid = readGrid(buffer)
  } catch (e) {
    result.errors.push({ row: 0, column: '-', message: e instanceof Error ? e.message : '文件解析失败' })
    return result
  }
  if (grid.length === 0) {
    result.errors.push({ row: 0, column: '-', message: '文件无有效数据' })
    return result
  }

  // 布局检测：标准布局（仅 operating）优先于转置布局
  const useStandard = template === 'operating' && !isTransposedLayout(grid) && detectStandardLayout(grid)
  if (useStandard) {
    parseStandardLayout(grid, resolvers, fiscalStartMonth, result)
  } else {
    parseTransposedLayout(grid, template, resolvers, fiscalStartMonth, result)
  }

  finalizeResult(result, resolvers)
  return result
}

/** 反转 名称→编码 Map 为 编码→名称（同 code 多名称时保留先出现者，即全名优先于简称） */
function reverseMap(map: Map<string, string>): Map<string, string> {
  const rev = new Map<string, string>()
  for (const [name, code] of map) if (!rev.has(code)) rev.set(code, name)
  return rev
}

/** 解析完成后单遍扫描：覆盖摘要、文件内重复检测、名称化等距分散采样 */
function finalizeResult(result: ParseResult, resolvers: Resolvers): void {
  const companyName = reverseMap(resolvers.companyByName)
  const subjectName = reverseMap(resolvers.subjectByName)

  // 统一抽取 (公司, 科目, 期间标签, 唯一键, 值)；唯一键与对应事实表 DB 约束一致
  interface Item { companyCode: string; accountCode: string; periodLabel: string; key: string; value: number }
  let items: Item[]
  let periodHeader: string
  if (result.template === 'operating') {
    periodHeader = '月份'
    items = result.operating.map((r) => ({ companyCode: r.companyCode, accountCode: r.accountCode, periodLabel: r.period, key: `${r.companyCode}|${r.accountCode}|${r.period}|${r.periodDimCode}`, value: r.value }))
  } else if (result.template === 'static') {
    periodHeader = '快照月'
    items = result.static.map((r) => ({ companyCode: r.companyCode, accountCode: r.accountCode, periodLabel: ym(r.snapshotDate), key: `${r.companyCode}|${r.accountCode}|${r.snapshotDate.toISOString()}|${r.periodDimCode}`, value: r.value }))
  } else {
    periodHeader = '财年'
    items = result.budget.map((r) => ({ companyCode: r.companyCode, accountCode: r.accountCode, periodLabel: r.fiscalYear, key: `${r.companyCode}|${r.accountCode}|${r.fiscalYear}|${r.period}`, value: r.value }))
  }

  const companies = new Set<string>()
  const subjects = new Set<string>()
  const periods = new Set<string>()
  const seenKeys = new Set<string>()
  let totalValue = 0
  let zeroValueCount = 0
  let duplicateCount = 0
  const duplicateSamples: string[] = []
  for (const it of items) {
    companies.add(it.companyCode)
    subjects.add(it.accountCode)
    periods.add(it.periodLabel)
    totalValue += it.value
    if (it.value === 0) zeroValueCount++
    if (seenKeys.has(it.key)) {
      duplicateCount++
      if (duplicateSamples.length < 5) {
        duplicateSamples.push(`${companyName.get(it.companyCode) ?? it.companyCode} × ${subjectName.get(it.accountCode) ?? it.accountCode} × ${it.periodLabel}`)
      }
    } else {
      seenKeys.add(it.key)
    }
  }
  const sortedPeriods = [...periods].sort()
  result.summary = {
    companyCount: companies.size,
    subjectCount: subjects.size,
    periodRange: { min: sortedPeriods[0] ?? null, max: sortedPeriods[sortedPeriods.length - 1] ?? null },
    periods: sortedPeriods,
    totalValue: Number(totalValue.toFixed(2)),
    zeroValueCount,
    duplicateCount,
    duplicateSamples,
    accountCodes: [...subjects],
  }

  // 等距分散采样（最多 20 行，跨科目/公司），显示名称（反查不到回退编码）
  const sampleTarget = 20
  const step = Math.max(1, Math.floor(items.length / sampleTarget))
  const rows: (string | number)[][] = []
  for (let i = 0; i < items.length && rows.length < sampleTarget; i += step) {
    const it = items[i]
    rows.push([subjectName.get(it.accountCode) ?? it.accountCode, companyName.get(it.companyCode) ?? it.companyCode, it.periodLabel, it.value])
  }
  result.sampleRows = { headers: ['科目', '公司', periodHeader, '值'], rows }
}

/** 标准布局解析（operating 专用）：行=公司×月份，列=科目 */
function parseStandardLayout(grid: unknown[][], resolvers: Resolvers, fiscalStartMonth: number, result: ParseResult): void {
  const headerRow = (grid[0] ?? []) as unknown[]
  const headers = headerRow.map((h) => (h == null ? '' : String(h).trim()))

  // 识别维度列
  let companyColIdx = -1
  let periodColIdx = -1
  for (let i = 0; i < headers.length; i++) {
    if (headers[i] === '公司名' || headers[i] === '公司') companyColIdx = i
    if (headers[i] === '月份' || headers[i] === '期间') periodColIdx = i
  }

  // 值列 = 除维度列外的其余列
  const valueCols: { colIdx: number; subjectName: string; accountCode: string | null }[] = []
  for (let i = 0; i < headers.length; i++) {
    if (i === companyColIdx || i === periodColIdx) continue
    if (!headers[i]) continue
    const accountCode = resolvers.subjectByName.get(headers[i]) ?? null
    if (!accountCode) {
      result.errors.push({ row: 1, column: excelColLabel(i + 1), message: `科目名未匹配：'${headers[i]}'` })
    }
    valueCols.push({ colIdx: i, subjectName: headers[i], accountCode })
  }

  for (let r = 1; r < grid.length; r++) {
    const row = grid[r] as unknown[] | undefined
    if (!row || row.length === 0) continue
    const companyName = row[companyColIdx] == null ? '' : String(row[companyColIdx]).trim()
    if (!companyName) continue
    result.dataRowCount++
    const companyCode = resolvers.companyByName.get(companyName) ?? null
    if (!companyCode) {
      result.errors.push({ row: r + 1, column: excelColLabel(companyColIdx + 1), message: `公司名未匹配：'${companyName}'` })
      continue
    }
    const date = toDate(row[periodColIdx])
    if (!date) {
      result.errors.push({ row: r + 1, column: excelColLabel(periodColIdx + 1), message: `月份无法解析：'${String(row[periodColIdx] ?? '')}'` })
      continue
    }
    const period = ym(date)
    const effFy = fyLabelOfDate(date, fiscalStartMonth)
    for (const vc of valueCols) {
      if (!vc.accountCode) continue
      const parsed = parseValue(row[vc.colIdx])
      if (parsed.empty) continue
      if (parsed.value === null) {
        result.errors.push({ row: r + 1, column: excelColLabel(vc.colIdx + 1), message: `值非数字：'${String(row[vc.colIdx])}'` })
        continue
      }
      const value = Number(parsed.value.toFixed(2))
      result.operating.push({ companyCode, accountCode: vc.accountCode, period, periodDimCode: OPERATING_DIMS.ACTUAL_MONTH, fiscalYear: effFy, value })
    }
  }
}

/** 转置布局解析（原有逻辑） */
function parseTransposedLayout(grid: unknown[][], template: ImportTemplate, resolvers: Resolvers, fiscalStartMonth: number, result: ParseResult): void {
  const companyRow = (grid[0] ?? []) as unknown[]
  const monthRow = template === 'budget' ? [] : ((grid[1] ?? []) as unknown[])
  const dataStart = template === 'budget' ? 1 : 2

  interface ColMeta { companyCode: string | null; companyName: string; date: Date | null; periodDimCode: string | null; label: string; effPeriod: string | null; effFy: string | null }
  const colMeta: (ColMeta | null)[] = []

  for (let c = 1; c < companyRow.length; c++) {
    const companyName = companyRow[c] == null ? '' : String(companyRow[c]).trim()
    if (!companyName) {
      colMeta[c] = null
      continue
    }
    const companyCode = resolvers.companyByName.get(companyName) ?? null
    const date = template === 'budget' ? null : toDate(monthRow[c])
    colMeta[c] = { companyCode, companyName, date, periodDimCode: null, label: excelColLabel(c), effPeriod: null, effFy: null }
  }

  if (template === 'operating') {
    for (let c = 1; c < colMeta.length; c++) {
      const m = colMeta[c]
      if (!m || !m.date) continue
      m.periodDimCode = OPERATING_DIMS.ACTUAL_MONTH
      m.effPeriod = ym(m.date)
      m.effFy = fyLabelOfDate(m.date, fiscalStartMonth)
    }
  } else if (template === 'static') {
    for (let c = 1; c < colMeta.length; c++) {
      const m = colMeta[c]
      if (!m || !m.date) continue
      m.periodDimCode = STATIC_DIMS.CURRENT_AMOUNT
      m.effFy = fyLabelOfDate(m.date, fiscalStartMonth)
    }
  }

  for (let r = dataStart; r < grid.length; r++) {
    const row = grid[r] as unknown[] | undefined
    if (!row || row.length === 0) continue
    const subjectName = row[0] == null ? '' : String(row[0]).trim()
    if (!subjectName) continue
    result.dataRowCount++
    const accountCode = resolvers.subjectByName.get(subjectName) ?? null
    if (!accountCode) {
      result.errors.push({ row: r + 1, column: 'A', message: `科目名未匹配：'${subjectName}'` })
      continue
    }
    for (let c = 1; c < row.length; c++) {
      const meta = colMeta[c]
      if (!meta) continue
      const parsed = parseValue(row[c])
      if (parsed.empty) continue
      if (parsed.value === null) {
        result.errors.push({ row: r + 1, column: meta.label, message: `值非数字：'${String(row[c])}'` })
        continue
      }
      if (!meta.companyCode) {
        result.errors.push({ row: r + 1, column: meta.label, message: `公司名未匹配：'${meta.companyName}'` })
        continue
      }
      const value = Number(parsed.value.toFixed(2))
      if (template === 'operating') {
        if (!meta.periodDimCode || !meta.effPeriod || !meta.effFy) continue
        result.operating.push({ companyCode: meta.companyCode, accountCode, period: meta.effPeriod, periodDimCode: meta.periodDimCode, fiscalYear: meta.effFy, value })
      } else if (template === 'static') {
        if (!meta.periodDimCode || !meta.date) continue
        result.static.push({ companyCode: meta.companyCode, accountCode, snapshotDate: meta.date, periodDimCode: meta.periodDimCode, fiscalYear: meta.effFy ?? fyLabelOfDate(meta.date, fiscalStartMonth), value })
      } else {
        result.budget.push({ companyCode: meta.companyCode, accountCode, fiscalYear: resolvers.defaultFiscalYear, period: 'annual', value })
      }
    }
  }
}
