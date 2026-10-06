import bcrypt from 'bcryptjs'
import { loadConfig } from '../config/env'
import { errors } from './errors'

/** 密码哈希（bcrypt cost >= 12，见 docs/references/security.md） */
export async function hashPassword(plain: string): Promise<string> {
  const cost = loadConfig().bcryptCost
  return bcrypt.hash(plain, cost)
}

/** 校验明文密码与哈希 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

/** 密码规则（与改密 updatePasswordSchema 一致）：至少 8 位且含字母与数字 */
export function assertPasswordRule(password: string): void {
  if (!password || password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw errors.badRequest('密码至少 8 位，且需同时包含字母与数字')
  }
}
