import { inflateRawSync } from 'node:zlib'
import { OPERATING_DIMS, STATIC_DIMS } from './metric-values'

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

export interface ParseResult {
  template: ImportTemplate
  operating: OperatingUnpivotRow[]
  static: StaticUnpivotRow[]
  budget: BudgetUnpivotRow[]
  errors: ImportError[]
  dataRowCount: number
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
    const d = new Date(cell)
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

function ym(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function fyOf(d: Date): string {
  return `FY${d.getUTCFullYear()}`
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
  const result: ParseResult = { template, operating: [], static: [], budget: [], errors: [], dataRowCount: 0 }
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

  const companyRow = (grid[0] ?? []) as unknown[]
  const monthRow = template === 'budget' ? [] : ((grid[1] ?? []) as unknown[])
  const dataStart = template === 'budget' ? 1 : 2

  interface ColMeta { companyCode: string | null; companyName: string; date: Date | null; periodDimCode: string | null; label: string }
  const colMeta: (ColMeta | null)[] = []

  for (let c = 1; c < companyRow.length; c++) {
    const companyName = companyRow[c] == null ? '' : String(companyRow[c]).trim()
    if (!companyName) {
      colMeta[c] = null
      continue
    }
    const companyCode = resolvers.companyByName.get(companyName) ?? null
    const date = template === 'budget' ? null : toDate(monthRow[c])
    colMeta[c] = { companyCode, companyName, date, periodDimCode: null, label: excelColLabel(c) }
  }

  if (template !== 'budget') {
    const datesByCompany = new Map<string, Set<number>>()
    for (let c = 1; c < colMeta.length; c++) {
      const m = colMeta[c]
      if (!m || !m.date) continue
      if (!datesByCompany.has(m.companyName)) datesByCompany.set(m.companyName, new Set())
      datesByCompany.get(m.companyName)!.add(m.date.getTime())
    }
    const rankByCompanyDate = new Map<string, number>()
    for (const [companyName, dateSet] of datesByCompany) {
      const sorted = Array.from(dateSet).sort((a, b) => b - a)
      sorted.forEach((t, idx) => rankByCompanyDate.set(`${companyName}|${t}`, idx))
    }
    for (let c = 1; c < colMeta.length; c++) {
      const m = colMeta[c]
      if (!m || !m.date) continue
      const rank = rankByCompanyDate.get(`${m.companyName}|${m.date.getTime()}`) ?? 0
      if (template === 'operating') {
        m.periodDimCode = rank === 0 ? OPERATING_DIMS.ACTUAL_MONTH : rank === 1 ? OPERATING_DIMS.SAME_PERIOD_ACTUAL : null
      } else {
        m.periodDimCode = rank === 0 ? STATIC_DIMS.CURRENT_AMOUNT : rank === 1 ? STATIC_DIMS.YEAR_START : null
      }
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
        if (!meta.periodDimCode || !meta.date) continue
        result.operating.push({ companyCode: meta.companyCode, accountCode, period: ym(meta.date), periodDimCode: meta.periodDimCode, fiscalYear: fyOf(meta.date), value })
      } else if (template === 'static') {
        if (!meta.periodDimCode || !meta.date) continue
        result.static.push({ companyCode: meta.companyCode, accountCode, snapshotDate: meta.date, periodDimCode: meta.periodDimCode, fiscalYear: fyOf(meta.date), value })
      } else {
        result.budget.push({ companyCode: meta.companyCode, accountCode, fiscalYear: resolvers.defaultFiscalYear, period: 'annual', value })
      }
    }
  }

  return result
}
