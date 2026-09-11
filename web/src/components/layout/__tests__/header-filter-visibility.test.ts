import { describe, expect, it } from 'vitest'
import { getHeaderFilterVisibility } from '../header-filter-visibility'

describe('getHeaderFilterVisibility', () => {
  it('命中隐藏前缀的页面 → 两胶囊均隐藏', () => {
    const hiddenPaths = [
      '/admin',
      '/admin/users',
      '/admin/roles',
      '/admin/audit-logs',
      '/tools',
      '/tools/enterprise-lookup',
      '/reports',
      '/reports/analyses',
      '/reports/editor/r1',
      '/reports/r1/edit',
      '/data/reclassify',
      '/data/reclassify/consolidation',
      '/data/board',
      '/data/board/category',
      '/no-access',
    ]
    for (const pathname of hiddenPaths) {
      expect(getHeaderFilterVisibility(pathname), `路径 ${pathname} 应隐藏胶囊`).toEqual({
        showCompany: false,
        showPeriod: false,
      })
    }
  })

  it('未命中前缀的页面 → 两胶囊均显示', () => {
    const visiblePaths = [
      '/',
      '/dashboard',
      '/dashboard/analysis/key-metrics',
      '/indicators',
      '/indicators/operating',
      '/transactions',
      '/transactions/aging',
      '/transactions/collections/salesmen',
      '/inventory',
      '/data',
      '/data/browse',
      '/data/import',
      '/data/dimensions/formulas',
    ]
    for (const pathname of visiblePaths) {
      expect(getHeaderFilterVisibility(pathname), `路径 ${pathname} 应显示胶囊`).toEqual({
        showCompany: true,
        showPeriod: true,
      })
    }
  })

  it('前缀边界：相似但非子路径的前缀不误伤', () => {
    expect(getHeaderFilterVisibility('/data/reclassifyx')).toEqual({
      showCompany: true,
      showPeriod: true,
    })
    expect(getHeaderFilterVisibility('/adminx')).toEqual({
      showCompany: true,
      showPeriod: true,
    })
    expect(getHeaderFilterVisibility('/reportsx')).toEqual({
      showCompany: true,
      showPeriod: true,
    })
  })
})
