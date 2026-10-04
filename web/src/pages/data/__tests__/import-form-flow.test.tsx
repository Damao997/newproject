import type { ReactNode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChangeEvent } from 'react'
import { useImportFlow } from '../use-import-flow'
const mocks = vi.hoisted(() => ({
  upload: vi.fn(), preview: vi.fn(), mergedPreview: vi.fn(), mergedUpload: vi.fn(), activate: vi.fn(),
  archive: vi.fn(), purge: vi.fn(), confirm: vi.fn(), batch: vi.fn(),
}))
vi.mock('@/hooks/api-queries', () => ({
  useUploadImport: () => ({ mutateAsync: mocks.upload, isPending: false }),
  usePreviewImport: () => ({ mutateAsync: mocks.preview, isPending: false }),
  useActivateImport: () => ({ mutateAsync: mocks.activate, isPending: false }),
  useArchiveImport: () => ({ mutateAsync: mocks.archive, isPending: false }),
  usePurgeImport: () => ({ mutateAsync: mocks.purge, isPending: false }),
  useAvailablePeriods: () => ({ data: { fiscalStartMonth: 4, periods: [] } }),
  useImport: () => ({ data: undefined, isFetching: false }),
}))
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => ({ confirm: mocks.confirm, element: null }) }))
vi.mock('@/hooks/use-batch-activate', () => ({ useBatchActivate: () => ({ busy: false, run: mocks.batch }), buildActivateConflictDescription: () => '模拟影响' }))
vi.mock('@/lib/api', () => ({ api: { previewMergedImport: mocks.mergedPreview, uploadMergedImport: mocks.mergedUpload } }))
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
function createFlow() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return renderHook(() => useImportFlow({ importsData: undefined }), { wrapper })
}
function pick(flow: ReturnType<typeof createFlow>, name = '模拟数据.xlsx') {
  const file = new File(['仅用于前端状态验证'], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  act(() => { flow.result.current.handleFileSelect({ target: { files: [file] } } as unknown as ChangeEvent<HTMLInputElement>) })
  return file
}
beforeEach(() => { vi.clearAllMocks(); mocks.confirm.mockResolvedValue(true) })
afterEach(cleanup)
describe('导入表单快照与写入边界', () => {
  it('普通数据保留跳过预览能力，单位原样传递且不会自动激活', async () => {
    mocks.upload.mockResolvedValue({ id: 'test-batch', filename: '模拟数据.xlsx', successCount: 2, rowCount: 2 })
    const flow = createFlow(); const file = pick(flow)
    act(() => { flow.result.current.setValueUnit('wan') })
    await act(async () => { await flow.result.current.handleUpload() })
    expect(mocks.upload).toHaveBeenCalledWith({ file, templateType: 'operating', valueUnit: 'wan' })
    expect(mocks.preview).not.toHaveBeenCalled()
    expect(mocks.activate).not.toHaveBeenCalled()
    expect(flow.result.current.uploadedInfo?.batchId).toBe('test-batch')
    expect(flow.result.current.selectedFile).toBeNull()
  })
  it('预算财年沿用 FY 标签，元的转换继续交给后端', async () => {
    mocks.upload.mockResolvedValue({ id: 'test-budget', filename: '模拟数据.xlsx', successCount: 2 })
    const flow = createFlow(); const file = pick(flow)
    act(() => { flow.result.current.setTemplateType('budget'); flow.result.current.setBudgetFyOverride('FY2027') })
    await act(async () => { await flow.result.current.handleUpload() })
    expect(mocks.upload).toHaveBeenCalledWith({ file, templateType: 'budget', valueUnit: 'yuan', fiscalYear: 'FY2027' })
  })
  it('改动单位后旧预览立即失效，迟到响应不能恢复预览', async () => {
    const response = deferred<unknown>(); mocks.preview.mockReturnValue(response.promise)
    const flow = createFlow(); pick(flow)
    let pending!: Promise<void>
    act(() => { pending = flow.result.current.handlePreview() })
    act(() => { flow.result.current.setValueUnit('wan') })
    await act(async () => { response.resolve({ validCount: 2 }); await pending })
    expect(flow.result.current.previewResult).toBeNull()
    expect(flow.result.current.previewing).toBe(false)
  })
  it('重新选文件使已显示的预览失效', async () => {
    mocks.preview.mockResolvedValue({ validCount: 2 })
    const flow = createFlow(); pick(flow)
    await act(async () => { await flow.result.current.handlePreview() })
    expect(flow.result.current.previewResult).not.toBeNull()
    pick(flow, '另一份数据.xlsx')
    expect(flow.result.current.previewResult).toBeNull()
  })
  it('导入失败保留文件与口径；同一轮重复点击只产生一个请求', async () => {
    const response = deferred<unknown>(); mocks.upload.mockReturnValue(response.promise.then(() => { throw new Error('测试保存失败') }))
    const flow = createFlow(); const file = pick(flow)
    let first!: Promise<void>
    act(() => { first = flow.result.current.handleUpload(); void flow.result.current.handleUpload() })
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(flow.result.current.uploading).toBe(true)
    await act(async () => { response.resolve(null); await first })
    expect(flow.result.current.fileError).toBe('测试保存失败')
    expect(flow.result.current.selectedFile).toBe(file)
    expect(flow.result.current.uploading).toBe(false)
  })
  it('多表预览也受快照约束，修改财年后不能展示旧结果', async () => {
    const response = deferred<unknown>(); mocks.mergedPreview.mockReturnValue(response.promise)
    const flow = createFlow(); pick(flow)
    act(() => { flow.result.current.setTemplateType('merged') })
    let pending!: Promise<void>
    act(() => { pending = flow.result.current.handlePreview() })
    act(() => { flow.result.current.setBudgetFyOverride('FY2028') })
    await act(async () => { response.resolve({ items: [] }); await pending })
    expect(flow.result.current.mergedPreview).toBeNull()
  })
})
