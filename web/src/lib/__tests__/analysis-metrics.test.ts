import { describe, it, expect } from 'vitest'
import { ANALYSIS_DIM_GROUPS, analysisMetricKeys, analysisMetricMenu, SINGLE_GROUP_METRICS } from '@/lib/analysis-metrics'
import type { AnalysisQuerySpec } from '@/types'

/**
 * 即席分析「指标列」前端目录（纯函数）。key 命名规则必须与后端
 * server/src/services/analysis/metric-catalog.ts 一致，否则勾选了却 400。
 */

const DIMS: AnalysisQuerySpec['rowDim'][] = ['product', 'category', 'expense', 'subject', 'company']

describe('analysis-metrics 指标目录', () => {
  it('五个维度都有指标组定义', () => {
    for (const dim of DIMS) expect(ANALYSIS_DIM_GROUPS[dim]).toBeDefined()
  })

  it('单组维度的 key 不带前缀，且等于全部 19 个直通派生指标', () => {
    for (const dim of ['expense', 'subject'] as const) {
      expect(ANALYSIS_DIM_GROUPS[dim]).toHaveLength(1)
      const keys = analysisMetricKeys(dim)
      expect(keys).toEqual(SINGLE_GROUP_METRICS.map((m) => m.key))
      expect(keys).toHaveLength(18)
      expect(keys.some((k) => k.includes('.'))).toBe(false)
    }
  })

  it('多组维度的 key 形如 `组名.key`', () => {
    const keys = analysisMetricKeys('product')
    expect(keys.filter((k) => k.startsWith('income.'))).toHaveLength(18)
    expect(keys.filter((k) => k.startsWith('profit.'))).toHaveLength(18)
  })

  it('marginRate 仅出现在「收入 + 毛利」双组维度，且为裸 key', () => {
    for (const dim of ['product', 'category', 'company'] as const) {
      expect(analysisMetricKeys(dim)).toContain('marginRate')
    }
    for (const dim of ['expense', 'subject'] as const) {
      expect(analysisMetricKeys(dim)).not.toContain('marginRate')
    }
    // 跨组指标恒用裸 key，不带任何组前缀
    expect(analysisMetricKeys('company').filter((k) => k === 'marginRate')).toEqual(['marginRate'])
  })

  it('company 维度含收入/毛利/净利润三组，共 3 × 18 + 1 项', () => {
    expect(ANALYSIS_DIM_GROUPS.company).toEqual(['income', 'profit', 'netProfit'])
    expect(analysisMetricKeys('company')).toHaveLength(3 * 18 + 1)
  })

  it('key 无重复（重复会让后端按同一列返回两次）', () => {
    for (const dim of DIMS) {
      const keys = analysisMetricKeys(dim)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  it('未定义维度回退为单组（不抛错）', () => {
    expect(ANALYSIS_DIM_GROUPS['unknown'] ?? ['value']).toEqual(['value'])
    expect(analysisMetricKeys('unknown')).toEqual(SINGLE_GROUP_METRICS.map((m) => m.key))
  })

  describe('多选面板分组', () => {
    it('单组维度按「月度 / 累计 / 达成」分节', () => {
      const menu = analysisMetricMenu('expense')
      expect(menu.map((m) => m.group)).toEqual(['月度', '累计', '达成'])
      expect(menu.flatMap((m) => m.items)).toHaveLength(18)
    })

    it('多组维度按「收入 / 毛利」分节，且条目带组名前缀便于区分', () => {
      const menu = analysisMetricMenu('product')
      expect(menu.map((m) => m.group)).toEqual(['收入', '毛利'])
      expect(menu[0].items[0]).toEqual({ key: 'income.monthBudget', label: '收入·本月预算' })
    })
  })
})
