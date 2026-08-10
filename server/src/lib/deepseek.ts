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
  choices?: { delta?: { content?: string | null; reasoning_content?: string | null }; finish_reason?: string | null }[]
  usage?: { completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } }
}

// deepseek-v4-flash/pro 为推理模型：流式输出先 reasoning_content（思考）后 content（正文），
// max_tokens 须同时覆盖两者；设 32768 为复杂推理任务（如大范围全局预分析）留足推理+正文空间，
// 避免推理耗尽配额导致正文被截断（finish_reason=length）
const MAX_TOKENS = 32768

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
        max_tokens: MAX_TOKENS,
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
        max_tokens: MAX_TOKENS,
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
    // 推理模型（deepseek-v4-flash/pro）先输出 reasoning_content、后输出 content：
    // 若推理耗尽 max_tokens（finish_reason=length）或流为空，正文从未输出——必须显式报错而非静默空返回
    let emittedContent = false
    let finishReason: string | null = null
    let usage: ChatCompletionChunk['usage']
    let streamEnded = false
    for (;;) {
      if (streamEnded) break
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
        if (payload === '[DONE]') {
          streamEnded = true
          break
        }
        try {
          const chunk = JSON.parse(payload) as ChatCompletionChunk
          const delta = chunk.choices?.[0]?.delta
          if (delta?.content) {
            emittedContent = true
            onToken(delta.content)
          }
          if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices?.[0]?.finish_reason
          if (chunk.usage) usage = chunk.usage
        } catch {
          // 忽略非 JSON 的心跳/注释行
        }
      }
    }
    if (!emittedContent) {
      const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens ?? 0
      logger.warn(traceId, `DeepSeek 流式响应无正文输出 finish_reason=${finishReason ?? 'none'} reasoning_tokens=${reasoningTokens}`, usage ? JSON.stringify(usage) : '')
      throw new AppError(40000, 502, 'AI 输出为空或被截断（推理耗尽输出配额），请重试或简化分析范围')
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
