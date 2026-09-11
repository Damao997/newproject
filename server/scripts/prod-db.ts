import dotenv from 'dotenv'
import EmbeddedPostgres from 'embedded-postgres'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

dotenv.config()

// 演练提醒：本地启动生产实例仅用于恢复演练等场景，正常生产由 PM2 托管。
if (process.env.NODE_ENV !== 'production') {
  console.warn('[prod-db] 警告：NODE_ENV 非 production，当前为本地演练模式，请确认不会影响开发库。')
}

/**
 * 生产数据库启动器：与开发库（local-db.ts → server/.pgdata:5432）完全隔离的
 * 第二个嵌入式 PostgreSQL 实例，供 ZJYPH 生产环境使用。
 *
 * 环境变量（在 server/.env 中配置）：
 *   ZJYPH_DATA_DIR    生产数据目录（默认 D:\ZJYPH-data）
 *   ZJYPH_PG_PORT     监听端口（默认 5433，仅回环）
 *   ZJYPH_DB_NAME     生产库名（默认 zjyph_prod）
 *   ZJYPH_PG_PASSWORD postgres 超级用户密码（必填，初始化时写入）
 *
 * 用法：
 *   npm run db:prod               # 前台启动（调试用）
 *   生产环境由 PM2 托管（见 zjyph-ecosystem.config.cjs，进程 zjyph-postgres）
 */

const dataDir = process.env.ZJYPH_DATA_DIR || 'D:\\ZJYPH-data'
const port = Number(process.env.ZJYPH_PG_PORT || 5433)
const dbName = process.env.ZJYPH_DB_NAME || 'zjyph_prod'
const password = process.env.ZJYPH_PG_PASSWORD

if (!password || password.length < 12) {
  console.error('[prod-db] 错误：ZJYPH_PG_PASSWORD 未配置或长度不足（要求 ≥12 字符）')
  process.exit(1)
}

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password,
  port,
  persistent: true,
  // 仅回环监听，不暴露到内网其他主机（与 docker-compose 的 127.0.0.1 绑定一致）
  postgresFlags: ['-c', 'listen_addresses=127.0.0.1'],
})

// ── 心跳检测：防止"假在线"僵尸状态 ─────────────────────────
// postmaster 被外部终止（如 Windows 控制台 Ctrl+C 广播）时，本包装进程收不到
// 信号仍会存活，PM2 误判 online 而不触发 autorestart（2026-08-12 事故根因）。
// 定期探测监听端口，连续失败即以非 0 退出，让 PM2 自动重启拉起新实例。
const HEARTBEAT_INTERVAL_MS = 15_000
const HEARTBEAT_MAX_FAILURES = 3

function startHeartbeat(listenPort: number): void {
  let failures = 0
  setInterval(() => {
    const sock = net.connect(listenPort, '127.0.0.1')
    let counted = false
    const fail = (reason: string): void => {
      // 同一连接 timeout/error 可能先后触发：仅首次计入失败，避免单次探测双计数
      if (counted) return
      counted = true
      failures += 1
      sock.destroy()
      console.error(`[prod-db] 心跳检测失败（${reason}：${failures}/${HEARTBEAT_MAX_FAILURES}）`)
      if (failures >= HEARTBEAT_MAX_FAILURES) {
        console.error('[prod-db] PostgreSQL 无响应，退出以触发 PM2 自动重启')
        process.exit(1)
      }
    }
    sock.setTimeout(3_000)
    sock.once('connect', () => {
      failures = 0
      sock.destroy()
    })
    sock.once('error', () => fail('连接被拒'))
    sock.once('timeout', () => fail('超时'))
  }, HEARTBEAT_INTERVAL_MS)
}

async function main(): Promise<void> {
  const initialised = existsSync(path.join(dataDir, 'PG_VERSION'))
  if (!initialised) {
    console.log(`[prod-db] 初始化生产数据目录（首次运行）：${dataDir}`)
    await pg.initialise()
    console.log('[prod-db] 初始化完成')
  }
  await pg.start()
  console.log(`[prod-db] PostgreSQL 已启动：127.0.0.1:${port}（数据目录 ${dataDir}）`)
  startHeartbeat(port)

  try {
    await pg.createDatabase(dbName)
    console.log(`[prod-db] 数据库 ${dbName} 已创建`)
  } catch {
    console.log(`[prod-db] 数据库 ${dbName} 已存在，跳过`)
  }

  console.log('[prod-db] 就绪。保持运行中（PM2 托管），按 Ctrl+C 停止。')

  const stop = async (): Promise<void> => {
    console.log('\n[prod-db] 正在停止 PostgreSQL...')
    await pg.stop()
    process.exit(0)
  }
  process.on('SIGINT', () => void stop())
  process.on('SIGTERM', () => void stop())

  // 保持进程存活
  setInterval(() => undefined, 1 << 30)
}

main().catch((err) => {
  console.error('[prod-db] 启动失败：', err)
  process.exit(1)
})
