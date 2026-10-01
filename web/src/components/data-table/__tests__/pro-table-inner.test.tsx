import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import ProTableInner from '../pro-table-inner'

const captured = vi.hoisted(() => vi.fn())
vi.mock('@ant-design/pro-table', () => ({ default: (props: unknown) => { captured(props); return null } }))

describe('虚拟表格滚动边界', () => {
  it('计算所有视口减项，同时提供数值型横向滚动范围', () => {
    render(<ProTableInner columns={[{ key: 'name', header: '名称' }]} data={[]} rowKey={() => 'id'} maxHeight="calc(100dvh - 120px - 24px)" />)
    expect(captured.mock.lastCall?.[0].scroll).toEqual({ x: 1000, y: Math.max(120, window.innerHeight - 144) })
  })

  it('显式像素限高保持原值，宽表增加横向滚动范围', () => {
    render(<ProTableInner columns={Array.from({ length: 10 }, (_, i) => ({ key: String(i), header: `第${i}列` }))} data={[]} rowKey={() => 'id'} maxHeight="320px" />)
    expect(captured.mock.lastCall?.[0].scroll).toEqual({ x: 1400, y: 320 })
  })
})
