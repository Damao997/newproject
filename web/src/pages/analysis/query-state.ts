/**
 * 即席分析结果区状态判定（FE-03）。
 *
 * 首次加载、成功空、行名无匹配、失败、无权限、旧数据刷新失败必须互斥且不可互相冒充；
 * 期间加载失败也不能落入“暂无可用期间”。该函数不依赖 React，便于逐状态回归。
 */
export type AnalysisViewState =
  | 'period-loading'
  | 'period-error'
  | 'period-empty'
  | 'query-loading'
  | 'query-forbidden'
  | 'query-failure'
  | 'query-stale'
  | 'query-empty'
  | 'query-no-match'
  | 'query-ready'

export interface AnalysisViewStateInput {
  /** 当前是否已有可用期间（顶部筛选或期间列表回退值） */
  hasPeriod: boolean
  periodsPending: boolean
  periodsError: boolean
  queryPending: boolean
  queryError: boolean
  queryForbidden: boolean
  /** 已排除 placeholder 的当前范围真实数据 */
  hasData: boolean
  rowCount: number
  /** 行名关键字是否参与过滤：用于区分“成功空”和“无匹配” */
  keywordActive: boolean
}

export function resolveAnalysisViewState(input: AnalysisViewStateInput): AnalysisViewState {
  if (!input.hasPeriod) {
    if (input.periodsError) return 'period-error'
    if (input.periodsPending) return 'period-loading'
    return 'period-empty'
  }
  if (input.queryError && !input.hasData) return input.queryForbidden ? 'query-forbidden' : 'query-failure'
  if (!input.hasData) return 'query-loading'
  if (input.queryError) return 'query-stale'
  if (input.rowCount === 0) return input.keywordActive ? 'query-no-match' : 'query-empty'
  return 'query-ready'
}
