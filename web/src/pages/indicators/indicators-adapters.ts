import { useOperatingIndicators, useStaticIndicators, useCashflowIndicators } from '@/hooks/api-queries'
import { OPERATING_COLUMNS, STATIC_COLUMNS, CASHFLOW_COLUMNS } from '@/components/subject-tree/metric-tree'
import type { OperatingRow, StaticRow, CashflowRow } from '@/hooks/api-queries'
import type { MetricValue } from '@/lib/metric-values'
import type { SubjectNode } from '@/types'

export type IndicatorSubjectType = 'operating' | 'static' | 'cashflow'

type Row = OperatingRow | StaticRow | CashflowRow

// 列设置面板元数据（复用 metric-tree 列配置，仅取 key/header）
const COLUMN_META: Record<IndicatorSubjectType, { key: string; header: string }[]> = {
  operating: OPERATING_COLUMNS.map((c) => ({ key: c.key, header: c.header })),
  static: STATIC_COLUMNS.map((c) => ({ key: c.key, header: c.header })),
  cashflow: CASHFLOW_COLUMNS.map((c) => ({ key: c.key, header: c.header })),
}

/** 将后端嵌套行转为 MetricTree 需要的结构树 + 数值 Map（原 index.tsx adapt，行为零变化） */
export function adapt(items: Row[], variant: IndicatorSubjectType): { nodes: SubjectNode[]; map: Map<string, MetricValue> } {
  const map = new Map<string, MetricValue>()
  const walk = (rows: Row[]): SubjectNode[] =>
    rows.map((r) => {
      if (variant === 'operating') {
        const o = r as OperatingRow
        map.set(o.code, { budget: o.budget, actual: o.actual, samePeriod: o.samePeriod, ytd: o.ytd, samePeriodYtd: o.samePeriodYtd })
      } else if (variant === 'cashflow') {
        const f = r as CashflowRow
        // 现金流映射到统一 MetricValue：本月→actual、同期→samePeriod、本年累计→ytd、同期累计→samePeriodYtd
        map.set(f.code, { budget: 0, actual: f.current, samePeriod: f.samePeriod, ytd: f.ytd, samePeriodYtd: f.samePeriodYtd })
      } else {
        const s = r as StaticRow
        // 静态科目映射到统一 MetricValue：本期→actual、同期→samePeriod、年初→ytd、上年年初→samePeriodYtd
        map.set(s.code, { budget: s.yearStart, actual: s.current, samePeriod: s.samePeriod, ytd: s.yearStart, samePeriodYtd: s.lastYearStart })
      }
      return {
        code: r.code, name: r.name, level: r.level, category: r.category,
        dataType: r.dataType as SubjectNode['dataType'],
        valueType: r.valueType,
        children: r.children ? walk(r.children as Row[]) : [],
      }
    })
  return { nodes: walk(items), map }
}

/** 收集含子节点的科目编码（用于全部展开） */
export function collectExpandableCodes(nodes: SubjectNode[]): string[] {
  const codes: string[] = []
  for (const node of nodes) {
    if (node.children.length > 0) {
      codes.push(node.code)
      codes.push(...collectExpandableCodes(node.children))
    }
  }
  return codes
}

/** 当前 tab 的列设置面板元数据（key/header；原 index.tsx 三态分支，行为零变化） */
export function buildColumnsFor(subjectType: IndicatorSubjectType): { key: string; header: string }[] {
  return COLUMN_META[subjectType]
}

/** 导出列 keys（按 tab 分区；原 index.tsx operating/cashflow/static 三分支 keys 数组） */
export function exportKeysFor(subjectType: IndicatorSubjectType): readonly string[] {
  if (subjectType === 'operating') {
    // 导出列顺序与表格一致（达成率归累计组尾）
    return ['budget', 'actual', 'samePeriod', 'yoy', 'ytd', 'samePeriodYtd', 'ytdYoy', 'achievement'] as const
  }
  if (subjectType === 'cashflow') {
    // 现金流量分支：本月/同比/本年累计/同期累计/累计同比（列顺序与表格一致）
    return ['actual', 'samePeriod', 'yoy', 'ytd', 'samePeriodYtd', 'ytdYoy'] as const
  }
  // 静态分支：本期/同期/变动率
  return ['actual', 'samePeriod', 'yoy'] as const
}

/** 当前 tab 数据源 query hook（经营/静态/现金流；enabled 与参数由调用方按挂载策略传入，原三分支选择） */
export function queryHookFor(subjectType: IndicatorSubjectType) {
  if (subjectType === 'operating') return useOperatingIndicators
  if (subjectType === 'cashflow') return useCashflowIndicators
  return useStaticIndicators
}

/**
 * 分型格式化：比率列乘 100 加 %，数量取整，金额保持数值（原 fmtVal）。
 * 同比统一按增长率百分比（后端已按增长率返回）由导出 hook 单独处理。
 */
export function valueFormatterFor(subjectType: IndicatorSubjectType): (v: number, vt: string) => string | number {
  // 三类型当前口径一致；subjectType 分支为后续分型差异预留
  void subjectType
  return (v, vt) => (vt === 'ratio' ? `${(v * 100).toFixed(1)}%` : vt === 'quantity' ? Math.round(v) : v)
}
