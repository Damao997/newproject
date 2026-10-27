import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { computeExpanded, groupChildren, IncomeSubjectPicker, type IncomeSubjectNode } from '../subject-code-picker'

const nodes: IncomeSubjectNode[] = [
  { code: 'PL01', name: '壹品慧收入', level: 1, parentCode: null },
  { code: 'PL0101', name: '销售收入', level: 2, parentCode: 'PL01' },
  { code: 'PL010101', name: '厨房电器销售', level: 3, parentCode: 'PL0101' },
  { code: 'PL010102', name: '净水设备销售', level: 3, parentCode: 'PL0101' },
  { code: 'PL0102', name: '服务收入', level: 2, parentCode: 'PL01' },
  { code: 'PL99', name: '孤儿科目', level: 2, parentCode: 'PL_MISSING' },
]

describe('groupChildren', () => {
  it('按 parentCode 挂载父子关系，孤儿节点挂到根层', () => {
    const map = groupChildren(nodes)
    expect(map.get(null)?.map((n) => n.code)).toEqual(['PL01', 'PL99'])
    expect(map.get('PL01')?.map((n) => n.code)).toEqual(['PL0101', 'PL0102'])
    expect(map.get('PL0101')?.map((n) => n.code)).toEqual(['PL010101', 'PL010102'])
    expect(map.get('PL010101')).toBeUndefined()
  })
})

describe('computeExpanded', () => {
  it('展开选中节点的全部祖先链', () => {
    const expanded = computeExpanded(nodes, new Set(['PL010101']))
    expect(expanded.has('PL01')).toBe(true)
    expect(expanded.has('PL0101')).toBe(true)
    expect(expanded.has('PL0102')).toBe(false)
  })

  it('选中根节点时无祖先可展开', () => {
    expect(computeExpanded(nodes, new Set(['PL01'])).size).toBe(0)
  })

  it('空选集返回空集合', () => {
    expect(computeExpanded(nodes, new Set()).size).toBe(0)
  })
})

const { treeState } = vi.hoisted(() => ({ treeState: { data: null as unknown[] | null } }))

vi.mock('@/hooks/api-queries', () => ({
  useSubjectTree: () => ({ data: treeState.data, isLoading: false }),
}))

function renderPicker(value: string[], onChange: (codes: string[]) => void) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IncomeSubjectPicker value={value} onChange={onChange} />
    </QueryClientProvider>,
  )
}

describe('IncomeSubjectPicker 组件行为', () => {
  beforeEach(() => {
    treeState.data = [
      { id: '1', code: 'PL01', name: '壹品慧收入', level: 1, parentCode: null, category: '壹品慧收入', direction: 'credit', isLeaf: false, dataType: 'data' },
      { id: '2', code: 'PL0101', name: '销售收入', level: 2, parentCode: 'PL01', category: '壹品慧收入', direction: 'credit', isLeaf: false, dataType: 'data' },
      { id: '3', code: 'PL010101', name: '厨房电器销售', level: 3, parentCode: 'PL0101', category: '壹品慧收入', direction: 'credit', isLeaf: true, dataType: 'data' },
      { id: '4', code: 'PL0501', name: '运营费用', level: 2, parentCode: null, category: '壹品慧费用', direction: 'debit', isLeaf: true, dataType: 'data' },
    ]
  })

  it('触发按钮按已选数量展示文案', () => {
    renderPicker([], vi.fn())
    expect(screen.getByRole('button', { name: /选择显式科目/ })).toBeInTheDocument()
    renderPicker(['PL010101'], vi.fn())
    expect(screen.getByRole('button', { name: /已选 1 个科目/ })).toBeInTheDocument()
  })

  it('仅展示收入类别候选，费用类别节点被过滤', () => {
    renderPicker([], vi.fn())
    fireEvent.click(screen.getByRole('button', { name: /选择显式科目/ }))
    expect(screen.getByText('壹品慧收入')).toBeInTheDocument()
    expect(screen.queryByText('运营费用')).not.toBeInTheDocument()
  })

  it('展开父节点后可勾选子科目，onChange 回传编码', () => {
    const onChange = vi.fn()
    renderPicker([], onChange)
    fireEvent.click(screen.getByRole('button', { name: /选择显式科目/ }))
    // 默认折叠，先展开「壹品慧收入」
    fireEvent.click(screen.getByRole('button', { name: '展开 壹品慧收入' }))
    fireEvent.click(screen.getByRole('button', { name: '展开 销售收入' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /厨房电器销售/ }))
    expect(onChange).toHaveBeenCalledWith(['PL010101'])
  })

  it('已选节点的祖先链默认展开，勾选框为选中态', () => {
    renderPicker(['PL010101'], vi.fn())
    fireEvent.click(screen.getByRole('button', { name: /已选 1 个科目/ }))
    // 选中叶子的祖先（壹品慧收入 → 销售收入）自动展开，无需手动点开
    const checkbox = screen.getByRole('checkbox', { name: /厨房电器销售/ })
    expect(checkbox).toBeChecked()
  })

  it('取消勾选时 onChange 回传移除后的编码', () => {
    const onChange = vi.fn()
    renderPicker(['PL010101', 'PL010102'], onChange)
    fireEvent.click(screen.getByRole('button', { name: /已选 2 个科目/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /厨房电器销售/ }))
    expect(onChange).toHaveBeenCalledWith(['PL010102'])
  })
})
