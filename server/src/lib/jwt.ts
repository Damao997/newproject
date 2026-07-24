import jwt, { type SignOptions } from 'jsonwebtoken'
import { randomUUID } from 'node:crypto'
import { loadConfig } from '../config/env'

/**
 * JWT 工具：签发/验证 access（短期）与 refresh（长期含 jti，用于轮转与黑名单）。
 */

export interface AccessTokenPayload {
  sub: string // userId
  username: string
  role: string // roleCode
  type: 'access'
}

export interface RefreshTokenPayload {
  sub: string // userId
  jti: string // token 唯一 ID，用于黑名单与轮转
  type: 'refresh'
}

export function signAccessToken(input: { userId: string; username: string; roleCode: string }): string {
  const cfg = loadConfig()
  const payload: AccessTokenPayload = {
    sub: input.userId,
    username: input.username,
    role: input.roleCode,
    type: 'access',
  }
  const options: SignOptions = { expiresIn: cfg.accessTokenTtl as SignOptions['expiresIn'] }
  return jwt.sign(payload, cfg.jwtSecret, options)
}

/** 签发 refresh token，返回 token 与其 jti（供落库/轮转记录） */
export function signRefreshToken(userId: string): { token: string; jti: string } {
  const cfg = loadConfig()
  const jti = randomUUID()
  const payload: RefreshTokenPayload = { sub: userId, jti, type: 'refresh' }
  const options: SignOptions = { expiresIn: cfg.refreshTokenTtl as SignOptions['expiresIn'] }
  const token = jwt.sign(payload, cfg.jwtRefreshSecret, options)
  return { token, jti }
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  const cfg = loadConfig()
  const decoded = jwt.verify(token, cfg.jwtSecret) as AccessTokenPayload
  if (decoded.type !== 'access') {
    throw new jwt.JsonWebTokenError('token 类型错误')
  }
  return decoded
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  const cfg = loadConfig()
  const decoded = jwt.verify(token, cfg.jwtRefreshSecret) as RefreshTokenPayload
  if (decoded.type !== 'refresh') {
    throw new jwt.JsonWebTokenError('token 类型错误')
  }
  return decoded
}

/** 解析 refresh token 的过期时间（用于写入黑名单 expiredAt） */
export function getRefreshTokenExpiry(token: string): Date {
  const decoded = jwt.decode(token) as { exp?: number } | null
  if (decoded?.exp) {
    return new Date(decoded.exp * 1000)
  }
  // 兜底：按 7 天
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
}
