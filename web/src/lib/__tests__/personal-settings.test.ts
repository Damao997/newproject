import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFERENCES, preferenceSchema } from '../personal-settings'

describe('首页 KPI 偏好兼容', () => {
  it('旧缓存仅补月度显示模式，不重置主题、密度或常用公司', () => {
    const { dashboardKpiMode: _mode, ...legacy } = { ...DEFAULT_PREFERENCES, theme: 'dark' as const, indicatorDensity: 'dense' as const, favoriteCompanies: ['EN330001'] }
    expect(preferenceSchema.parse(legacy)).toEqual({ ...legacy, dashboardKpiMode: 'month' })
  })
  it('恢复合法累计模式，拒绝非法显示模式', () => {
    expect(preferenceSchema.parse({ ...DEFAULT_PREFERENCES, dashboardKpiMode: 'ytd' }).dashboardKpiMode).toBe('ytd')
    expect(preferenceSchema.safeParse({ ...DEFAULT_PREFERENCES, dashboardKpiMode: 'other' }).success).toBe(false)
  })
})
