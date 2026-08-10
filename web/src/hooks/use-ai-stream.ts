import { useCallback, useEffect, useRef, useState } from 'react'
import { streamAI, type StreamController } from '@/lib/ai-stream'

/**
 * AI SSE 流式请求统一 hook。
 *
 * 封装 streamAI 的 streaming/preview/error 状态机与请求生命周期（start/abort），
 * 替代各 AI 消费方（预分析面板/分析抽屉/润色面板/概述对话框）重复实现的状态逻辑。
 *
 * abortOnUnmount=false 时组件卸载不中断请求（配合外部 store 写入回调，
 * 实现"页面切换后后台继续完成"语义，如 AI 全局预分析）。
 */

interface UseAiStreamOptions {
  path: string
  /** 请求体；函数形式在 start 发起时求值（取最新状态，如润色风格切换） */
  body: unknown | (() => unknown)
  /** 回调携带本次请求的标识（start 发起时调用生成；用于调用方竞态校验，如 overview 的 seq） */
  onToken?: (delta: string, requestId?: number) => void
  onDone?: (finalText: string, requestId?: number) => void
  onError?: (message: string, requestId?: number) => void
  /** start 发起请求前调用，返回本次请求标识（如递增的请求序号） */
  requestId?: () => number
  /** 组件卸载时中止请求（默认 true；overview 场景传 false 保留后台完成） */
  abortOnUnmount?: boolean
}

export function useAiStream(opts: UseAiStreamOptions): {
  streaming: boolean
  preview: string
  error: string | null
  start: () => void
  abort: () => void
} {
  const { abortOnUnmount = true } = opts
  const [streaming, setStreaming] = useState(false)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ctrlRef = useRef<StreamController | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts

  // 卸载中止（可配置关闭）
  useEffect(() => {
    if (!abortOnUnmount) return undefined
    return () => ctrlRef.current?.abort()
  }, [abortOnUnmount])

  const abort = useCallback(() => {
    ctrlRef.current?.abort()
    ctrlRef.current = null
    setStreaming(false)
  }, [])

  const start = useCallback(() => {
    // 重新生成：中断旧流省资源（调用方若有外部竞态防护，旧流写入会被忽略）
    ctrlRef.current?.abort()
    const { path: p, body: b, onToken: t, onDone: d, onError: e, requestId } = optsRef.current
    // 发起时生成请求标识，随各回调返回（保证回调与所属请求一一对应，防旧流覆盖新结果）
    const rid = requestId?.()
    const reqBody = typeof b === 'function' ? (b as () => unknown)() : b
    setError(null)
    setPreview('')
    setStreaming(true)
    ctrlRef.current = streamAI(
      p,
      reqBody,
      {
        onToken: (delta) => {
          setPreview((prev) => prev + delta)
          t?.(delta, rid)
        },
        onDone: (finalText) => {
          setStreaming(false)
          ctrlRef.current = null
          d?.(finalText, rid)
        },
        onError: (msg) => {
          setStreaming(false)
          setError(msg)
          ctrlRef.current = null
          e?.(msg, rid)
        },
      },
    )
  }, [])

  return { streaming, preview, error, start, abort }
}
