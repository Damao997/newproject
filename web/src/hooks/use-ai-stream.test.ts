import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useAiStream } from './use-ai-stream'

/**
 * useAiStream 单测：mock streamAI，验证状态机
 * （start/token 累积/onDone/onError/abort/卸载行为）。
 */

const mocks = vi.hoisted(() => ({ streamAI: vi.fn() }))

vi.mock('@/lib/ai-stream', () => ({ streamAI: mocks.streamAI }))

interface StreamHandlers {
  onToken: (d: string) => void
  onDone: (t: string) => void
  onError: (m: string) => void
}

/** 捕获 streamAI 的 handlers 并返回控制器，便于测试手动触发 */
function captureHandlers() {
  const handlers: StreamHandlers = { onToken: () => {}, onDone: () => {}, onError: () => {} }
  mocks.streamAI.mockImplementation((_path: string, _body: unknown, h: StreamHandlers) => {
    Object.assign(handlers, h)
    return { abort: vi.fn() }
  })
  return handlers
}

beforeEach(() => {
  mocks.streamAI.mockReset()
  mocks.streamAI.mockReturnValue({ abort: vi.fn() })
})

afterEach(() => {
  cleanup()
})

describe('useAiStream', () => {
  it('start 触发请求，token 累积到 preview 并回调 onToken', () => {
    const handlers = captureHandlers()
    const onToken = vi.fn()
    const { result } = renderHook(() => useAiStream({ path: '/ai/test', body: { a: 1 }, onToken }))
    act(() => result.current.start())
    expect(mocks.streamAI).toHaveBeenCalledWith('/ai/test', { a: 1 }, expect.any(Object))
    expect(result.current.streaming).toBe(true)
    act(() => handlers.onToken('你好'))
    act(() => handlers.onToken('世界'))
    expect(result.current.preview).toBe('你好世界')
    expect(onToken).toHaveBeenCalledTimes(2)
  })

  it('onDone 回调 finalText 并结束 streaming', () => {
    const handlers = captureHandlers()
    const onDone = vi.fn()
    const { result } = renderHook(() => useAiStream({ path: '/ai/test', body: {}, onDone }))
    act(() => result.current.start())
    act(() => handlers.onDone('最终文本'))
    expect(onDone).toHaveBeenCalledWith('最终文本', undefined)
    expect(result.current.streaming).toBe(false)
  })

  it('onError 设置 error 并结束 streaming', () => {
    const handlers = captureHandlers()
    const onError = vi.fn()
    const { result } = renderHook(() => useAiStream({ path: '/ai/test', body: {}, onError }))
    act(() => result.current.start())
    act(() => handlers.onError('请求失败（429）'))
    expect(result.current.error).toBe('请求失败（429）')
    expect(result.current.streaming).toBe(false)
    expect(onError).toHaveBeenCalledWith('请求失败（429）', undefined)
  })

  it('再次 start 中断旧流并清空 preview/error', () => {
    const handlers = captureHandlers()
    const { result } = renderHook(() => useAiStream({ path: '/ai/test', body: {} }))
    act(() => result.current.start())
    act(() => handlers.onToken('旧内容'))
    act(() => result.current.start())
    expect(result.current.preview).toBe('')
    expect(result.current.error).toBeNull()
  })

  it('abort 中断并结束 streaming', () => {
    captureHandlers()
    const { result } = renderHook(() => useAiStream({ path: '/ai/test', body: {} }))
    act(() => result.current.start())
    act(() => result.current.abort())
    expect(result.current.streaming).toBe(false)
  })

  it('默认卸载时调用 abort', () => {
    const { result } = renderHook(() => useAiStream({ path: '/ai/test', body: {} }))
    act(() => result.current.start())
    const ctrl = mocks.streamAI.mock.results[0]?.value as { abort: ReturnType<typeof vi.fn> }
    cleanup()
    expect(ctrl.abort).toHaveBeenCalled()
  })

  it('abortOnUnmount=false 时卸载不调用 abort（后台完成语义）', () => {
    const { result } = renderHook(() => useAiStream({ path: '/ai/test', body: {}, abortOnUnmount: false }))
    act(() => result.current.start())
    const ctrl = mocks.streamAI.mock.results[0]?.value as { abort: ReturnType<typeof vi.fn> }
    cleanup()
    expect(ctrl.abort).not.toHaveBeenCalled()
  })

  it('requestId 在发起时生成并随回调返回（竞态防护）', () => {
    const handlers = captureHandlers()
    const onToken = vi.fn()
    const onDone = vi.fn()
    let seq = 0
    const { result } = renderHook(() =>
      useAiStream({ path: '/ai/test', body: {}, requestId: () => ++seq, onToken, onDone }),
    )
    act(() => result.current.start())
    expect(seq).toBe(1)
    act(() => handlers.onToken('片段'))
    expect(onToken).toHaveBeenCalledWith('片段', 1)
    // 第二次 start：新请求标识
    act(() => result.current.start())
    expect(seq).toBe(2)
    act(() => handlers.onDone('完成'))
    expect(onDone).toHaveBeenCalledWith('完成', 2)
  })
})
