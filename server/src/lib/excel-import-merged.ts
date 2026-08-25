import * as XLSX from 'xlsx'
import {
  parseGridLayout,
  finalizeResult,
  mergeDuplicates,
  emptySummary,
  readAllSheetGrids,
  type ImportTemplate,
  type Resolvers,
  type ParseResult,
  type ValueUnit,
} from './excel-import'
import { getFiscalStartMonth } from './period'

/**
 * 多 Sheet 合并导入解析器：一个 xlsx 文件同时包含 经营数据/静态数据/现金流量数据 三个 Sheet，
 * 上传后按 Sheet 名自动识别类型（先精确匹配固定名，再前缀匹配），每个 Sheet 复用单类型布局解析。
 *
 * Sheet 识别规则：
 *  - 精确名：'经营数据' → operating；'静态数据' → static；'现金流量数据' → cashflow
 *  - 前缀（精确未命中时）：以 '经营' 开头 → operating；以 '静态' 开头 → static；以 '现金流' 开头 → cashflow
 *  - 无法识别的 Sheet 记入 ignoredSheets（不影响其他 Sheet 解析）
 *
 * 解析产物按类型分桶（operating/static/cashflow 各自的 ParseResult），仅含识别命中的类型。
 */

export type MergedSheetType = 'operating' | 'static' | 'cashflow'

const EXACT_SHEET_NAMES: Record<string, MergedSheetType> = {
  '经营数据': 'operating',
  '静态数据': 'static',
  '现金流量数据': 'cashflow',
}

const PREFIX_RULES: { prefix: string; type: MergedSheetType }[] = [
  { prefix: '经营', type: 'operating' },
  { prefix: '静态', type: 'static' },
  { prefix: '现金流', type: 'cashflow' },
]

/** Sheet 名 → 合并类型（精确名优先，其次前缀）；无法识别返回 null */
export function matchMergedSheet(sheetName: string): MergedSheetType | null {
  const trimmed = sheetName.trim()
  const exact = EXACT_SHEET_NAMES[trimmed]
  if (exact) return exact
  for (const rule of PREFIX_RULES) {
    if (trimmed.startsWith(rule.prefix)) return rule.type
  }
  return null
}

export interface MergedParseResult {
  operating: ParseResult | null
  static: ParseResult | null
  cashflow: ParseResult | null
  /** 无法识别类型的 Sheet 名清单（前端提示用） */
  ignoredSheets: string[]
}

function newResult(template: ImportTemplate): ParseResult {
  return { template, operating: [], static: [], budget: [], errors: [], dataRowCount: 0, sampleRows: { headers: [], rows: [] }, summary: emptySummary() }
}

/**
 * 合并工作簿解析：按 Sheet 名识别类型并逐 Sheet 走单类型布局解析。
 * 注意：Sheet 名清单经 XLSX.read 获取（快速、不解析单元格值）；每个 Sheet 的网格
 * 用项目自带稀疏 XML 解析器（readAllSheetGrids）读取——避开 xlsx 库 sheet_to_json
 * 对特定文件（含合并单元格/特殊数值）的死循环问题（SheetJS make_json_row 已知缺陷）。
 * @param resolversByType 各类型名称→编码解析器（由 ImportService.buildResolvers 按类型构建）
 * @param valueUnit 数值单位（元/万元，三表统一）
 */
export function parseMergedWorkbook(
  buffer: Buffer,
  resolversByType: Record<MergedSheetType, Resolvers>,
  valueUnit: ValueUnit = 'wan',
): MergedParseResult {
  const unitFactor = valueUnit === 'yuan' ? 0.0001 : 1
  const fiscalStartMonth = getFiscalStartMonth()
  const results: MergedParseResult = { operating: null, static: null, cashflow: null, ignoredSheets: [] }

  const wb = XLSX.read(buffer, { type: 'buffer' })
  const grids = readAllSheetGrids(buffer)
  for (let i = 0; i < wb.SheetNames.length; i++) {
    const sheetName = wb.SheetNames[i]
    const type = matchMergedSheet(sheetName)
    if (!type) {
      results.ignoredSheets.push(sheetName)
      continue
    }
    const grid = grids[i] ?? []
    if (grid.length === 0) continue
    const result = results[type] ?? newResult(type)
    // 每个 Sheet 独立布局检测与解析；同类型多 Sheet（如多个月度文件合并 Sheet）追加进同一 result
    parseGridLayout(grid, type as ImportTemplate, resolversByType[type], fiscalStartMonth, unitFactor, result)
    results[type] = result
  }

  // 收尾：对每个有数据的类型执行摘要/去重（依赖全量解析完成）
  for (const type of ['operating', 'static', 'cashflow'] as const) {
    const result = results[type]
    if (!result) continue
    finalizeResult(result, resolversByType[type])
    mergeDuplicates(result)
  }
  return results
}
