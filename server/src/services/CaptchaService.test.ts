import { describe, it, expect, vi } from 'vitest'
import { generateCaptcha, newCaptcha, verifyCaptcha } from './CaptchaService'

/**
 * 登录图形验证码单测：签发/校验/一次性消费/大小写/过期。
 * 内存 store 为模块级状态，用例间通过一次性消费语义自然隔离（每例新签发）。
 */
describe('CaptchaService', () => {
  it('generateCaptcha 返回 captchaId 与 SVG，且不暴露明文答案', () => {
    const result = generateCaptcha()
    expect(result.captchaId).toBeTruthy()
    expect(result.svg).toContain('<svg')
    expect(JSON.stringify(result)).not.toContain('answer')
  })

  it('newCaptcha 签发 4 位答案（剔除易混淆字符）', () => {
    const { answer } = newCaptcha()
    expect(answer).toHaveLength(4)
    expect(answer).not.toMatch(/[0o1liI]/)
  })

  it('正确答案校验通过，且忽略大小写', () => {
    const { captchaId, answer } = newCaptcha()
    expect(verifyCaptcha(captchaId, answer.toUpperCase())).toBe(true)
  })

  it('一次性消费：校验一次后即失效（无论答案对错）', () => {
    const { captchaId, answer } = newCaptcha()
    expect(verifyCaptcha(captchaId, answer)).toBe(true)
    expect(verifyCaptcha(captchaId, answer)).toBe(false)
  })

  it('错误答案同样消费掉该验证码，防同一张图反复尝试', () => {
    const { captchaId, answer } = newCaptcha()
    expect(verifyCaptcha(captchaId, 'zzzz')).toBe(false)
    expect(verifyCaptcha(captchaId, answer)).toBe(false)
  })

  it('不存在的 captchaId 返回 false', () => {
    expect(verifyCaptcha('no-such-id', 'abcd')).toBe(false)
  })

  it('过期验证码（5 分钟 TTL）校验失败', () => {
    vi.useFakeTimers()
    try {
      const { captchaId, answer } = newCaptcha()
      vi.setSystemTime(Date.now() + 6 * 60 * 1000)
      expect(verifyCaptcha(captchaId, answer)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
