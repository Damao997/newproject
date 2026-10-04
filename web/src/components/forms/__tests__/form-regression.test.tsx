import { useEffect } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryRouter, Link, Outlet, RouterProvider } from 'react-router-dom'
import { z } from 'zod'
import { AppForm, FormInput, useAppForm } from '../form'
import { ModelFormFields, useFormModel, useFormValue } from '../form-model'
import { FormNavigationProvider, useFormClose, useFormNavigation } from '../form-navigation'
import { useFormTask } from '../form-task'
import { Input } from '@/components/ui/input'

const NativeRequest = globalThis.Request
// jsdom 的 AbortSignal 与 Node 内置 Request 不同源；路由测试不发请求，转换构造器边界。
beforeEach(() => { vi.stubGlobal('Request', class extends NativeRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) { super(input, { ...init, signal: undefined }) }
}) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
function ModelExample({ initial = '', save }: { initial?: string; save: (value: string) => Promise<void> }) {
  const model = useFormModel({ title: initial }, { title: '请输入名称' })
  const [title, setTitle] = useFormValue(model, 'title')
  const { reset } = model.form
  useEffect(() => { reset({ title: initial }) }, [initial, reset])
  const close = useFormClose({ dirty: model.form.formState.isDirty, busy: model.pending, onClose: () => setTitle('已关闭') })
  return <><ModelFormFields model={model}><label htmlFor="title">名称</label>
    <Input name="title" value={title} onChange={(event) => setTitle(event.target.value)} />
    <output>{model.form.formState.isDirty ? '已修改' : '无修改'}</output>
    <button onClick={model.submit(async () => {
      try { await save(title) } catch { model.form.setError('root', { message: '保存失败，请重试' }) }
    })}>保存内容</button><button onClick={close.requestClose}>关闭编辑</button>
  </ModelFormFields>{close.element}</>
}
function AppExample({ save }: { save: (value: { title: string }) => Promise<void> }) {
  const form = useAppForm(z.object({ title: z.string().min(1, '请输入名称') }), { defaultValues: { title: '' } })
  return <AppForm form={form} onSubmit={save}><FormInput control={form.control} name="title" label="名称" /><button type="submit">提交内容</button></AppForm>
}
describe('共享表单交互契约', () => {
  it('首次失焦校验，修改后即时修正，不提前展示错误摘要', async () => {
    render(<ModelExample save={vi.fn()} />)
    const input = screen.getByLabelText('名称')
    expect(screen.queryByText('请输入名称')).not.toBeInTheDocument()
    fireEvent.blur(input)
    expect(await screen.findByText('请输入名称')).toBeInTheDocument()
    expect(screen.queryByText('请检查 1 项内容')).not.toBeInTheDocument()
    fireEvent.change(input, { target: { value: '中文名称' } })
    await waitFor(() => expect(screen.queryByText('请输入名称')).not.toBeInTheDocument())
  })
  it('提交时聚焦首错；错误摘要支持键盘返回输入', async () => {
    const save = vi.fn()
    render(<ModelExample save={save} />)
    fireEvent.click(screen.getByText('保存内容'))
    await screen.findByText('请检查 1 项内容')
    expect(screen.getByLabelText('名称')).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: '请输入名称' }))
    expect(screen.getByLabelText('名称')).toHaveFocus()
    expect(save).not.toHaveBeenCalled()
  })
  it('快速重复点击只执行一次；失败保留输入并恢复编辑', async () => {
    const request = deferred()
    const save = vi.fn(() => request.promise.then(() => { throw new Error('模拟失败') }))
    render(<ModelExample initial="长名称 · 开发记录" save={save} />)
    fireEvent.click(screen.getByText('保存内容'))
    fireEvent.click(screen.getByText('保存内容'))
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText('名称')).toBeDisabled()
    await act(async () => { request.resolve(); await request.promise })
    expect(await screen.findByText('保存失败，请重试')).toBeInTheDocument()
    expect(screen.getByLabelText('名称')).toHaveValue('长名称 · 开发记录')
    expect(screen.getByLabelText('名称')).not.toBeDisabled()
  })
  it('切换编辑对象重建基线、清除旧错误', async () => {
    const view = render(<ModelExample initial="甲" save={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '' } })
    fireEvent.click(screen.getByText('保存内容'))
    await screen.findByText('请检查 1 项内容')
    view.rerender(<ModelExample initial="乙" save={vi.fn()} />)
    await waitFor(() => expect(screen.getByLabelText('名称')).toHaveValue('乙'))
    expect(screen.getByText('无修改')).toBeInTheDocument()
    expect(screen.queryByText('请检查 1 项内容')).not.toBeInTheDocument()
  })
  it('关闭未保存编辑可以继续，放弃后才执行关闭', async () => {
    render(<ModelExample initial="甲" save={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '未保存' } })
    fireEvent.click(screen.getByText('关闭编辑'))
    fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }))
    expect(screen.getByLabelText('名称')).toHaveValue('未保存')
    fireEvent.click(screen.getByText('关闭编辑'))
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }))
    await waitFor(() => expect(screen.getByLabelText('名称')).toHaveValue('已关闭'))
  })
  it('原生表单也防止同一轮事件重复提交', async () => {
    const request = deferred()
    const save = vi.fn(() => request.promise)
    const view = render(<AppExample save={save} />)
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '报告' } })
    const form = view.container.querySelector('form')!
    fireEvent.submit(form); fireEvent.submit(form)
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    await act(async () => { request.resolve(); await request.promise })
  })
  it('中文组词期间的回车被拦截，普通回车保持正常', () => {
    render(<AppExample save={vi.fn()} />)
    const input = screen.getByLabelText('名称')
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: true })).toBe(false)
    expect(fireEvent.keyDown(input, { key: 'Enter', isComposing: false })).toBe(true)
  })
  it('专业流程锁覆盖确认等待，并在异常后可重试', async () => {
    let task!: ReturnType<typeof useFormTask>
    function Task() { task = useFormTask(); return null }
    render(<Task />)
    const confirmation = deferred()
    const operation = vi.fn(() => confirmation.promise.then(() => { throw new Error('取消请求') }))
    let first!: Promise<unknown>
    await act(async () => {
      first = task.run(operation).catch((error: unknown) => error)
      await task.run(operation)
    })
    expect(operation).toHaveBeenCalledTimes(1)
    expect(task.pending).toBe(true)
    await act(async () => { confirmation.resolve(); await first })
    expect(task.pending).toBe(false)
    await act(async () => { await task.run(async () => undefined) })
  })
})
function GuardedPage({ busy = false }: { busy?: boolean }) {
  useFormNavigation(true, busy)
  return <><p>编辑内容</p><Link to="/list">返回列表</Link></>
}
function makeRouter(busy = false) {
  return createMemoryRouter([{ element: <FormNavigationProvider><Outlet /></FormNavigationProvider>, children: [
    { path: '/edit', element: <GuardedPage busy={busy} /> }, { path: '/list', element: <p>列表内容</p> },
  ] }], { initialEntries: ['/list', '/edit'], initialIndex: 1 })
}
describe('路由与浏览器离开保护', () => {
  it('导航继续编辑留在原页，放弃后进入列表且卸载刷新保护', async () => {
    const router = makeRouter()
    render(<RouterProvider router={router} />)
    fireEvent.click(screen.getByText('返回列表'))
    fireEvent.click(await screen.findByRole('button', { name: '继续编辑' }))
    expect(router.state.location.pathname).toBe('/edit')
    const before = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(before)
    expect(before.defaultPrevented).toBe(true)
    fireEvent.click(screen.getByText('返回列表'))
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改' }))
    expect(await screen.findByText('列表内容')).toBeInTheDocument()
    const after = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(false)
    router.dispose()
  })
  it('浏览器返回受保护，写入期间没有放弃出口', async () => {
    const router = makeRouter(true)
    render(<RouterProvider router={router} />)
    await act(async () => { await router.navigate(-1) })
    expect(await screen.findByText('正在保存')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '放弃修改' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '留在此页' }))
    expect(router.state.location.pathname).toBe('/edit')
    router.dispose()
  })
})
