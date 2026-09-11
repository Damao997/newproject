import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'

/**
 * 一次性脚本：应用 20260729100000_drop_formula_rule 迁移（纯 JS，绕开 npx/tsx 包装器）。
 * 手动执行迁移 SQL 并按 prisma 规范登记 _prisma_migrations（checksum=SHA-256）。
 * 幂等：已登记则跳过。用法：node --env-file=.env scripts/apply-drop-formula-rule.mjs
 */
const MIGRATION_NAME = '20260729100000_drop_formula_rule'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const prisma = new PrismaClient()

try {
  const applied = await prisma.$queryRawUnsafe(
    `SELECT migration_name FROM _prisma_migrations WHERE migration_name = $1`, MIGRATION_NAME,
  )
  if (applied.length > 0) {
    console.log(`[migrate] ${MIGRATION_NAME} 已应用，跳过`)
  } else {
    const sql = readFileSync(path.resolve(__dirname, `../prisma/migrations/${MIGRATION_NAME}/migration.sql`), 'utf8')
    const checksum = createHash('sha256').update(sql).digest('hex')
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "formula_rule"`)
    await prisma.$executeRawUnsafe(
      `INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
       VALUES ($1, $2, now(), $3, NULL, NULL, now(), 1)`,
      randomUUID(), checksum, MIGRATION_NAME,
    )
    console.log(`[migrate] ${MIGRATION_NAME} 应用完成 ✓`)
  }
  // 顺带回收已下线的权限码（模块删除后的存量清理）
  const removed = await prisma.$executeRawUnsafe(
    `DELETE FROM permission WHERE resource = 'data:formula-rule:manage'`,
  )
  console.log(`[migrate] 回收权限码 data:formula-rule:manage：删除 ${removed} 行`)
} catch (e) {
  console.error('[migrate] 失败：', e)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
