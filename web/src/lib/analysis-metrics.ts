/**
 * 即席分析「指标列」的前端目录 —— **仅用于列选择器的标签与分组**。
 *
 * ⚠️ 真正的口径、取值类型与取值一律以后端 `POST /dashboard/analysis/query`
 * 响应下发的 `columns[].{key,header,valueType,tip}` 为准（技术方案 D2：列定义由后端下发）。
 * 因此新增指标只需后端加定义，此处补一行标签即可，不影响已保存的查询。
 *
 * 与后端 `server/src/services/analysis/metric-catalog.ts` 保持对应关系：
 * key 命名规则一致 —— 单组维度用裸 key，多组维度用 `组名.key`，
 * marginRate 为跨组指标恒用裸 key。
 */

/** 单组维度（expense / subject）可用的指标：key 与后端 MetricCatalog 一致 */
export const SINGLE_GROUP_METRICS: { key: string; label: string; group: string }[] = [
  { key: 'monthBudget', label: '本月预算', group: '月度' },
  { key: 'monthActual', label: '本月达成', group: '月度' },
  { key: 'monthSame', label: '去年同期', group: '月度' },
  { key: 'monthChange', label: '同比变动额', group: '月度' },
  { key: 'monthYoy', label: '同比', group: '月度' },
  { key: 'monthMomChange', label: '环比变动额', group: '月度' },
  { key: 'monthMom', label: '环比', group: '月度' },
  { key: 'monthRate', label: '本月完成率', group: '月度' },
  { key: 'annualBudget', label: '财年预算目标', group: '累计' },
  { key: 'ytdBudget', label: '累计预算目标', group: '累计' },
  { key: 'ytdActual', label: '财年累计达成', group: '累计' },
  { key: 'ytdSame', label: '同期累计', group: '累计' },
  { key: 'ytdChange', label: '累计同比变动额', group: '累计' },
  { key: 'ytdYoy', label: '财年同比', group: '累计' },
  { key: 'annualRate', label: '年度完成率', group: '达成' },
  { key: 'deviation', label: '累计偏差额', group: '达成' },
  { key: 'alertRate', label: '预警达成率', group: '达成' },
  { key: 'share', label: '贡献占比', group: '达成' },
]

/** 跨组派生指标：不隶属任何单组，恒用裸 key，仅「收入 + 毛利」双组维度可用 */
export const CROSS_GROUP_METRICS: { key: string; label: string }[] = [
  { key: 'marginRate', label: '毛利率' },
]

/** 行维度 → 指标组（与后端 ROW_DIM_GROUPS 一致；长度 1 表示单组，key 不带前缀） */
export const ANALYSIS_DIM_GROUPS: Record<string, string[]> = {
  product: ['income', 'profit'],
  category: ['income', 'profit'],
  expense: ['value'],
  subject: ['value'],
  company: ['income', 'profit', 'netProfit'],
}

const GROUP_LABELS: Record<string, string> = { income: '收入', profit: '毛利', netProfit: '净利润' }

/** 该维度下可勾选的指标 key 全集（顺序即展示顺序；列序按它排序，与勾选顺序无关） */
export function analysisMetricKeys(rowDim: string): string[] {
  const groups = ANALYSIS_DIM_GROUPS[rowDim] ?? ['value']
  const keys: string[] = []
  if (groups.length === 1) {
    keys.push(...SINGLE_GROUP_METRICS.map((m) => m.key))
    return keys
  }
  for (const g of groups) {
    for (const m of SINGLE_GROUP_METRICS) keys.push(`${g}.${m.key}`)
  }
  // marginRate 需同时具备收入与毛利
  if (groups.includes('income') && groups.includes('profit')) keys.push(...CROSS_GROUP_METRICS.map((m) => m.key))
  return keys
}

/** 该维度下可勾选指标的展示分组（供多选面板分节） */
export function analysisMetricMenu(rowDim: string): { group: string; items: { key: string; label: string }[] }[] {
  const groups = ANALYSIS_DIM_GROUPS[rowDim] ?? ['value']
  if (groups.length === 1) {
    const byGroup = new Map<string, { key: string; label: string }[]>()
    for (const m of SINGLE_GROUP_METRICS) {
      const list = byGroup.get(m.group) ?? []
      list.push({ key: m.key, label: m.label })
      byGroup.set(m.group, list)
    }
    return [...byGroup.entries()].map(([group, items]) => ({ group, items }))
  }
  return groups.map((g) => ({
    group: GROUP_LABELS[g] ?? g,
    items: SINGLE_GROUP_METRICS.map((m) => ({ key: `${g}.${m.key}`, label: `${GROUP_LABELS[g] ?? g}·${m.label}` })),
  }))
}
