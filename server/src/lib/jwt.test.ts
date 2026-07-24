import { describe, it, expect } from 'vitest'
import jwt from 'jsonwebtoken'
import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  getRefreshTokenExpiry,
} from './jwt'

describe('jwt 工具', () => {
  const user = { userId: 'u1', username: 'alice', roleCode: 'admin' }

  it('签发并验证 access token', () => {
    const token = signAccessToken(user)
    const payload = verifyAccessToken(token)
    expect(payload.sub).toBe('u1')
    expect(payload.username).toBe('alice')
    expect(payload.role).toBe('admin')
    expect(payload.type).toBe('access')
  })

  it('签发并验证 refresh token，含 jti', () => {
    const { token, jti } = signRefreshToken('u1')
    expect(jti).toBeTruthy()
    const payload = verifyRefreshToken(token)
    expect(payload.sub).toBe('u1')
    expect(payload.jti).toBe(jti)
    expect(payload.type).toBe('refresh')
  })

  it('access token 不能当作 refresh 校验（密钥不同）', () => {
    const token = signAccessToken(user)
    expect(() => verifyRefreshToken(token)).toThrow()
  })

  it('refresh token 不能当作 access 校验（密钥不同）', () => {
    const { token } = signRefreshToken('u1')
    expect(() => verifyAccessToken(token)).toThrow()
  })

  it('拒绝伪造/篡改的 token', () => {
    expect(() => verifyAccessToken('not.a.jwt')).toThrow()
  })

  it('解析 refresh token 过期时间为将来时刻', () => {
    const { token } = signRefreshToken('u1')
    const exp = getRefreshTokenExpiry(token)
    expect(exp.getTime()).toBeGreaterThan(Date.now())
  })

  it('type 字段不符时拒绝（同密钥但类型错误）', () => {
    // 用 access 密钥签发一个 type=refresh 的伪 token，verifyAccessToken 应因 type 拒绝
    const fake = jwt.sign({ sub: 'u1', type: 'refresh' }, process.env.JWT_SECRET as string)
    expect(() => verifyAccessToken(fake)).toThrow()
  })
})
