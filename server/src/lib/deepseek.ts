import { loadConfig } from '../config/env'
import { AppError, errors } from './errors'
import { logger } from './logger'

/**
 * DeepSeek 客户端（OpenAI 兼容，非流式）。
 * 全平台唯一 LLM 出口：其他模块禁止直接调用 DeepSeek，须经 AIProxyService。
 * 未配置 DEEPSEEK_API_KEY 时调用将抛错（应用仍可启动，仅 AI 功能不可用）。
 */

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[]
}

interface ChatCompletionChunk {
  choices?: { delta?: { content?: string } }[]
}

export async function chatComplete(system: string, user: string, traceId?: string): Promise<string> {
  const cfg = loadConfig()
  if (!cfg.deepseekApiKey) {
    throw new AppError(40001, 503, '未配置 DEEPSEEK_API_KEY，AI 功能不可用')
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    const res = await fetch(`${cfg.deepseekApiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: cfg.deepseekModel,
        messages,
        temperature: 0.3,
        max_tokens: 1024,
        stream: false,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      logger.error(traceId, `DeepSeek 调用失败 status=${res.status}`, text.slice(0, 500))
      throw new AppError(40000, 502, `AI 服务调用失败（${res.status}）`)
    }

    const data = (await res.json()) as ChatCompletionResponse
    const content = data.choices?.[0]?.message?.content
    if (!content) {
      throw errors.internal('AI 返回内容为空')
    }
    return content
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw errors.internal('AI 服务调用超时')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * DeepSeek 流式补全（SSE）。逐段回调 onToken 输出增量 content。
 * 未配置 DEEPSEEK_API_KEY 抛 503；超时 90s 中断。全平台唯一流式 LLM 出口。
 */
export async function chatStream(
  system: string,
  user: string,
  onToken: (delta: string) => void,
  traceId?: string,
): Promise<void> {
  const cfg = loadConfig()
  if (!cfg.deepseekApiKey) {
    throw new AppError(40001, 503, '未配置 DEEPSEEK_API_KEY，AI 功能不可用')
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 90_000)
  try {
    const res = await fetch(`${cfg.deepseekApiBase}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.deepseekApiKey}`,
      },
      body: JSON.stringify({
        model: cfg.deepseekModel,
        messages,
        temperature: 0.3,
        max_tokens: 1024,
        stream: true,
      }),
      signal: controller.signal,
    })

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      logger.error(traceId, `DeepSeek 流式调用失败 status=${res.status}`, text.slice(0, 500))
      throw new AppError(40000, 502, `AI 服务调用失败（${res.status}）`)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      // 按 SSE 行拆分，保留最后不完整行
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.trim()
        if (!line || !line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (payload === '[DONE]') return
        try {
          const chunk = JSON.parse(payload) as ChatCompletionChunk
          const delta = chunk.choices?.[0]?.delta?.content
          if (delta) onToken(delta)
        } catch {
          // 忽略非 JSON 的心跳/注释行
        }
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw errors.internal('AI 服务调用超时')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
