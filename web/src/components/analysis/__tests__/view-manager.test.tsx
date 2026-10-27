import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom'
import { FormNavigationProvider } from '@/components/forms/form-navigation'
import { ViewManager } from '@/components/analysis/view-manager'
import type { AnalysisQuerySpec, AnalysisViewItem } from '@/types'

/**
 * 视图管理组件测试（FE-04）。
 * hooks mock；路由与关闭保护使用真实 FormNavigationProvider，验证：
 * - 保存/更新/删除走服务端返回 + 重新查询确认
 * - 空表单直接关闭；脏态确认；保存中防重复与关闭；失败保留输入
 * - 对象切换（编辑另一视图）不残留上一对象输入；关闭后焦点返回触发元素
 */

const { viewsState, mutationsState } = vi.hoisted(() => ({
  viewsState: {
    data: undefined as { views: AnalysisViewItem[] } | undefined,
    isPending: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  mutationsState: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  },
}))

vi.mock('@/hooks/api-queries', () => ({
  useAnalysisViews: () => viewsState,
  useAnalysisViewMutations: () => mutationsState,
}))

const spec: AnalysisQuerySpec = {
  period: '2026-09',
  rowDim: 'category',
  colDim: 'company',
  colCodes: ['EN330058', 'EN100068'],
  metrics: ['income.monthActual'],
  filters: { keyword: '厨房' },
  options: { includeTotals: true },
}

const mine: AnalysisViewItem = {
  id: 'v1', name: '我的品类视图', ownerId: 'u1', ownerName: '张三', shared: false,
  spec: { period: '2026-09', rowDim: 'category', metrics: [] }, isOwner: true,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
}
const mine2: AnalysisViewItem = {
  ...mine, id: 'v3', name: '我的费用视图', spec: { period: '2026-09', rowDim: 'expense', metrics: [] },
}
const others: AnalysisViewItem = {
  id: 'v2', name: '共享视图', ownerId: 'u2', ownerName: '李四', shared: true,
  spec: { period: '2026-09', rowDim: 'product', metrics: ['income.monthActual'] }, isOwner: false,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-03T00:00:00.000Z',
}

function renderManager(onApply = vi.fn()) {
  const router = createMemoryRouter([{
    element: <FormNavigationProvider><Outlet /></FormNavigationProvider>,
    children: [{ path: '/', element: <ViewManager spec={spec} onApply={onApply} /> }],
  }], { initialEntries: ['/'] })
  render(<RouterProvider router={router} />)
  return { onApply, router }
}

const openSaveDialog = () => {
  const trigger = screen.getByRole('button', { name: /保存为视图/ })
  trigger.focus()
  fireEvent.click(trigger)
}
const nameInput = () => screen.getByLabelText('视图名称')
const saveButton = () => screen.getByRole('button', { name: '保存' })
const pressEscape = () => {
  const wraps = document.querySelectorAll('.ant-modal-wrap')
  fireEvent.keyDown(wraps[wraps.length - 1], { key: 'Escape', code: 'Escape', keyCode: 27 })
}
const focusClick = (element: HTMLElement) => {
  element.focus()
  fireEvent.click(element)
}

describe('ViewManager 视图管理', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    viewsState.data = undefined
    viewsState.isPending = false
    viewsState.isError = false
    viewsState.error = null
    viewsState.refetch.mockResolvedValue({ isError: false, data: { views: [] } })
    mutationsState.create.mutateAsync.mockResolvedValue({ ...mine, id: 'new' })
    mutationsState.update.mutateAsync.mockResolvedValue(mine)
    mutationsState.remove.mutateAsync.mockResolvedValue({ id: 'v1' })
    mutationsState.create.isPending = false
    mutationsState.update.isPending = false
    mutationsState.remove.isPending = false
  })

  it('保存：名称单源提交，服务端返回后重新查询确认并恢复焦点', async () => {
    const created = { ...mine, id: 'new', name: '月度达成看板' }
    mutationsState.create.mutateAsync.mockResolvedValue(created)
    viewsState.refetch.mockResolvedValue({ isError: false, data: { views: [created, mine] } })
    renderManager()
    openSaveDialog()
    fireEvent.change(nameInput(), { target: { value: '月度达成看板' } })
    fireEvent.click(screen.getByLabelText('共享给团队成员'))
    fireEvent.click(saveButton())
    await waitFor(() => {
      expect(mutationsState.create.mutateAsync).toHaveBeenCalledWith({ name: '月度达成看板', spec, shared: true })
    })
    await waitFor(() => expect(viewsState.refetch).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByLabelText('视图名称')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /保存为视图/ })))
  })

  it('名称为空时前端拦截，不提交', async () => {
    renderManager()
    openSaveDialog()
    fireEvent.click(saveButton())
    expect(await screen.findByText('请输入视图名称')).toBeInTheDocument()
    expect(mutationsState.create.mutateAsync).not.toHaveBeenCalled()
  })

  it('保存失败：展示原因、保留输入且不关闭', async () => {
    mutationsState.create.mutateAsync.mockRejectedValue({ response: { data: { message: '单人视图数已达上限 50' } } })
    viewsState.refetch.mockRejectedValue(new Error('列表刷新失败'))
    renderManager()
    openSaveDialog()
    fireEvent.change(nameInput(), { target: { value: '超量视图' } })
    fireEvent.click(saveButton())
    expect(await screen.findByText(/保存失败：单人视图数已达上限 50/)).toBeInTheDocument()
    expect(nameInput()).toHaveValue('超量视图')
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument()
  })

  it('服务端声称成功但列表未确认时不关闭并提示', async () => {
    const created = { ...mine, id: 'new', name: '未确认视图' }
    mutationsState.create.mutateAsync.mockResolvedValue(created)
    viewsState.refetch.mockResolvedValue({ isError: false, data: { views: [] } })
    renderManager()
    openSaveDialog()
    fireEvent.change(nameInput(), { target: { value: '未确认视图' } })
    fireEvent.click(saveButton())
    expect(await screen.findByText(/视图列表未包含该视图/)).toBeInTheDocument()
    expect(nameInput()).toHaveValue('未确认视图')
  })

  it('脏态 Escape 需确认；继续编辑保留输入，放弃后关闭', async () => {
    renderManager()
    openSaveDialog()
    fireEvent.change(nameInput(), { target: { value: '评审草稿-不保存' } })
    pressEscape()
    expect(await screen.findByText('放弃未保存的修改？')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '继续编辑' }))
    await waitFor(() => expect(nameInput()).toHaveValue('评审草稿-不保存'))
    pressEscape()
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }))
    await waitFor(() => expect(screen.queryByLabelText('视图名称')).toBeNull())
    expect(mutationsState.create.mutateAsync).not.toHaveBeenCalled()
  })

  it('空表单 Escape 直接关闭，不弹放弃确认', async () => {
    renderManager()
    openSaveDialog()
    pressEscape()
    await waitFor(() => expect(screen.queryByLabelText('视图名称')).toBeNull())
    expect(screen.queryByText('放弃未保存的修改？')).toBeNull()
  })

  it('保存中：重复点击只提交一次，Escape 不关闭并提示等待', async () => {
    let resolveCreate: (value: AnalysisViewItem) => void = () => {}
    mutationsState.create.mutateAsync.mockImplementation(() => new Promise((resolve) => { resolveCreate = resolve }))
    viewsState.refetch.mockResolvedValue({ isError: false, data: { views: [{ ...mine, id: 'new', name: '慢保存视图' }] } })
    renderManager()
    openSaveDialog()
    fireEvent.change(nameInput(), { target: { value: '慢保存视图' } })
    fireEvent.click(saveButton())
    await waitFor(() => expect(mutationsState.create.mutateAsync).toHaveBeenCalledTimes(1))
    fireEvent.click(saveButton())
    expect(mutationsState.create.mutateAsync).toHaveBeenCalledTimes(1)
    pressEscape()
    expect(await screen.findByText('正在保存，请等待结果后再关闭')).toBeInTheDocument()
    expect(nameInput()).toHaveValue('慢保存视图')
    await act(async () => {
      resolveCreate({ ...mine, id: 'new', name: '慢保存视图' })
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.queryByLabelText('视图名称')).toBeNull())
  })

  it('删除：按对象确认，取消零写入，确认后重新查询并确认删除', async () => {
    viewsState.data = { views: [mine, others] }
    viewsState.refetch.mockResolvedValue({ isError: false, data: { views: [others] } })
    renderManager()
    fireEvent.click(screen.getByRole('button', { name: '我的视图' }))
    focusClick(screen.getByTitle('删除视图'))
    expect(await screen.findByText(/将删除「我的品类视图」/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(mutationsState.remove.mutateAsync).not.toHaveBeenCalled()
    focusClick(screen.getByTitle('删除视图'))
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    await waitFor(() => expect(mutationsState.remove.mutateAsync).toHaveBeenCalledWith('v1'))
    expect(await screen.findByText(/已删除「我的品类视图」，列表已确认/)).toBeInTheDocument()
  })

  it('删除失败：重新查询确认后给出可见反馈，不吞异常', async () => {
    viewsState.data = { views: [mine, others] }
    mutationsState.remove.mutateAsync.mockRejectedValue({ response: { data: { message: '无权限删除该视图' } } })
    viewsState.refetch.mockResolvedValue({ isError: false, data: { views: [mine, others] } })
    renderManager()
    fireEvent.click(screen.getByRole('button', { name: '我的视图' }))
    focusClick(screen.getByTitle('删除视图'))
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    expect(await screen.findByText(/删除失败：无权限删除该视图；视图仍在列表中/)).toBeInTheDocument()
  })

  it('编辑另一视图：先按 dirty 策略放弃，再载入新对象名称', async () => {
    viewsState.data = { views: [mine, mine2] }
    renderManager()
    fireEvent.click(screen.getByRole('button', { name: '我的视图' }))
    focusClick(screen.getAllByTitle('编辑视图（名称、共享并写回当前分析）')[0])
    await waitFor(() => expect(nameInput()).toHaveValue('我的品类视图'))
    fireEvent.change(nameInput(), { target: { value: '品类改名' } })
    pressEscape()
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }))
    await waitFor(() => expect(screen.queryByLabelText('视图名称')).toBeNull())
    // 触发按钮在弹层内已随关闭卸载；焦点回落到「我的视图」开关
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByTitle('编辑视图（名称、共享并写回当前分析）')[0]))
    fireEvent.click(screen.getByRole('button', { name: '我的视图' }))
    focusClick(screen.getAllByTitle('编辑视图（名称、共享并写回当前分析）')[1])
    await waitFor(() => expect(nameInput()).toHaveValue('我的费用视图'))
  })

  it('更新提交返回对象并确认列表与选中视图', async () => {
    viewsState.data = { views: [mine, others] }
    const updated = { ...mine, name: '改名后的视图', shared: true }
    mutationsState.update.mutateAsync.mockResolvedValue(updated)
    viewsState.refetch.mockResolvedValue({ isError: false, data: { views: [updated, others] } })
    renderManager()
    fireEvent.click(screen.getByRole('button', { name: '我的视图' }))
    focusClick(screen.getByTitle('编辑视图（名称、共享并写回当前分析）'))
    fireEvent.change(nameInput(), { target: { value: '改名后的视图' } })
    fireEvent.click(screen.getByLabelText('共享给团队成员'))
    fireEvent.click(saveButton())
    await waitFor(() => {
      expect(mutationsState.update.mutateAsync).toHaveBeenCalledWith({ id: 'v1', name: '改名后的视图', spec, shared: true })
    })
    await waitFor(() => expect(viewsState.refetch).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByLabelText('视图名称')).toBeNull())
  })

  it('列表点击名称 → onApply 收到视图 spec', async () => {
    viewsState.data = { views: [mine, others] }
    const { onApply } = renderManager()
    fireEvent.click(screen.getByRole('button', { name: '我的视图' }))
    fireEvent.click(screen.getByText('我的品类视图'))
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(mine.spec))
  })

  it('自己的视图有编辑/删除，他人共享视图只读', async () => {
    viewsState.data = { views: [mine, others] }
    renderManager()
    fireEvent.click(screen.getByRole('button', { name: '我的视图' }))
    expect(screen.getByTitle('编辑视图（名称、共享并写回当前分析）')).toBeInTheDocument()
    expect(screen.getAllByTitle('删除视图')).toHaveLength(1)
    expect(screen.getByText(/来自 李四/)).toBeInTheDocument()
  })

  it('成功空列表展示引导文案', () => {
    viewsState.data = { views: [] }
    renderManager()
    fireEvent.click(screen.getByRole('button', { name: '我的视图' }))
    expect(screen.getByText(/暂无视图（查询成功，列表为空）/)).toBeInTheDocument()
  })

  it('列表加载失败不得显示为空', () => {
    viewsState.data = undefined
    viewsState.isError = true
    viewsState.error = new Error('模拟列表失败')
    renderManager()
    fireEvent.click(screen.getByRole('button', { name: '我的视图' }))
    expect(screen.getByText('视图列表加载失败')).toBeInTheDocument()
    expect(screen.queryByText(/暂无视图/)).toBeNull()
  })
})
