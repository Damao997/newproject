import EmbeddedPostgres from 'embedded-postgres'
import { existsSync } from 'node:fs'
import path from 'node:path'

/**
 * 本地开发数据库：以 embedded-postgres 在用户态启动真实 PostgreSQL，
 * 无需管理员权限、无需 Docker。数据目录持久化到 server/.pgdata（已 gitignore）。
 *
 * 用法：
 *   npm run db:local        # 前台启动，Ctrl+C 停止
 * 连接串（与 .env 对齐）：
 *   postgresql://postgres:postgres@localhost:5432/yipinhui_finance
 */

const dataDir = path.resolve(__dirname, '../.pgdata')
const DB_NAME = 'yipinhui_finance'

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port: 5432,
  persistent: true,
})

async function main(): Promise<void> {
  const initialised = existsSync(path.join(dataDir, 'PG_VERSION'))
  if (!initialised) {
    console.log('[db] 初始化数据目录（首次运行，可能需下载二进制）...')
    await pg.initialise()
  }
  await pg.start()
  console.log('[db] PostgreSQL 已启动：localhost:5432')

  try {
    await pg.createDatabase(DB_NAME)
    console.log(`[db] 数据库 ${DB_NAME} 已创建`)
  } catch {
    console.log(`[db] 数据库 ${DB_NAME} 已存在，跳过`)
  }

  console.log('[db] 就绪。保持运行中，按 Ctrl+C 停止。')

  const stop = async (): Promise<void> => {
    console.log('\n[db] 正在停止 PostgreSQL...')
    await pg.stop()
    process.exit(0)
  }
  process.on('SIGINT', () => void stop())
  process.on('SIGTERM', () => void stop())

  // 保持进程存活
  setInterval(() => undefined, 1 << 30)
}

main().catch((err) => {
  console.error('[db] 启动失败：', err)
  process.exit(1)
})
