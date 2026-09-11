import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { chatComplete, chatStream } from './deepseek'

/**
 * deepseek.ts 单测：mock 全局 fetch，验证
 * - 推理模型（deepseek-v4-flash）流式响应：先 reasoning_content 后 content，仅正文回调 onToken；
 * - 推理耗尽配额（finish_reason=length 且无 content）或空流时显式抛 502（替代静默空返回）；
 * - max_tokens 为 32768（覆盖推理 + 正文）。
 */

const fetchMock = vi.fn()

/** 构造 SSE 流式 Response */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function reasoningChunk(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: null, reasoning_content: text }, finish_reason: null }] })}\n\n`
}

function contentChunk(text: string, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text, reasoning_content: null }, finish_reason: finishReason }] })}\n\n`
}

/** 带 usage 的收尾 chunk（finish_reason=length：推理耗尽配额） */
function lengthChunk(reasoningTokens: number): string {
  return `data: ${JSON.stringify({
    choices: [{ delta: { content: '', reasoning_content: null }, finish_reason: 'length' }],
    usage: { completion_tokens: 1024, completion_tokens_details: { reasoning_tokens: reasoningTokens } },
  })}\n\n`
}

const DONE = 'data: [DONE]\n\n'

beforeAll(() => {
  // loadConfig 读取必需环境变量（首次调用后缓存，一次性设置即可）
  vi.stubEnv('DEEPSEEK_API_KEY', 'sk-test')
  vi.stubEnv('DATABASE_URL', 'postgresql://test:test@localhost:5432/test')
  vi.stubEnv('JWT_SECRET', 'x'.repeat(40))
  vi.stubEnv('JWT_REFRESH_SECRET', 'y'.repeat(40))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  fetchMock.mockReset()
})

describe('chatStream', () => {
  it('正常流：先 reasoning 后 content，onToken 仅收到正文，max_tokens=32768', async () => {
    fetchMock.mockResolvedValue(sseResponse([reasoningChunk('思考过程'), contentChunk('报告内容'), contentChunk('第二部分', 'stop'), DONE]))
    const tokens: string[] = []
    await chatStream('sys', 'user', (d) => tokens.push(d))
    expect(tokens).toEqual(['报告内容', '第二部分'])
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as { max_tokens?: number; stream?: boolean }
    expect(body.max_tokens).toBe(32768)
    expect(body.stream).toBe(true)
  })

  it('推理耗尽配额（仅 reasoning + finish_reason=length，无正文）→ 抛 502', async () => {
    fetchMock.mockResolvedValue(sseResponse([reasoningChunk('思考'.repeat(200)), lengthChunk(1024), DONE]))
    await expect(chatStream('sys', 'user', () => {})).rejects.toMatchObject({ httpStatus: 502 })
  })

  it('空流（仅 [DONE]，无任何 chunk）→ 抛 502', async () => {
    fetchMock.mockResolvedValue(sseResponse([DONE]))
    await expect(chatStream('sys', 'user', () => {})).rejects.toMatchObject({ httpStatus: 502 })
  })

  it('HTTP 非 200 → 抛 502', async () => {
    fetchMock.mockResolvedValue(new Response('bad request', { status: 400 }))
    await expect(chatStream('sys', 'user', () => {})).rejects.toMatchObject({ httpStatus: 502 })
  })
})

describe('chatComplete', () => {
  it('正常返回 content，max_tokens=32768', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '公式: {OP_01}' } }] }), { status: 200 }))
    const out = await chatComplete('sys', 'user')
    expect(out).toBe('公式: {OP_01}')
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as { max_tokens?: number; stream?: boolean }
    expect(body.max_tokens).toBe(32768)
    expect(body.stream).toBe(false)
  })

  it('choices 为空 → 抛系统错误（已有兜底）', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 }))
    await expect(chatComplete('sys', 'user')).rejects.toMatchObject({ httpStatus: 500 })
  })
})
