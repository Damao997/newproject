import { describe, expect, it } from 'vitest'
import { resolveAnalysisViewState, type AnalysisViewStateInput } from '../query-state'

/**
 * FE-03 状态矩阵回归：失败、无权限、旧数据刷新失败不得进入空/暂无分支。
 * A 慢 B 快属于请求键与 AbortSignal 行为，见 B2 浏览器脚本 t06-analysis-states.mjs。
 */
const base: AnalysisViewStateInput = {
  hasPeriod: true,
  periodsPending: false,
  periodsError: false,
  queryPending: false,
  queryError: false,
  queryForbidden: false,
  hasData: false,
  rowCount: 0,
  keywordActive: false,
}

describe('resolveAnalysisViewState', () => {
  it('期间：加载中、加载失败、确实为空三态互斥', () => {
    expect(resolveAnalysisViewState({ ...base, hasPeriod: false, periodsPending: true })).toBe('period-loading')
    expect(resolveAnalysisViewState({ ...base, hasPeriod: false, periodsError: true })).toBe('period-error')
    expect(resolveAnalysisViewState({ ...base, hasPeriod: false })).toBe('period-empty')
  })

  it('首次加载显示加载态，不显示空态', () => {
    expect(resolveAnalysisViewState({ ...base, queryPending: true })).toBe('query-loading')
  })

  it('无缓存失败 → 失败；403 → 无权限，均不得成为空', () => {
    expect(resolveAnalysisViewState({ ...base, queryError: true })).toBe('query-failure')
    expect(resolveAnalysisViewState({ ...base, queryError: true, queryForbidden: true })).toBe('query-forbidden')
  })

  it('成功空与无匹配分开表达', () => {
    expect(resolveAnalysisViewState({ ...base, hasData: true, rowCount: 0 })).toBe('query-empty')
    expect(resolveAnalysisViewState({ ...base, hasData: true, rowCount: 0, keywordActive: true })).toBe('query-no-match')
  })

  it('有旧数据且刷新失败 → 旧数据态，不被当成失败或新范围空', () => {
    expect(resolveAnalysisViewState({ ...base, hasData: true, rowCount: 3, queryError: true })).toBe('query-stale')
  })

  it('新范围加载中（旧数据仅作为 placeholder）→ 加载态，不冒充新范围结果', () => {
    expect(resolveAnalysisViewState({ ...base, hasData: false, rowCount: 0, queryPending: true })).toBe('query-loading')
  })

  it('重试成功后回到真实结果态', () => {
    const stale = resolveAnalysisViewState({ ...base, hasData: true, rowCount: 3, queryError: true })
    expect(stale).toBe('query-stale')
    expect(resolveAnalysisViewState({ ...base, hasData: true, rowCount: 3 })).toBe('query-ready')
    expect(resolveAnalysisViewState({ ...base, hasData: true, rowCount: 0 })).toBe('query-empty')
  })
})
