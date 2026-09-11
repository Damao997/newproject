import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword } from './password'

describe('password 哈希', () => {
  it('哈希后可校验通过', async () => {
    const hash = await hashPassword('Yipinhui@2026')
    expect(hash).not.toBe('Yipinhui@2026')
    expect(await verifyPassword('Yipinhui@2026', hash)).toBe(true)
  })

  it('错误密码校验失败', async () => {
    const hash = await hashPassword('Yipinhui@2026')
    expect(await verifyPassword('wrong-password', hash)).toBe(false)
  })

  it('bcrypt 前缀（cost>=12）', async () => {
    const hash = await hashPassword('anything123')
    // $2a$12$ 或 $2b$12$ 前缀，cost 段为 12
    expect(hash).toMatch(/^\$2[aby]\$12\$/)
  })
})
