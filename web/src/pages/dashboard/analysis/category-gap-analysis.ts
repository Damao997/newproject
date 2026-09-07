import { formatMoneyWan } from '@/lib/utils'
import type { GapAnalysisItem } from '../core-metrics-gap-analysis'
import type { ProductBudgetRow } from '@/types'

/** 品类句内金额：0 → '0'（formatMoneyWan 的 0→'-' 适用于表格单元格，句式中显示「0万元」更通顺） */
function amt(v: number): string {
  return v === 0 ? '0' : formatMoneyWan(v)
}

/** 同比子句（累计口径，小数比率）：0/非有限值省略（品类句式紧凑，与样图一致不出现「同比持平」） */
function yoyClause(yoy: number): string | null {
  if (!Number.isFinite(yoy) || yoy === 0) return null
  return `同比${yoy > 0 ? '增长' : '下降'}${(Math.abs(yoy) * 100).toFixed(1)}%`
}

/** 单指标组段落：本月值 + 可选的累计完成 / 同比 / 财年完成率（各自独立判断，缺省省略）。
 * 入参为最小字段结构（ProductBudgetMetric / KeyMetricsGroup 均为超集），供品类/产品两套构建函数复用 */
export function segment(lead: string, monthActual: number, m: { ytdActual: number; ytdYoy: number; ytdRate: number | null }): string[] {
  const parts = [`${lead}${amt(monthActual)}万元`]
  if (m.ytdActual !== 0) parts.push(`累计完成${amt(m.ytdActual)}万元`)
  const yoy = yoyClause(m.ytdYoy)
  if (yoy) parts.push(yoy)
  if (m.ytdRate != null) parts.push(`财年完成率${m.ytdRate.toFixed(1)}%`)
  return parts
}

/**
 * 由品类预算达成行模板化生成差距分析句（纯函数，随期间/主体筛选自动重算，可复用于其他接入处）：
 * 【厨房产品】本月达成营收415万元，累计完成1,571万元，同比下降38.0%，财年完成率21.0%，达成毛利52万元，…；
 * - 收入段恒有「本月达成营收」，毛利段仅在本月/累计任一非 0 时出现（对齐样图：空调产品仅「达成毛利-2万元」）；
 * - 同比取累计口径 ytdYoy；0 省略子句；完成率 ytdRate=null（无预算）省略子句；
 * - 末条以「。」结尾，其余「；」。
 */
export function buildCategoryGapAnalysisItems(rows: ProductBudgetRow[]): GapAnalysisItem[] {
  return rows.map(({ category, income, profit }, i) => {
    const parts = segment('本月达成营收', income.monthActual, income)
    if (profit.monthActual !== 0 || profit.ytdActual !== 0) {
      parts.push(...segment('达成毛利', profit.monthActual, profit))
    }
    const end = i === rows.length - 1 ? '。' : '；'
    return { key: category, label: category, text: `【${category}】${parts.join('，')}${end}` }
  })
}
