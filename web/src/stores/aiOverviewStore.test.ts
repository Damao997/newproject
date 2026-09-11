import { describe, it, expect, beforeEach } from 'vitest'
import { useAiOverviewStore } from './aiOverviewStore'

/**
 * aiOverviewStore 单测：分槽缓存与请求序号竞态防护。
 * 每个用例前重置 store，避免跨用例串扰。
 */
beforeEach(() => {
  useAiOverviewStore.setState({ slots: {}, requestSeq: {} })
})

describe('aiOverviewStore', () => {
  it('begin 后 append 累积流式文本，finish 置 done', () => {
    const store = useAiOverviewStore.getState()
    const seq = store.begin('company:A|2026-07')
    store.append('company:A|2026-07', seq, '一、整体')
    store.append('company:A|2026-07', seq, '趋势')
    const slot = useAiOverviewStore.getState().slots['company:A|2026-07']
    expect(slot?.status).toBe('streaming')
    expect(slot?.preview).toBe('一、整体趋势')

    useAiOverviewStore.getState().finish('company:A|2026-07', seq, '一、整体趋势\n完整报告')
    const done = useAiOverviewStore.getState().slots['company:A|2026-07']
    expect(done?.status).toBe('done')
    expect(done?.preview).toBe('一、整体趋势\n完整报告')
  })

  it('fail 置 error 并保留错误信息', () => {
    const store = useAiOverviewStore.getState()
    const seq = store.begin('all|all')
    store.fail('all|all', seq, 'AI 输出为空或被截断')
    const slot = useAiOverviewStore.getState().slots['all|all']
    expect(slot?.status).toBe('error')
    expect(slot?.error).toBe('AI 输出为空或被截断')
  })

  it('旧请求序号（竞态）的 append/finish/fail 被忽略', () => {
    const store = useAiOverviewStore.getState()
    // 第一次请求（旧）
    const oldSeq = store.begin('k1')
    store.append('k1', oldSeq, '旧内容')
    // 重新生成：begin 递增序号（新请求生效）
    const newSeq = store.begin('k1')
    expect(newSeq).toBe(oldSeq + 1)

    // 旧请求的后续写入全部被忽略
    store.append('k1', oldSeq, '不应追加')
    store.finish('k1', oldSeq, '旧完成')
    expect(useAiOverviewStore.getState().slots['k1']?.status).toBe('streaming')
    expect(useAiOverviewStore.getState().slots['k1']?.preview).toBe('')

    // 新请求正常写入
    store.append('k1', newSeq, '新内容')
    store.finish('k1', newSeq, '新完成')
    const slot = useAiOverviewStore.getState().slots['k1']
    expect(slot?.status).toBe('done')
    expect(slot?.preview).toBe('新完成')
  })

  it('不同 key 的槽位互不干扰', () => {
    const store = useAiOverviewStore.getState()
    const seqA = store.begin('company:A|2026-07')
    const seqB = store.begin('company:B|2026-07')
    store.append('company:A|2026-07', seqA, 'A 的内容')
    store.append('company:B|2026-07', seqB, 'B 的内容')
    store.finish('company:A|2026-07', seqA, 'A 完成')
    const slots = useAiOverviewStore.getState().slots
    expect(slots['company:A|2026-07']?.status).toBe('done')
    expect(slots['company:A|2026-07']?.preview).toBe('A 完成')
    expect(slots['company:B|2026-07']?.status).toBe('streaming')
    expect(slots['company:B|2026-07']?.preview).toBe('B 的内容')
  })

  it('reset 清空槽位', () => {
    const store = useAiOverviewStore.getState()
    store.begin('k1')
    useAiOverviewStore.getState().reset('k1')
    expect(useAiOverviewStore.getState().slots['k1']).toBeUndefined()
  })

  it('begin 后 status 为 streaming 且 preview 清空（重新生成不残留旧文本）', () => {
    const store = useAiOverviewStore.getState()
    store.begin('k1')
    store.finish('k1', 1, '旧结果')
    store.begin('k1')
    const slot = useAiOverviewStore.getState().slots['k1']
    expect(slot?.status).toBe('streaming')
    expect(slot?.preview).toBe('')
  })
})
