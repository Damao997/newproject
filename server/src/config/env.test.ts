import { describe, it, expect, afterEach, vi } from 'vitest'
import type { AppConfig } from './env'
import { emailCollectionRequired } from './env'

/** 收集开关的取值组合（其余 SMTP 字段只关心是否配齐） */
function config(emailCollectionEnabled: boolean, smtpHost: string | null, mailFrom: string | null) {
  return { emailCollectionEnabled, smtpHost, mailFrom } as Pick<AppConfig, 'emailCollectionEnabled' | 'smtpHost' | 'mailFrom'>
}

describe('emailCollectionRequired（邮箱收集引导开关口径）', () => {
  it('开关开启且邮件可用时才拦截', () => {
    expect(emailCollectionRequired(config(true, 'smtp.163.com', 'no-reply@163.com'))).toBe(true)
  })

  it('开关关闭时不拦截（默认值）', () => {
    expect(emailCollectionRequired(config(false, 'smtp.163.com', 'no-reply@163.com'))).toBe(false)
  })

  it('SMTP 未配置时不拦截：收了邮箱也发不出找回邮件', () => {
    expect(emailCollectionRequired(config(true, null, 'no-reply@163.com'))).toBe(false)
    expect(emailCollectionRequired(config(true, 'smtp.163.com', null))).toBe(false)
  })
})

describe('EMAIL_COLLECTION_ENABLED 环境变量解析', () => {
  const originalValue = process.env.EMAIL_COLLECTION_ENABLED
  const originalHost = process.env.SMTP_HOST
  const originalFrom = process.env.MAIL_FROM

  afterEach(() => {
    // 还原环境变量：模块级缓存已由 vi.resetModules 隔离，但 process.env 是全局的
    for (const [key, value] of [['EMAIL_COLLECTION_ENABLED', originalValue], ['SMTP_HOST', originalHost], ['MAIL_FROM', originalFrom]] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    vi.resetModules()
  })

  /** 重新加载 env 模块（loadConfig 有模块级缓存，必须换一份模块实例才能重读环境变量） */
  async function reloadConfig() {
    vi.resetModules()
    const mod = await import('./env')
    return mod.loadConfig()
  }

  it('未设置（空值）时默认关闭', async () => {
    // 置空而非删除：dotenv 不会覆盖已存在的键，这样本机 server/.env 里的真实配置不会漏进用例
    process.env.EMAIL_COLLECTION_ENABLED = ''
    const config = await reloadConfig()
    expect(config.emailCollectionEnabled).toBe(false)
    expect(emailCollectionRequired(config)).toBe(false)
  })

  it('设置为 1 且 SMTP 已配置时生效', async () => {
    process.env.EMAIL_COLLECTION_ENABLED = '1'
    process.env.SMTP_HOST = 'smtp.163.com'
    process.env.MAIL_FROM = '浙壹品慧 <no-reply@163.com>'
    const config = await reloadConfig()
    expect(config.emailCollectionEnabled).toBe(true)
    expect(emailCollectionRequired(config)).toBe(true)
  })

  it('设置为 1 但 SMTP 未配置时不生效', async () => {
    process.env.EMAIL_COLLECTION_ENABLED = '1'
    process.env.SMTP_HOST = ''
    process.env.MAIL_FROM = ''
    const config = await reloadConfig()
    expect(config.emailCollectionEnabled).toBe(true)
    expect(emailCollectionRequired(config)).toBe(false)
  })
})
