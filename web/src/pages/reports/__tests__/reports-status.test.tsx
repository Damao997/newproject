import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRef } from 'react'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ReportListItem } from '@/types'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  mutateAsync: vi.fn(),
  refetch: vi.fn(),
  report: null as ReportListItem | null,
}))

vi.mock('@/hooks/api-queries', () => ({
  useReports: () => ({ data: { items: mocks.report ? [mocks.report] : [], total: 1, page: 1, pageSize: 12 }, isLoading: false, isError: false, error: null, refetch: mocks.refetch }),
  useUpdateReport: () => ({ mutateAsync: mocks.mutateAsync, isPending: false, variables: undefined }),
  useDeleteReport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateReport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCompanies: () => ({ data: [] }),
  useAvailablePeriods: () => ({ data: undefined, isLoading: false }),
  useReportTemplates: () => ({ data: undefined, isLoading: false }),
}))

vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ can: () => true, permissions: [], role: 'superadmin' }) }))
vi.mock('@/hooks/useCompanyDisplay', () => ({ useCompanyDisplayName: () => ({ getDisplayName: (_code: string, fallback?: string | null) => fallback ?? _code }) }))
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => ({ confirm: mocks.confirm, element: null }) }))

import { ReportsList } from '../index'

function report(status = 'draft'): ReportListItem {
  return {
    id: 'preview-report',
    title: '浙江壹品慧九月经营分析（模拟）',
    fiscalYear: '2026',
    period: '2026-09',
    companyScope: { type: 'company', code: 'EN330001', name: '杭州分公司（模拟）' },
    status,
    currentVersion: 3,
    createdBy: '预览账号',
    createdAt: '2026-09-30T08:30:00Z',
    updatedAt: '2026-09-30T08:30:00Z',
  }
}

function renderList() {
  return render(<MemoryRouter><ReportsList filterRef={createRef<HTMLDivElement>()} stickyTop={0} /></MemoryRouter>)
}

const publishButton = () => screen.getByRole('button', { name: '发布' })
const card = () => {
  const node = screen.getByText('浙江壹品慧九月经营分析（模拟）').closest('.report-card')
  if (!(node instanceof HTMLElement)) throw new Error('未找到报告卡片')
  return node
}
const flashText = () => screen.getByRole('status').textContent

describe('报告状态动作确认与防重（FE-05）', () => {
  beforeEach(() => {
    mocks.confirm.mockReset()
    mocks.mutateAsync.mockReset()
    mocks.refetch.mockReset()
    mocks.report = report('draft')
    mocks.refetch.mockResolvedValue({ data: { items: [report('draft')], total: 1, page: 1, pageSize: 12 } })
  })
  afterEach(() => cleanup())

  it('取消确认：零请求、状态不变', async () => {
    mocks.confirm.mockResolvedValue(false)
    renderList()
    fireEvent.click(publishButton())
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1))
    expect(mocks.mutateAsync).not.toHaveBeenCalled()
    expect(within(card()).getByText('草稿')).toBeInTheDocument()
  })

  it('确认后仅提交一次，并按服务端返回状态提示成功', async () => {
    mocks.confirm.mockResolvedValue(true)
    mocks.mutateAsync.mockResolvedValue({ id: 'preview-report', status: 'published' })
    renderList()
    fireEvent.click(publishButton())
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1))
    expect(mocks.mutateAsync).toHaveBeenCalledWith({ id: 'preview-report', data: { status: 'published' } })
    await waitFor(() => expect(flashText()).toBe('已发布'))
  })

  it('失败：保留原状态，不伪报成功，并重新查询核对', async () => {
    mocks.confirm.mockResolvedValue(true)
    mocks.mutateAsync.mockRejectedValue(new Error('模拟网络中断'))
    renderList()
    fireEvent.click(publishButton())
    await waitFor(() => expect(flashText()).toBe('模拟网络中断'))
    expect(within(card()).getByText('草稿')).toBeInTheDocument()
    expect(mocks.refetch).toHaveBeenCalled()
  })

  it('连续点击：确认框与写入均只触发一次', async () => {
    mocks.confirm.mockResolvedValue(true)
    let resolveWrite: (value: { id: string; status: string }) => void = () => {}
    mocks.mutateAsync.mockReturnValue(new Promise((resolve) => { resolveWrite = resolve }))
    renderList()
    fireEvent.click(publishButton())
    fireEvent.click(publishButton())
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledTimes(1))
    fireEvent.click(publishButton())
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(mocks.mutateAsync).toHaveBeenCalledTimes(1)
    resolveWrite({ id: 'preview-report', status: 'published' })
    await waitFor(() => expect(flashText()).toBe('已发布'))
  })

  it('已归档恢复草稿不弹确认框，直接执行并按返回确认', async () => {
    mocks.report = report('archived')
    mocks.mutateAsync.mockResolvedValue({ id: 'preview-report', status: 'draft' })
    renderList()
    fireEvent.click(screen.getByRole('button', { name: '恢复为草稿' }))
    await waitFor(() => expect(mocks.mutateAsync).toHaveBeenCalledWith({ id: 'preview-report', data: { status: 'draft' } }))
    expect(mocks.confirm).not.toHaveBeenCalled()
    await waitFor(() => expect(flashText()).toBe('已恢复为草稿'))
  })
})
