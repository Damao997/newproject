import { segment } from './category-gap-analysis'
import type { GapAnalysisItem } from '../core-metrics-gap-analysis'
import type { ProductMetricsRow } from '@/types'

/** 表格行名约定层级：剥掉「其中：」前缀与前导空格（半角/全角），句子用干净产品名 */
function cleanName(name: string): string {
  return name.replace(/^[ \u3000]+/, '').replace(/^其中：/, '')
}

/**
 * 由品类核心指标行（产品配置全行）模板化生成差距分析句（纯函数，随期间/主体筛选自动重算）：
 * 【厨房产品】本月达成营收415万元，累计完成1,571万元，同比下降38.0%，财年完成率21.0%，达成毛利52万元，…；
 * - 句式与品类预算达成版一致（复用 segment）：收入段恒有「本月达成营收」，毛利段仅在本月/累计任一非 0 时出现；
 * - 同比取累计口径 ytdYoy（0 省略）；完成率取 annualRate（null=无预算省略）；合计行（整体口径）不生成；
 * - 末条以「。」结尾，其余「；」。
 */
export function buildProductGapAnalysisItems(rows: ProductMetricsRow[]): GapAnalysisItem[] {
  return rows.map(({ name, income, profit }, i) => {
    const label = cleanName(name)
    // KeyMetricsGroup 完成率字段名为 annualRate，适配 segment 的最小字段结构（ytdRate）
    const parts = segment('本月达成营收', income.monthActual, { ytdActual: income.ytdActual, ytdYoy: income.ytdYoy, ytdRate: income.annualRate })
    if (profit.monthActual !== 0 || profit.ytdActual !== 0) {
      parts.push(...segment('达成毛利', profit.monthActual, { ytdActual: profit.ytdActual, ytdYoy: profit.ytdYoy, ytdRate: profit.annualRate }))
    }
    const end = i === rows.length - 1 ? '。' : '；'
    return { key: name, label, text: `【${label}】${parts.join('，')}${end}` }
  })
}
