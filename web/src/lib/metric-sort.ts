import type { SubjectNode } from '@/types'
import { calcAchievement, calcYoy, calcYtdYoy, type MetricValue } from '@/lib/metric-values'

/** 可排序指标键：金额列取原始字段，比率列按口径计算（与表格展示一致） */
export type MetricSortKey = 'budget' | 'actual' | 'samePeriod' | 'yoy' | 'achievement' | 'ytd' | 'samePeriodYtd' | 'ytdYoy'

export type MetricSortDirection = 'asc' | 'desc'

export interface MetricSortOptions {
  /** 参与排序的最浅层级（默认 0 全部；经营指标传 1：分类根不排序，保持分类列 rowSpan 分组顺序） */
  fromLevel?: number
}

/** 指标键 → 排序数值（同比/达成率/累计同比按展示口径计算，与单元格渲染一致） */
export function metricValueOf(key: MetricSortKey, mv: MetricValue): number {
  switch (key) {
    case 'budget': return mv.budget
    case 'actual': return mv.actual
    case 'samePeriod': return mv.samePeriod
    case 'ytd': return mv.ytd
    case 'samePeriodYtd': return mv.samePeriodYtd
    case 'yoy': return calcYoy(mv)
    case 'achievement': return calcAchievement(mv)
    case 'ytdYoy': return calcYtdYoy(mv)
  }
}

/**
 * 树形同级排序：对每层兄弟节点按指标值排序，父节点值不变、层级结构不被破坏；
 * 无值（valueMap 缺失）的节点排最后且保持相对顺序。纯函数，不修改入参。
 */
export function sortTreeByLevel(
  nodes: SubjectNode[],
  valueMap: Map<string, MetricValue>,
  key: MetricSortKey,
  direction: MetricSortDirection,
  options: MetricSortOptions = {},
): SubjectNode[] {
  const { fromLevel = 0 } = options
  const factor = direction === 'asc' ? 1 : -1
  const sortLevel = (ns: SubjectNode[], level: number): SubjectNode[] => {
    let sorted = ns
    if (level >= fromLevel) {
      sorted = [...ns].sort((a, b) => {
        const va = valueMap.get(a.code)
        const vb = valueMap.get(b.code)
        if (!va) return 1
        if (!vb) return -1
        return (metricValueOf(key, va) - metricValueOf(key, vb)) * factor
      })
    }
    return sorted.map((n) => ({ ...n, children: sortLevel(n.children, level + 1) }))
  }
  return sortLevel(nodes, 0)
}
