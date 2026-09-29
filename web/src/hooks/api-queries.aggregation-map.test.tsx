import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useAggregationMap, useAggregationMapAll } from './api-queries'

/**
 * H13 回归：useAggregationMapAll 无条件加载全量汇总映射。
 * 旧实现 useAggregationMap(null) 因 enabled: !!summaryCode 门禁永不请求，
 * 导致数据浏览页选中汇总主体后成员列全部消失。
 */

const mocks = vi.hoisted(() => ({ getAggregationMap: vi.fn() }))

vi.mock('@/lib/api', () => ({ api: { getAggregationMap: mocks.getAggregationMap } }))

const MAP_FIXTURE = [
  { id: 'm1', summaryCompanyCode: 'ET0001', singleCompanyCode: 'EN330001' },
  { id: 'm2', summaryCompanyCode: 'ET0001', singleCompanyCode: 'EN330002' },
]

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  mocks.getAggregationMap.mockReset()
  mocks.getAggregationMap.mockResolvedValue(MAP_FIXTURE)
  cleanup()
})

describe('useAggregationMapAll（H13 回归）', () => {
  it('不传 summaryCode 也发起请求并返回全量映射', async () => {
    const { result } = renderHook(() => useAggregationMapAll(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.getAggregationMap).toHaveBeenCalledWith(undefined)
    expect(result.current.data).toHaveLength(2)
  })

  it('useAggregationMap 保留按需门禁：null 时不请求（维度管理面板等调用方语义不变）', async () => {
    const { result } = renderHook(() => useAggregationMap(null), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
    expect(mocks.getAggregationMap).not.toHaveBeenCalled()
  })
})
