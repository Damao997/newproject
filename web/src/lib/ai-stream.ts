import { useAuthStore } from '@/stores/authStore'

/**
 * AI SSE 流式客户端。以 fetch(POST) 携带 Bearer token 与 JSON body，
 * 读取 response.body 逐行解析 `data:` 事件，回调 onToken/onDone/onError。
 * 返回 abort 函数用于取消。后端事件格式：{ type:'token'|'done'|'error', content?, finalText?, error? }
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1'

export interface StreamHandlers {
  onToken?: (delta: string) => void
  onDone?: (finalText: string) => void
  onError?: (message: string) => void
}

export interface StreamController {
  abort: () => void
}

export function streamAI(path: string, body: unknown, handlers: StreamHandlers): StreamController {
  const controller = new AbortController()
  const { accessToken } = useAuthStore.getState()

  void (async () => {
    try {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      if (!res.ok || !res.body) {
        handlers.onError?.(`请求失败（${res.status}）`)
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalText = ''
      let doneEmitted = false

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const raw of lines) {
          const line = raw.trim()
          if (!line || !line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload) continue
          try {
            const evt = JSON.parse(payload) as { type: string; content?: string; finalText?: string; error?: string }
            if (evt.type === 'token' && evt.content) {
              handlers.onToken?.(evt.content)
            } else if (evt.type === 'done') {
              finalText = evt.finalText ?? ''
              doneEmitted = true
              handlers.onDone?.(finalText)
            } else if (evt.type === 'error') {
              handlers.onError?.(evt.error ?? 'AI 服务错误')
            }
          } catch {
            // 忽略无法解析的行
          }
        }
      }
      if (!doneEmitted) handlers.onDone?.(finalText)
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      handlers.onError?.((err as Error).message || 'AI 请求异常')
    }
  })()

  return { abort: () => controller.abort() }
}
