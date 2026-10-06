import { randomUUID } from 'node:crypto'
import svgCaptcha from 'svg-captcha'

/**
 * 登录图形验证码（进程内存态）。
 * 仅适用于单实例部署（生产 PM2 为 fork 模式，见 zjyph-ecosystem.config.cjs）；
 * 若未来改为 cluster 多实例，需将存储迁移到 PostgreSQL 等共享介质。
 *
 * 生命周期：签发后 5 分钟有效；verify 无论对错一次性消费 ——
 * 对同一张图反复尝试不可行，暴力破解每次都需重新拉图，叠加 /auth/captcha 限流后成本可控。
 */

const CAPTCHA_TTL_MS = 5 * 60 * 1000

/**
 * 字符集：在 svg-captcha 默认预设（大小写字母 + 数字）基础上剔除易混淆字符
 * 0/o/O、1/l/L、i/I，降低用户输入失败率（配合忽略大小写比对）。
 * 直接给定 charPreset 而不是依赖库的 ignoreChars，使「剔除」在代码里可见、可测、不受库实现变动影响。
 */
const CAPTCHA_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'

interface CaptchaEntry {
  answer: string
  expiresAt: number
}

const store = new Map<string, CaptchaEntry>()

/**
 * 生成验证码（核心实现，返回明文答案）。
 * 明文答案仅供服务端校验与测试直取；对外路由必须只返回 captchaId + svg。
 */
export function newCaptcha(): { captchaId: string; svg: string; answer: string; expiresAt: number } {
  // 剔除易混淆字符（0/o、1/l/i），降低用户输入失败率；忽略大小写比对
  const { data, text } = svgCaptcha.create({
    size: 4,
    charPreset: CAPTCHA_CHARS,
    noise: 3,
    color: true,
    background: '#f6f6f6',
  })
  const expiresAt = Date.now() + CAPTCHA_TTL_MS
  // 惰性清理过期项（Map 规模 = 正在登录页停留的用户数，量级极小）
  if (store.size > 0) {
    for (const [key, entry] of store) {
      if (entry.expiresAt <= Date.now()) store.delete(key)
    }
  }
  const captchaId = randomUUID()
  store.set(captchaId, { answer: text.toLowerCase(), expiresAt })
  return { captchaId, svg: data, answer: text.toLowerCase(), expiresAt }
}

/** 生成验证码（对外路由用）：不暴露明文答案 */
export function generateCaptcha(): { captchaId: string; svg: string } {
  const { captchaId, svg } = newCaptcha()
  return { captchaId, svg }
}

/** 校验并消费（一次性）：captchaId 不存在/已过期/已消费/答案不符一律 false */
export function verifyCaptcha(captchaId: string, input: string): boolean {
  const entry = store.get(captchaId)
  if (!entry) return false
  store.delete(captchaId)
  if (entry.expiresAt <= Date.now()) return false
  return input.trim().toLowerCase() === entry.answer
}
