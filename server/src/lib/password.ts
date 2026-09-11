import bcrypt from 'bcryptjs'
import { loadConfig } from '../config/env'

/** 密码哈希（bcrypt cost >= 12，见 docs/references/security.md） */
export async function hashPassword(plain: string): Promise<string> {
  const cost = loadConfig().bcryptCost
  return bcrypt.hash(plain, cost)
}

/** 校验明文密码与哈希 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
