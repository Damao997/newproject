import type { KeyMetricsGroup } from '../DashboardService'

/**
 * 指标字典（MetricCatalog）：即席分析「列」的定义与投影内核。
 *
 * 在 DashboardService.keyMetricsGroup（14 列口径内核）之上做「投影 + 派生」。
 * 全部为纯函数、无 IO，可独立单测。
 *
 * 派生指标口径严格对齐前端 core-metrics-content.tsx（否则同一数字在新旧页面
 * 显示不同，会被判定为口径不一致）：
 *   deviation   ← DeviationCell   累计偏差额 = 财年累计 − 累计预算目标（无/零预算 → null）
 *   alertRate   ← alertRateOf     预警达成率 = 财年累计 ÷ 累计预算目标 × 100（无/零预算 → null）
 *   share       ← shareRateOf     贡献占比 = 本行财年累计 ÷ 合计财年累计 × 100（合计 0 → null）
 *   marginRate  ← marginRateOf    毛利率 = 毛利财年累计 ÷ 收入财年累计 × 100（收入 0 → null）
 *
 * 为什么 share 必须下沉后端：即席分析下行集合由后端决定，前端拿不到「全貌」，
 * 占比的分母只能后端提供。
 */

export type MetricValueType = 'amount' | 'ratio' | 'quantity'

/** 指标列定义（后端下发，前端按 valueType 渲染） */
export interface MetricColumn {
  key: string
  header: string
  valueType: MetricValueType
  /** 表头分组（多指标组维度下为「收入」「毛利」「净利润」） */
  group?: string
  tip: string
}

/** 行内指标组集合：key = 组名（income / profit / netProfit / value） */
export type RowGroups = Record<string, KeyMetricsGroup>

/** 组名 → 展示标签（'' 表示单组维度，不加前缀） */
export const GROUP_LABELS: Record<string, string> = {
  income: '收入',
  profit: '毛利',
  netProfit: '净利润',
  value: '',
}

interface DeriveCtx {
  /** 当前组的 14 列口径 */
  group: KeyMetricsGroup
  /** 当前组名（share 取合计时按组名对齐） */
  groupName: string
  /** 该行全部组（marginRate 需同时读 income 与 profit） */
  groups: RowGroups
  /** 合计行的同名组（share 的分母） */
  totals?: RowGroups
}

interface MetricDef {
  header: string
  valueType: MetricValueType
  tip: string
  /** 直通：取 KeyMetricsGroup 同名字段 */
  field?: keyof KeyMetricsGroup
  /** 派生：由行上下文计算 */
  calc?: (c: DeriveCtx) => number | null
}

function round2(n: number): number {
  return Number(n.toFixed(2))
}

/** 直通指标（§5.1）：key 与 KeyMetricsGroup 字段同名 */
const DIRECT: Record<string, MetricDef> = {
  monthActual: { header: '本月达成', valueType: 'amount', tip: '本期实际', field: 'monthActual' },
  monthBudget: { header: '本月预算', valueType: 'amount', tip: '按财年占比拆分后的当月预算（无预算为 null）', field: 'monthBudget' },
  monthSame: { header: '去年同期', valueType: 'amount', tip: '上年同月实际', field: 'monthSame' },
  monthChange: { header: '同比变动额', valueType: 'amount', tip: '本期实际 − 去年同期', field: 'monthChange' },
  monthYoy: { header: '同比', valueType: 'ratio', tip: '（本期实际 − 去年同期）÷ |去年同期| × 100', field: 'monthYoy' },
  monthMomChange: { header: '环比变动额', valueType: 'amount', tip: '本期实际 − 上月实际', field: 'monthMomChange' },
  monthMom: { header: '环比', valueType: 'ratio', tip: '（本期实际 − 上月实际）÷ |上月实际| × 100', field: 'monthMom' },
  monthRate: { header: '本月完成率', valueType: 'ratio', tip: '本期实际 ÷ 当月预算 × 100（无预算为 null）', field: 'monthRate' },
  annualBudget: { header: '财年预算目标', valueType: 'amount', tip: '全年预算总额（无预算为 null）', field: 'annualBudget' },
  ytdBudget: { header: '累计预算目标', valueType: 'amount', tip: '财年预算 × 年初至当期占比前缀和（无预算为 null）', field: 'ytdBudget' },
  ytdActual: { header: '财年累计达成', valueType: 'amount', tip: '年初至当期的累计实际', field: 'ytdActual' },
  ytdSame: { header: '同期累计', valueType: 'amount', tip: '上年年初至上年同期累计', field: 'ytdSame' },
  ytdChange: { header: '累计同比变动额', valueType: 'amount', tip: '财年累计 − 同期累计', field: 'ytdChange' },
  ytdYoy: { header: '财年同比', valueType: 'ratio', tip: '（财年累计 − 同期累计）÷ |同期累计| × 100', field: 'ytdYoy' },
  annualRate: { header: '年度完成率', valueType: 'ratio', tip: '财年累计 ÷ 年度预算 × 100（无预算为 null）', field: 'annualRate' },
}

/** 派生指标（§5.2，原由前端计算，本方案下沉后端） */
const DERIVED: Record<string, MetricDef> = {
  deviation: {
    header: '累计偏差额',
    valueType: 'amount',
    tip: '财年累计达成 − 累计预算目标（无累计预算显示「—」）',
    calc: (c) => (c.group.ytdBudget == null || c.group.ytdBudget === 0 ? null : round2(c.group.ytdActual - c.group.ytdBudget)),
  },
  alertRate: {
    header: '预警达成率',
    valueType: 'ratio',
    tip: '财年累计达成 ÷ 累计预算目标 × 100（<60 红 / 60–75 黄 / ≥75 绿；无累计预算为 null）',
    calc: (c) => (c.group.ytdBudget == null || c.group.ytdBudget === 0 ? null : round2((c.group.ytdActual / c.group.ytdBudget) * 100)),
  },
  share: {
    header: '贡献占比',
    valueType: 'ratio',
    tip: '本行财年累计 ÷ 合计财年累计 × 100（合计为 0 为 null）',
    calc: (c) => {
      const total = c.totals?.[c.groupName]
      if (!total || total.ytdActual === 0) return null
      return round2((c.group.ytdActual / total.ytdActual) * 100)
    },
  },
  marginRate: {
    header: '毛利率',
    valueType: 'ratio',
    tip: '毛利财年累计 ÷ 收入财年累计 × 100（仅含「收入 + 毛利」双组的维度可用）',
    calc: (c) => {
      const income = c.groups.income?.ytdActual ?? 0
      const profit = c.groups.profit?.ytdActual ?? 0
      return income === 0 ? null : round2((profit / income) * 100)
    },
  },
}

/** 全部合法指标 key（未加组前缀） */
export const METRIC_KEYS: readonly string[] = [...Object.keys(DIRECT), ...Object.keys(DERIVED)]

/** 跨组派生指标：不隶属于任何指标组（如 marginRate 同时读收入与毛利），故恒用裸 key */
const CROSS_GROUP_METRICS = new Set(['marginRate'])

export function isMetricKey(key: string): boolean {
  return key in DIRECT || key in DERIVED
}

/** 解析投影 key：单组维度用裸 key，多组维度用 `组名.key`；跨组指标恒用裸 key */
export function parseMetricKey(valueKey: string, groupNames: string[]): { groupName: string; metricKey: string } | null {
  if (CROSS_GROUP_METRICS.has(valueKey)) return { groupName: '', metricKey: valueKey }
  if (groupNames.length <= 1) {
    return isMetricKey(valueKey) ? { groupName: groupNames[0] ?? 'value', metricKey: valueKey } : null
  }
  const dot = valueKey.indexOf('.')
  if (dot <= 0) return null
  const groupName = valueKey.slice(0, dot)
  const metricKey = valueKey.slice(dot + 1)
  if (!groupNames.includes(groupName) || !isMetricKey(metricKey)) return null
  return { groupName, metricKey }
}

/** 指标 key 是否可用于该维度（供 service 做 400 校验，不静默忽略非法 key） */
export function isValidMetricForDim(valueKey: string, groupNames: string[]): boolean {
  // 跨组指标仅在同时具备「收入 + 毛利」两组的维度可用
  if (CROSS_GROUP_METRICS.has(valueKey)) return groupNames.includes('income') && groupNames.includes('profit')
  return parseMetricKey(valueKey, groupNames) !== null
}

/** 该维度下的默认指标列集（§4.2「缺省取该 rowDim 的默认列集」） */
export const DEFAULT_METRICS: Record<string, string[]> = {
  product: ['income.ytdBudget', 'income.ytdActual', 'income.deviation', 'income.alertRate', 'income.ytdYoy', 'income.share', 'profit.ytdBudget', 'profit.ytdActual', 'profit.deviation', 'profit.alertRate', 'marginRate'],
  category: ['income.ytdBudget', 'income.ytdActual', 'income.deviation', 'income.alertRate', 'income.ytdYoy', 'income.share', 'profit.ytdBudget', 'profit.ytdActual', 'profit.deviation', 'profit.alertRate', 'marginRate'],
  expense: ['monthBudget', 'monthActual', 'monthRate', 'ytdBudget', 'ytdActual', 'alertRate', 'ytdYoy'],
  subject: ['monthBudget', 'monthActual', 'monthRate', 'ytdBudget', 'ytdActual', 'annualRate', 'ytdYoy'],
  company: ['income.ytdBudget', 'income.ytdActual', 'income.alertRate', 'profit.ytdBudget', 'profit.ytdActual', 'profit.alertRate', 'netProfit.ytdBudget', 'netProfit.ytdActual', 'netProfit.alertRate'],
}

/** 列定义（顺序与 valueKeys 一致，后端下发） */
export function columnsFor(valueKeys: string[], groupNames: string[]): MetricColumn[] {
  const multi = groupNames.length > 1
  return valueKeys.map((vk) => {
    const parsed = parseMetricKey(vk, groupNames)
    const metricKey = parsed?.metricKey ?? vk
    const def = DIRECT[metricKey] ?? DERIVED[metricKey]
    const label = GROUP_LABELS[parsed?.groupName ?? ''] ?? parsed?.groupName ?? ''
    return {
      key: vk,
      header: multi && label ? `${label}·${def.header}` : def.header,
      valueType: def.valueType,
      group: multi && label ? label : undefined,
      tip: def.tip,
    }
  })
}

function metricValue(group: KeyMetricsGroup, metricKey: string, ctx: DeriveCtx): number | null {
  const direct = DIRECT[metricKey]
  if (direct?.field) {
    const v = group[direct.field]
    return v == null ? null : v
  }
  const derived = DERIVED[metricKey]
  return derived?.calc ? derived.calc(ctx) : null
}

/** 单行投影：产出 { valueKey → 值|null }（null = 不适用/无预算，前端显示「—」） */
export function projectRow(
  groups: RowGroups,
  valueKeys: string[],
  groupNames: string[],
  totals?: RowGroups,
): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const vk of valueKeys) {
    const parsed = parseMetricKey(vk, groupNames)
    // 跨组指标的 groupName 为 ''，以首组作为上下文锚点（其 calc 只读 groups，不读 group）
    const anchor = parsed ? (parsed.groupName ? groups[parsed.groupName] : groups[groupNames[0]]) : undefined
    if (!parsed || !anchor) {
      out[vk] = null
      continue
    }
    out[vk] = metricValue(anchor, parsed.metricKey, { group: anchor, groupName: parsed.groupName, groups, totals })
  }
  return out
}
