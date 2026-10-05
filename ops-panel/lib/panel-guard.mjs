/**
 * 运维面板本地安全护栏：令牌、Host 白名单与审计记录。
 * 纯函数 + 本地文件读写，仅用 Node 内置模块，可被 node --test 直接单测。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const TOKEN_HEADER = 'x-ops-token'

/** 生成 32 字节随机令牌（64 位十六进制）。 */
export function createToken() {
  return crypto.randomBytes(32).toString('hex')
}

/** 读取已有令牌；文件缺失或为空时生成并写入（Windows ACL 由 start-panel.ps1 收紧）。 */
export function loadOrCreateToken(file) {
  try {
    const existing = fs.readFileSync(file, 'utf8').trim()
    if (existing) return existing
  } catch { /* 首次启动或文件不可读，走生成分支 */ }
  const token = createToken()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, token + '\n', { encoding: 'utf8', mode: 0o600 })
  return token
}

/** Host 头白名单：仅回环主机名 + 面板端口，阻断 DNS rebinding。 */
export function isAllowedHost(hostHeader, port) {
  if (!hostHeader) return false
  const host = String(hostHeader).toLowerCase()
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`
}

/** 常量时间比较令牌，避免时序侧信道。 */
export function tokenMatches(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false
  if (!provided || !expected) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/** 单行 JSON 审计记录；敏感值由调用方先行掩码。 */
export function auditLine(fields) {
  return JSON.stringify({ time: new Date().toISOString(), ...fields }) + '\n'
}
