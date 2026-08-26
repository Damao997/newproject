import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ImportCompareDialog } from '../import-compare-dialog'
import type { ImportBatch, ImportDiff } from '@/types'

/** 批次差异对比对话框测试：目标选择 → diff 展示 → 回滚确认流程 */

const { rollbackMutation } = vi.hoisted(() => ({
  rollbackMutation: { mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false },
}))

const mockDiff: ImportDiff = {
  a: { id: 'b1', filename: 'A批次.xlsx', templateType: 'operating', status: 'active', createdAt: '2026-08-01T00:00:00Z' },
  b: { id: 'b2', filename: 'B批次.xlsx', templateType: 'operating', status: 'archived', createdAt: '2026-08-02T00:00:00Z' },
  changed: [
    { companyCode: 'EN330001', accountCode: 'OP_001', subjectName: '灶具收入', period: '2026-04', oldValue: 100, newValue: 150, delta: 50, deltaPercent: 50 },
  ],
  added: [
    { companyCode: 'EN330001', accountCode: 'OP_002', subjectName: '热水器收入', period: '2026-05', oldValue: 0, newValue: 80, delta: 80, deltaPercent: null },
  ],
  removed: [],
  summary: { changedCount: 1, addedCount: 1, removedCount: 0, totalDelta: 130, truncated: false },
}

const sourceBatch: ImportBatch = {
  id: 'b1', filename: 'A批次.xlsx', templateType: 'operating', status: 'active',
  successCount: 2, errorCount: 0, createdBy: 'u1', createdAt: '2026-08-01T00:00:00Z',
}

const targetBatch: ImportBatch = {
  id: 'b2', filename: 'B批次.xlsx', templateType: 'operating', status: 'archived',
  successCount: 2, errorCount: 0, createdBy: 'u1', createdAt: '2026-08-02T00:00:00Z',
}

vi.mock('@/hooks/api-queries', () => ({
  useCompareImports: () => ({ data: mockDiff, isFetching: false, isError: false, error: null }),
  useRollbackImport: () => rollbackMutation,
}))

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ can: () => true, permissions: ['data:import:upload'] }),
}))

describe('ImportCompareDialog 批次差异对比', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('打开后展示标题与对比目标选择', () => {
    render(
      <ImportCompareDialog
        open
        onOpenChange={vi.fn()}
        source={sourceBatch}
        candidates={[targetBatch]}
        onRollbackSuccess={vi.fn()}
      />,
    )
    expect(screen.getByText('批次差异对比')).toBeInTheDocument()
    expect(screen.getByText(/当前批次：《A批次.xlsx》/)).toBeInTheDocument()
    expect(screen.getByText('选择要对比的批次')).toBeInTheDocument()
  })

  it('展示 diff 汇总条与变化表格（科目/期间/旧值/新值/差值）', () => {
    render(
      <ImportCompareDialog
        open
        onOpenChange={vi.fn()}
        source={sourceBatch}
        candidates={[targetBatch]}
        onRollbackSuccess={vi.fn()}
      />,
    )
    // 汇总条（三组统计 + 合计变动）
    expect(screen.getByText(/变化 1 项/)).toBeInTheDocument()
    expect(screen.getByText(/新增 1 项/)).toBeInTheDocument()
    expect(screen.getByText(/删除 0 项/)).toBeInTheDocument()
    expect(screen.getByText(/合计变动/)).toBeInTheDocument()
    // 变化表格行（默认 Tab：科目/公司/期间/差值）
    expect(screen.getByText('灶具收入')).toBeInTheDocument()
    expect(screen.getByText('EN330001')).toBeInTheDocument()
    expect(screen.getByText('2026-04')).toBeInTheDocument()
    expect(screen.getByText('100.00')).toBeInTheDocument()
    expect(screen.getByText('150.00')).toBeInTheDocument()
    expect(screen.getByText('+50.00')).toBeInTheDocument()
    expect(screen.getByText('+50.0%')).toBeInTheDocument()
    // 三个分组 Tab 均可见（Radix Tabs 在 jsdom 中切换内容不可靠，仅验证入口存在）
    expect(screen.getByRole('tab', { name: /变化/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /新增/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /删除/ })).toBeInTheDocument()
  })

  it('点击回滚触发确认流程并调用 rollbackImport', async () => {
    rollbackMutation.mutateAsync.mockResolvedValue(undefined)
    const onRollbackSuccess = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <ImportCompareDialog
        open
        onOpenChange={onOpenChange}
        source={sourceBatch}
        candidates={[targetBatch]}
        onRollbackSuccess={onRollbackSuccess}
      />,
    )
    // 先选择对比目标批次（Radix Select：打开下拉 → 点选项）
    fireEvent.click(screen.getByRole('combobox'))
    fireEvent.click(await screen.findByRole('option', { name: /B批次.xlsx/ }))
    fireEvent.click(screen.getByRole('button', { name: /回滚到《B批次.xlsx》/ }))
    // 确认对话框出现
    await waitFor(() => {
      expect(screen.getByText('回滚批次确认')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByRole('button', { name: /回\s*滚/ }))
    await waitFor(() => {
      expect(rollbackMutation.mutateAsync).toHaveBeenCalledWith('b2')
      expect(onRollbackSuccess).toHaveBeenCalledWith(expect.stringContaining('B批次.xlsx'))
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })
  })

  it('无候选批次时选择框禁用并提示', () => {
    render(
      <ImportCompareDialog
        open
        onOpenChange={vi.fn()}
        source={sourceBatch}
        candidates={[]}
        onRollbackSuccess={vi.fn()}
      />,
    )
    expect(screen.getByText('暂无同类型可对比批次')).toBeInTheDocument()
    // 未选择目标时无 diff 数据（useCompareImports enabled=false），不显示回滚按钮
    expect(screen.queryByRole('button', { name: /回滚/ })).not.toBeInTheDocument()
  })
})
