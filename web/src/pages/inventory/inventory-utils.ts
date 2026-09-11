import type { InventoryDetailRow } from '@/hooks/api-queries'

// ===== 明细表：维度模型与排序 =====

export type DetailDim = 'company' | 'category' | 'detail'

/** 明细表统一行模型：三种维度（按公司汇总/按品类展开/公司×品类明细）共用一条流水线 */
export interface ViewRow {
  /** 公司: `c:${code}`；品类: `k:${code}`；明细: `${companyCode}-${categoryCode}` */
  key: string
  /** 粘性列展示：公司显示名 / 品类名 / 公司显示名 */
  label: string
  /** 仅公司模式携带，供公司级「分析」取目标公司 */
  company?: { code: string; name: string }
  /** 仅明细模式携带，供行级「分析」取公司×品类上下文 */
  detail?: InventoryDetailRow
  /** 预拼接小写搜索文本：label + 编码 +（明细模式）品类名/编码 */
  searchText: string
  current: number
  yearStart: number
  samePeriod: number
  /** 公司模式用于指标上下文 samePeriodYtd */
  lastYearStart: number
  /** 聚合行按汇总值重算；无口径 NaN */
  yoy: number
}

export type SortKey = 'current' | 'yearStart' | 'vsYearStart' | 'samePeriod' | 'yoy'
export interface SortState { key: SortKey; dir: 'asc' | 'desc' }

/** 排序取值：较年初/同比为派生比率，分母为 0 无口径返回 NaN（排序时恒置末尾） */
export function sortValue(row: ViewRow, key: SortKey): number {
  switch (key) {
    case 'current': return row.current
    case 'yearStart': return row.yearStart
    case 'samePeriod': return row.samePeriod
    case 'vsYearStart': return row.yearStart ? ((row.current - row.yearStart) / row.yearStart) * 100 : Number.NaN
    case 'yoy': return row.samePeriod ? row.yoy : Number.NaN
  }
}

export function makeComparator(sort: SortState) {
  return (a: ViewRow, b: ViewRow) => {
    const av = sortValue(a, sort.key)
    const bv = sortValue(b, sort.key)
    const an = !Number.isFinite(av)
    const bn = !Number.isFinite(bv)
    if (an && bn) return 0
    if (an) return 1
    if (bn) return -1
    return sort.dir === 'asc' ? av - bv : bv - av
  }
}

/** 金额两位小数舍入（聚合行显示/导出口径） */
export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** 空明细稳定引用：避免 `?? []` 每次渲染新建数组导致下游 memo 失效 */
export const EMPTY_ROWS: InventoryDetailRow[] = []

/** 数值列导出定义（较年初/同比以带符号百分比文本导出，无口径 '-'） */
export const NUMERIC_EXPORT_COLUMNS = [
  { header: '本期金额(万)', key: 'current', width: 14 },
  { header: '年初金额(万)', key: 'yearStart', width: 14 },
  { header: '较年初', key: 'vsYearStart', width: 10 },
  { header: '同期金额(万)', key: 'samePeriod', width: 14 },
  { header: '同比', key: 'yoy', width: 10 },
]

/** 各维度导出列（首列=维度标识列；明细模式为公司+品类两列） */
export function exportColumns(dim: DetailDim) {
  if (dim === 'detail') {
    return [
      { header: '公司', key: 'company', width: 24 },
      { header: '品类', key: 'category', width: 18 },
      ...NUMERIC_EXPORT_COLUMNS,
    ]
  }
  return [
    { header: dim === 'company' ? '公司' : '品类', key: 'label', width: dim === 'company' ? 24 : 18 },
    ...NUMERIC_EXPORT_COLUMNS,
  ]
}

/** 各维度：卡片标题 / 空态标题与提示 / 可访问区域名 / 搜索无匹配提示 */
export const DIM_TITLES: Record<DetailDim, string> = {
  company: '库存金额汇总 · 按公司',
  category: '库存金额汇总 · 按品类',
  detail: '公司 × 品类明细',
}
export const DIM_EMPTY_TITLES: Record<DetailDim, string> = {
  company: '暂无公司数据',
  category: '暂无品类数据',
  detail: '暂无存货数据',
}
export const DIM_EMPTY_HINTS: Record<DetailDim, string> = {
  company: '当前公司/期间无存货数据，请调整筛选条件',
  category: '当前公司/期间无存货品类数据，请调整筛选条件',
  detail: '当前公司/期间无存货品类数据，请调整筛选条件',
}
export const DIM_REGION_LABELS: Record<DetailDim, string> = {
  company: '库存金额汇总（按公司）',
  category: '库存金额汇总（按品类）',
  detail: '公司×品类明细',
}
export const DIM_SEARCH_EMPTY_HINTS: Record<DetailDim, string> = {
  company: '未找到匹配的公司，请调整品类钻取、搜索关键词',
  category: '未找到匹配的品类，请调整品类钻取、搜索关键词',
  detail: '未找到匹配的公司或品类，请调整品类钻取、搜索关键词',
}

/** 周转天数展示：无口径（0）显示 '-' */
export function formatDays(v: number): string {
  return v > 0 ? `${v.toFixed(1)} 天` : '-'
}
