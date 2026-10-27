import type { AnalysisMetricColumn, AnalysisQueryRow, AnalysisColMember } from '@/types'

/**
 * 即席分析结果 CSV 导出（L1-4，见 docs/plans/即席分析-L1L2-阶段方案.md §2.4）。
 *
 * 纯函数构建 CSV 文本（含 BOM 的拼接由调用方加，便于测试）：
 *   - 单轴：表头 = 指标列，末行 = 合计
 *   - 矩阵：两级表头压平为「成员 · 指标」的单行复合表头（Excel 无合并单元格也能对齐）
 *   - null → 空单元格（不用 "null"/"NaN" 字符串污染表格）
 *   - 字段含逗号/引号/换行时按 RFC 4180 双引号转义
 */

const TOTAL_COL = '__total'
const TOTAL_LABEL = '小计'

function escapeCell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

function formatValue(value: number | null, column: AnalysisMetricColumn): string {
  if (value == null) return ''
  if (column.valueType === 'ratio') return value.toFixed(1)
  return String(value)
}

/** 单元格值（矩阵含小计列） */
function cellOf(row: AnalysisQueryRow, memberCode: string | null, key: string): number | null {
  if (memberCode === null) return row.values[key] ?? null
  if (memberCode === TOTAL_COL) return row.values[key] ?? null
  return row.cells?.[memberCode]?.[key] ?? null
}

/**
 * 构建 CSV 文本（不含 BOM）。列序 = columns 顺序；矩阵模式列 = 成员 × 指标（末尾小计）。
 * isTotal 行（后端合计行）与 totals（总计行，tfoot）都会导出；空数据返回空字符串。
 */
export function buildAnalysisCsv(
  columns: AnalysisMetricColumn[],
  rows: AnalysisQueryRow[],
  colMembers?: AnalysisColMember[],
  totals?: { values: Record<string, number | null> },
  totalsLabel = '合计',
): string {
  if (columns.length === 0 || rows.length === 0) return ''
  const memberCols: { code: string | null; prefix: string }[] = colMembers
    ? [...colMembers.map((m) => ({ code: m.code as string | null, prefix: m.name })), { code: TOTAL_COL, prefix: TOTAL_LABEL }]
    : [{ code: null, prefix: '' }]

  const lines: string[] = []
  lines.push(['行', ...memberCols.flatMap((m) => columns.map((c) => (m.prefix ? `${m.prefix} · ${c.header}` : c.header)))].map(escapeCell).join(','))
  const pushRow = (name: string, get: (memberCode: string | null, key: string) => number | null) => {
    lines.push([name, ...memberCols.flatMap((m) => columns.map((c) => formatValue(get(m.code, c.key), c)))].map(escapeCell).join(','))
  }
  for (const row of rows) pushRow(row.isTotal ? totalsLabel : row.name, (mc, k) => cellOf(row, mc, k))
  // 总计行只导单轴模式：矩阵模式后端只给全量 totals，逐成员总计无数据支撑（小计列已含行级全口径）
  if (totals && !colMembers) pushRow(totalsLabel, (_mc, k) => totals.values[k] ?? null)
  return lines.join('\r\n')
}

/** 触发浏览器下载（BOM 保 Excel 中文不乱码）；空内容不触发 */
export function downloadCsv(fileName: string, csv: string): void {
  if (!csv) return
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/** 导出文件名：即席分析_<rowDim>_<period>.csv */
export function analysisCsvFileName(rowDim: string, period: string): string {
  return `即席分析_${rowDim}_${period || 'unknown'}.csv`
}
