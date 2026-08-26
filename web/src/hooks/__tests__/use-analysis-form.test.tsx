import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useAnalysisForm } from '@/hooks/use-analysis-form'

const { deleteMutateAsync } = vi.hoisted(() => ({ deleteMutateAsync: vi.fn() }))

vi.mock('@/hooks/api-queries', () => ({
  useAnalyses: () => ({ data: { items: [{ id: 'a1', title: '既有分析', content: '<p>x</p>' }] } }),
  useCreateAnalysis: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateAnalysis: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAnalysis: () => ({ mutateAsync: deleteMutateAsync, isPending: false }),
}))

/** 宿主组件：模拟真实使用场景（existingId 回填后出现删除按钮，确认框由 hook 渲染） */
function Host() {
  const form = useAnalysisForm({
    fetchParams: { companyCode: 'C1', subjectCode: 'S1', period: '2026-01' },
    buildPayload: (title, content) => ({
      companyCode: 'C1', subjectCode: 'S1', subjectType: 'operating',
      fiscalYear: '2026', period: '2026-01', title, content,
    }),
    defaultTitle: () => '默认标题',
  })
  return (
    <div>
      {form.existingId && <button onClick={() => void form.remove()}>删除</button>}
      {form.confirmElement}
    </div>
  )
}

describe('useAnalysisForm 删除确认', () => {
  beforeEach(() => deleteMutateAsync.mockReset())

  it('取消确认时不调用删除接口', async () => {
    render(<Host />)
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('确认删除该单项分析')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deleteMutateAsync).not.toHaveBeenCalled()
  })

  it('确认后调用删除接口并复位表单', async () => {
    deleteMutateAsync.mockResolvedValue(undefined)
    render(<Host />)
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalledWith('a1'))
    // 删除成功 → existingId 复位 → 删除按钮消失
    await waitFor(() => expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument())
  })
})
