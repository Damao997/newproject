/**
 * dev-config.mjs —— 开发环境端口解析与探测工具（唯一实现）
 *
 * 端口来源（单一来源，详见 docs/本地开发环境启动指南.md）：
 *   数据库   server/.env 的 DATABASE_URL（端口），DB_PORT 可覆盖
 *   后端     server/.env 的 PORT
 *   前端     代码默认 5173，VITE_DEV_PORT 可覆盖
 *
 * 供根目录 Node 脚本复用（dev-up.mjs / dev-check.mjs）；仅用 Node 内置模块，无第三方依赖。
 * 注意：本文件不引入任何副作用（仅定义函数与常量），可被 node 直接 import。
 */
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 仓库根目录（本文件位于 <root>/scripts/） */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** server/.env 路径 */
export const SERVER_ENV_FILE = path.join(REPO_ROOT, 'server', '.env')

/** 开发三端口的默认值（仅当配置缺失时兜底；正常应来自 server/.env / 环境变量） */
export const DEV_PORT_DEFAULTS = { db: 5432, api: 3001, web: 5173 }

/**
 * 解析 .env 文件（简单 key=value，支持引号包裹与 # 注释）。
 * @param {string} file
 * @returns {Record<string,string>}
 */
export function parseEnvFile(file) {
  const env = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m || line.trimStart().startsWith('#')) continue
    let value = m[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    env[m[1]] = value
  }
  return env
}

/** 读取 .env（不存在时返回空对象，不抛错） */
export function readEnvIfExists(file) {
  return existsSync(file) ? parseEnvFile(file) : {}
}

/**
 * 从 PostgreSQL 连接串解析端口。
 * 例：postgresql://user:pw@localhost:5432/db?schema=public → 5432
 * @param {string|undefined} url
 * @returns {number|undefined} 解析失败返回 undefined
 */
export function portFromDatabaseUrl(url) {
  if (!url) return undefined
  try {
    // URL 不认 postgresql:// 自定义协议，换成 http:// 仅为取端口（不发起请求）
    const parsed = new URL(String(url).replace(/^postgres(ql)?:\/\//, 'http://'))
    const port = Number(parsed.port)
    return Number.isInteger(port) && port > 0 ? port : undefined
  } catch {
    return undefined
  }
}

/** 端口值校验：必须为 1..65535 的整数，否则抛出明确错误 */
export function toPort(value, label) {
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} 端口非法：${value}（需为 1..65535 的整数）`)
  }
  return port
}

/**
 * 解析开发环境三端口。
 * 优先级：进程环境变量 > server/.env 配置 > DATABASE_URL 端口 > 默认值。
 * @param {string} [root]
 * @returns {{ db: number, api: number, web: number }}
 */
export function resolveDevPorts(root = REPO_ROOT) {
  const serverEnv = readEnvIfExists(path.join(root, 'server', '.env'))
  return {
    db: toPort(
      process.env.DB_PORT ?? serverEnv.DB_PORT ?? portFromDatabaseUrl(serverEnv.DATABASE_URL) ?? DEV_PORT_DEFAULTS.db,
      'DB_PORT',
    ),
    api: toPort(process.env.PORT ?? serverEnv.PORT ?? DEV_PORT_DEFAULTS.api, 'PORT'),
    web: toPort(process.env.VITE_DEV_PORT ?? DEV_PORT_DEFAULTS.web, 'VITE_DEV_PORT'),
  }
}

/** 解析 server/.env 的 FRONTEND_ORIGIN（用于 CORS 白名单一致性检查） */
export function resolveFrontendOrigin(root = REPO_ROOT) {
  return readEnvIfExists(path.join(root, 'server', '.env')).FRONTEND_ORIGIN || ''
}

/** TCP 探测：目标端口是否可连接 */
export function tcpProbe(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const sock = net.connect(port, host)
    sock.setTimeout(1500)
    sock.once('connect', () => {
      sock.destroy()
      resolve(true)
    })
    sock.once('error', () => {
      sock.destroy()
      resolve(false)
    })
    sock.once('timeout', () => {
      sock.destroy()
      resolve(false)
    })
  })
}

/**
 * 查询端口监听者进程名（仅用于展示，失败返回 null）。
 * Windows 下用 netstat 解析 PID，再经 tasklist 取进程名；其他平台尽力而为。
 * @returns {Promise<{pid: number, name: string}|null>}
 */
export async function portOwner(port) {
  const { spawnSync } = await import('node:child_process')
  try {
    if (process.platform === 'win32') {
      const out = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' }).stdout || ''
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i)
        if (m && Number(m[1]) === port) {
          const pid = Number(m[2])
          const tl = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).stdout || ''
          const name = (tl.split(',')[0] || '').replace(/"/g, '').trim() || 'unknown'
          return { pid, name }
        }
      }
      return null
    }
    const out = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout || ''
    const line = out.split(/\r?\n/)[1]
    if (!line) return null
    const parts = line.trim().split(/\s+/)
    return { pid: Number(parts[1]) || 0, name: parts[0] || 'unknown' }
  } catch {
    return null
  }
}