#!/usr/bin/env node
/**
 * 数据迁移：开发库 → ZJYPH 生产库（Windows / 非 Docker 环境）
 *
 * 一次性/可重复的整库数据迁移（不迁移 _prisma_migrations，保留生产库自身的迁移记录）。
 * 基于 pg 包原生 COPY 协议（零外部工具依赖）：
 *   1. 目标会话 SET session_replication_role = replica（绕过外键顺序约束）
 *   2. 逐表 COPY 流式传输（源 SELECT * 与目标表列序一致）
 *   3. 同步序列（Prisma 自增列，防止未来主键冲突）
 *   4. 恢复 replication role
 *
 * 用法：
 *   node scripts/migrate-data.mjs ^
 *     --source "postgresql://postgres:postgres@127.0.0.1:5432/yipinhui_finance" ^
 *     --target "postgresql://postgres:xxx@127.0.0.1:5433/zjyph_prod" ^
 *     [--truncate-target]
 *
 * 说明：
 *   - 按"源表与目标表的列交集"迁移，容忍开发库 schema 漂移
 *     （开发库存在未提交迁移的列时，该列数据不进入生产基线）
 *   - --truncate-target：迁移前清空目标业务表，保证可重复全量迁移
 *   - 迁移过程无事务包裹：中途失败会留下半迁移状态（已 COPY 的表保留），
 *     必须带 --truncate-target 重新执行以回到一致基线
 *
 * 前置条件：目标库已执行 prisma migrate deploy（表结构一致）
 */
import { Client } from 'pg'
import { from, to } from 'pg-copy-streams'

const args = process.argv.slice(2)
function argValue(name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const sourceUrl = argValue('--source')
const targetUrl = argValue('--target')
const truncateTarget = args.includes('--truncate-target')
if (!sourceUrl || !targetUrl) {
  console.error('用法：node scripts/migrate-data.mjs --source <url> --target <url> [--truncate-target]')
  process.exit(1)
}

const src = new Client({ connectionString: sourceUrl })
const dst = new Client({ connectionString: targetUrl })

function log(msg) {
  console.log(`[migrate-data] ${new Date().toISOString()} ${msg}`)
}

try {
  await src.connect()
  await dst.connect()
  log('源库与目标库已连接')

  // 1. 列出源库 public schema 下的业务表（排除 Prisma 迁移记录表）
  const tables = await src.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename != '_prisma_migrations' ORDER BY tablename`,
  )
  log(`待迁移表数量：${tables.rows.length}`)

  // 2. 目标会话绕过外键检查
  await dst.query('SET session_replication_role = replica')

  // 3. 可选：清空目标业务表（保证可重复全量迁移）
  if (truncateTarget) {
    log('清空目标业务表（--truncate-target）')
    for (const { tablename } of tables.rows) {
      await dst.query(`TRUNCATE TABLE "${tablename}" CASCADE`)
    }
  }

  const colQuery = `SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public' ORDER BY ordinal_position`

  let totalRows = 0
  for (const { tablename } of tables.rows) {
    // 列交集：容忍开发库 schema 漂移（多出的列不迁移）
    const srcCols = (await src.query(colQuery, [tablename])).rows.map((r) => r.column_name)
    const dstCols = (await dst.query(colQuery, [tablename])).rows.map((r) => r.column_name)
    const cols = srcCols.filter((c) => dstCols.includes(c))
    if (cols.length === 0) {
      log(`  - ${tablename} 跳过（无共同列）`)
      continue
    }
    const colList = cols.map((c) => `"${c}"`).join(', ')
    // pg-copy-streams：to() = COPY TO STDOUT 读流；from() = COPY FROM STDIN 写流
    const read = src.query(to(`COPY (SELECT ${colList} FROM "${tablename}") TO STDOUT`))
    const write = dst.query(from(`COPY "${tablename}" (${colList}) FROM STDIN`))
    await new Promise((resolve, reject) => {
      read.on('error', reject)
      write.on('error', reject)
      write.on('finish', resolve)
      read.pipe(write)
    })
    log(`  - ${tablename} 完成`)
  }

  // 3. 序列同步：对每个 nextval 默认值的列，setval 到当前最大值
  const seqs = await src.query(
    `SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_default LIKE 'nextval%'`,
  )
  for (const { table_name, column_name } of seqs.rows) {
    await dst.query(`SELECT setval(pg_get_serial_sequence('"${table_name}"', '${column_name}'), COALESCE(MAX("${column_name}"), 1), true) FROM "${table_name}"`)
    log(`  - 序列同步：${table_name}.${column_name}`)
  }

  // 4. 恢复 replication role
  await dst.query('RESET session_replication_role')

  log(`数据迁移完成，共处理 ${tables.rows.length} 张表`)
} catch (err) {
  console.error('[migrate-data] 迁移失败：', err)
  process.exitCode = 1
} finally {
  await src.end().catch(() => undefined)
  await dst.end().catch(() => undefined)
}
