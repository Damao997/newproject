/**
 * dev-db-check.ts —— 开发库连通性与读写验证
 *
 * 用途：证明「后端能经 server/.env 的 DATABASE_URL（端口）对开发库完成读写」。
 *   npm run dev:db-check            （server/ 目录）
 *   npm run --prefix server dev:db-check
 *
 * 只读校验业务表行数；写验证使用会话级临时表，不触碰任何业务表。
 * 连接串由 server/.env 的 DATABASE_URL 唯一决定（与 Prisma 运行时一致）。
 */
import { PrismaClient } from '@prisma/client'
import path from 'node:path'
import dotenv from 'dotenv'

// 显式指向 server/.env（与 cwd 解耦），保证与后端运行时读到同一份配置
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const prisma = new PrismaClient()

/** 打码连接串中的口令，便于安全打印 */
function maskDatabaseUrl(url: string): string {
  return url.replace(/(:\/\/[^:/@]+:)[^@]*(@)/, '$1***$2')
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL 未配置，无法验证数据库连通性')
  console.log(`[db-check] 目标连接：${maskDatabaseUrl(url)}`)

  // 1) 连接性
  const one = await prisma.$queryRaw<Array<{ ok: number }>>`SELECT 1 AS ok`
  if (one[0]?.ok !== 1) throw new Error('SELECT 1 返回异常')
  console.log('[db-check] 连接性：SELECT 1 → OK')

  // 2) 读：统计真实业务表行数
  const [subjects, companies] = await Promise.all([prisma.accountSubject.count(), prisma.company.count()])
  console.log(`[db-check] 读：account_subject=${subjects} 行，company=${companies} 行 → OK`)

  // 3) 写：临时表需在同一连接内可见，故置于交互式事务中；结束后 DROP，不触碰业务表
  const written = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('CREATE TEMP TABLE dev_check_probe (id integer)')
    await tx.$executeRawUnsafe('INSERT INTO dev_check_probe (id) VALUES (1)')
    const rows = await tx.$queryRawUnsafe<Array<{ n: number }>>('SELECT count(*)::int AS n FROM dev_check_probe')
    await tx.$executeRawUnsafe('DROP TABLE dev_check_probe')
    return rows[0]?.n ?? 0
  })
  if (written !== 1) throw new Error(`临时表写入读回行数异常：${written}`)
  console.log('[db-check] 写：临时表写入并读回 1 行 → OK')

  console.log('[db-check] 数据库读写验证通过')
}

main()
  .catch((err) => {
    console.error('[db-check] 数据库读写验证失败：', err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => void prisma.$disconnect())