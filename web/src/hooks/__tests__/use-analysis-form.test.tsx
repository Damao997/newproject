import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useAnalysisForm } from '@/hooks/use-analysis-form'

// 关于 !existingId 守卫（remove 首行 if (!existingId) return）：由类型系统与 UI 条件渲染双重保障——
// 删除按钮仅在 form.existingId 存在时渲染（见 Host 组件），无 UI 入口可触发 !existingId 分支，
// 故不单独编写 guard 用例；该守卫作为原代码保留行为由上述两层约束覆盖。

const { deleteMutateAsync } = vi.hoisted(() => ({ deleteMutateAsync: vi.fn() }))

vi.mock('@/hooks/api-queries', () => ({
  useAnalyses: (_params: unknown, options: { enabled?: boolean } = {}) => options.enabled === false ? {} : ({ data: { items: [{ id: 'a1', title: '既有分析', content: '<p>x</p>' }] } }),
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
      {form.feedback && <div role="status">{form.feedback.msg}</div>}
    </div>
  )
}

describe('useAnalysisForm 删除确认', () => {
  beforeEach(() => deleteMutateAsync.mockReset())

  it('取消确认时不调用删除接口', async () => {
    render(<Host />)
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('确认删除该单项分析')
    fireEvent.click(screen.getByRole('button', { name: /^取\s*消$/ }))
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
    // 成功反馈展示（mock 静态数据下 refetch 不会清掉 feedback）
    expect(screen.getByText('已删除')).toBeInTheDocument()
  })

  it('删除失败：展示错误反馈且不复位表单', async () => {
    // 同步 throw 模拟接口失败：语义与 mockRejectedValue 等价，但避免 rejected promise 在
    // jsdom + React act 环境下触发 vitest unhandled rejection 误报
    deleteMutateAsync.mockImplementationOnce(() => {
      throw new Error('删除失败，请稍后重试')
    })
    render(<Host />)
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }))
    expect(await screen.findByText('删除失败，请稍后重试')).toBeInTheDocument()
    // 失败后 existingId 保留（删除按钮仍在）
    expect(screen.getByRole('button', { name: '删除' })).toBeInTheDocument()
  })
})


function EditorStateHost({ existing = false }: { existing?: boolean }) {
  const form = useAnalysisForm({
    fetchParams: { companyCode: 'C1', subjectCode: 'S1', period: '2026-01' },
    fetchEnabled: existing,
    buildPayload: (title, content) => ({ companyCode: 'C1', subjectCode: 'S1', subjectType: 'transaction', fiscalYear: '2026', period: '2026-01', title, content }),
    defaultTitle: () => '',
  })
  return <div>
    <output>{form.model.form.formState.isDirty ? '有未保存修改' : '没有修改'}</output>
    <button onClick={() => form.setContent('<p></p>')}>空段落同步</button>
    <button onClick={() => form.setContent('<p>实际正文</p>')}>输入正文</button>
    <div data-testid="analysis-content">{form.content}</div>
  </div>
}

describe('单项分析正文离开保护', () => {
  it('初始化空段落不产生未保存修改，真实输入仍参与保护', async () => {
    render(<EditorStateHost />)
    fireEvent.click(screen.getByRole('button', { name: '空段落同步' }))
    expect(screen.getByText('没有修改')).toBeInTheDocument()
    expect(screen.getByTestId('analysis-content')).toHaveTextContent('')
    fireEvent.click(screen.getByRole('button', { name: '输入正文' }))
    await waitFor(() => expect(screen.getByText('有未保存修改')).toBeInTheDocument())
    expect(screen.getByTestId('analysis-content')).toHaveTextContent('<p>实际正文</p>')
  })

  it('清空已有正文仍产生修改，保留编辑器原始 HTML', async () => {
    render(<EditorStateHost existing />)
    await waitFor(() => expect(screen.getByTestId('analysis-content')).toHaveTextContent('<p>x</p>'))
    fireEvent.click(screen.getByRole('button', { name: '空段落同步' }))
    expect(screen.getByText('有未保存修改')).toBeInTheDocument()
    expect(screen.getByTestId('analysis-content')).toHaveTextContent('<p></p>')
  })
})
