import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 部署 SQL 物料语法与语义校验（init-roles.sql / post-migration-fix-permissions.sql）。
 *
 * 本机无 psql 客户端，故：
 *   - 剥离 psql 客户端指令（\set），把 :'app_password' 替换为测试口令
 *   - 在一次性临时数据库中执行，验证 PL/pgSQL 语法与权限语义
 *   - 结束后彻底清理（DROP ROLE + DROP DATABASE）
 *
 * 注意：绝不在开发库执行 —— init-roles.sql 含
 *      REVOKE ALL ON SCHEMA public FROM PUBLIC，会破坏本地开发环境。
 */

const SCRATCH_DB = 'yipinhui_deploy_check'
const TEST_ROLE = 'yipinhui_app'
const TEST_PWD = 'test_only_password_1234567890'

const adminUrl = process.env.DATABASE_URL
if (!adminUrl) throw new Error('DATABASE_URL not set')

const scratchUrl = adminUrl.replace(/\/[^/?]+(\?|$)/, `/${SCRATCH_DB}$1`)

/** 去掉 psql 客户端专用指令，并注入测试口令 */
function prepareSql(file: string): string {
  const raw = readFileSync(join(__dirname, '..', 'prisma', file), 'utf8')
  return raw
    .split('\n')
    .filter((line) => !/^\s*\\/.test(line))
    .join('\n')
    .replace(/:'app_password'/g, `'${TEST_PWD}'`)
}

/** 剥离前导的纯注释行与空行，返回真正的 SQL 主体 */
function stripLeadingComments(stmt: string): string {
  const lines = stmt.split('\n')
  let i = 0
  while (i < lines.length) {
    const t = (lines[i] ?? '').trim()
    if (t === '' || t.startsWith('--')) i++
    else break
  }
  return lines.slice(i).join('\n').trim()
}

/** 按顶层分号切分语句，同时保留 $do$ ... $do$ 块的完整性 */
function splitStatements(sql: string): string[] {
  const out: string[] = []
  let buf = ''
  let inDollar = false
  for (const line of sql.split('\n')) {
    const hits = (line.match(/\$do\$/g) ?? []).length
    if (hits % 2 === 1) inDollar = !inDollar
    buf += line + '\n'
    if (!inDollar && /;\s*$/.test(line.trim())) {
      // 关键：不能因"整段以 -- 开头"就丢弃 —— 注释后面往往紧跟 DO 块。
      // 必须先剥离前导注释再判断是否为空。
      const stmt = stripLeadingComments(buf)
      if (stmt) out.push(stmt)
      buf = ''
    }
  }
  const tail = stripLeadingComments(buf)
  if (tail) out.push(tail)
  return out
}

/** Prisma 报错常以换行开头，取首个非空行 */
function firstLine(e: unknown): string {
  const msg = (e as Error).message ?? String(e)
  return msg.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4).join(' | ')
}

async function run(): Promise<void> {
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } })
  let scratch: PrismaClient | null = null
  let failed = false

  try {
    console.log(`[setup] scratch db = ${SCRATCH_DB}`)
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`)
    await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS "${TEST_ROLE}"`)
    await admin.$executeRawUnsafe(`CREATE DATABASE "${SCRATCH_DB}"`)

    scratch = new PrismaClient({ datasources: { db: { url: scratchUrl } } })

    const initSql = prepareSql('init-roles.sql').replace(
      /ON DATABASE yipinhui\b/g,
      `ON DATABASE "${SCRATCH_DB}"`,
    )

    console.log('[run] init-roles.sql')
    for (const stmt of splitStatements(initSql)) {
      try {
        await scratch.$executeRawUnsafe(stmt)
      } catch (e) {
        failed = true
        console.error('  FAIL stmt: ' + stmt.replace(/\s+/g, ' ').slice(0, 120))
        console.error('    -> ' + firstLine(e))
      }
    }

    const role = await scratch.$queryRawUnsafe<{ rolname: string; rolsuper: boolean; rolcreatedb: boolean }[]>(
      `SELECT rolname, rolsuper, rolcreatedb FROM pg_roles WHERE rolname = '${TEST_ROLE}'`,
    )
    console.log('[check] role =', JSON.stringify(role))
    if (role.length === 0) {
      failed = true
      console.error('  FAIL: business role not created')
    } else if (role[0]?.rolsuper || role[0]?.rolcreatedb) {
      failed = true
      console.error('  FAIL: business role over-privileged')
    }

    await scratch.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now())`,
    )
    await scratch.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS token_blacklist (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), expired_at timestamptz)`,
    )
    await scratch.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS company (code text PRIMARY KEY, name text)`,
    )

    console.log('[run] post-migration-fix-permissions.sql')
    for (const stmt of splitStatements(prepareSql('post-migration-fix-permissions.sql'))) {
      try {
        await scratch.$executeRawUnsafe(stmt)
      } catch (e) {
        failed = true
        console.error('  FAIL stmt: ' + stmt.replace(/\s+/g, ' ').slice(0, 120))
        console.error('    -> ' + firstLine(e))
      }
    }

    const perms = await scratch.$queryRawUnsafe<{ table_name: string; privilege_type: string }[]>(
      `SELECT table_name, privilege_type FROM information_schema.table_privileges
        WHERE grantee = '${TEST_ROLE}' AND table_schema = 'public'
        ORDER BY table_name, privilege_type`,
    )
    const summary = perms.reduce<Record<string, string[]>>((acc, p) => {
      ;(acc[p.table_name] ??= []).push(p.privilege_type)
      return acc
    }, {})
    console.log('[check] table privileges =', JSON.stringify(summary))

    for (const t of ['audit_log', 'token_blacklist']) {
      const got = (summary[t] ?? []).sort().join(',')
      if (got !== 'INSERT,SELECT') {
        failed = true
        console.error(`  FAIL: ${t} expected INSERT,SELECT but got ${got || '(none)'}`)
      }
    }
    // 普通业务表应保有完整 DML
    const companyPerms = (summary['company'] ?? []).sort().join(',')
    if (companyPerms !== 'DELETE,INSERT,SELECT,UPDATE') {
      failed = true
      console.error(`  FAIL: company expected full DML but got ${companyPerms || '(none)'}`)
    }

    // 业务账号不得具备建表能力
    const canCreate = await scratch.$queryRawUnsafe<{ has: boolean }[]>(
      `SELECT has_schema_privilege('${TEST_ROLE}', 'public', 'CREATE') AS has`,
    )
    console.log('[check] can CREATE in schema public =', canCreate[0]?.has)
    if (canCreate[0]?.has) {
      failed = true
      console.error('  FAIL: business role still has DDL (CREATE) on schema public')
    }

    console.log(failed ? '\nRESULT: FAILED' : '\nRESULT: ALL PASSED')
  } finally {
    await scratch?.$disconnect()
    try {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB}"`)
      await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS "${TEST_ROLE}"`)
      console.log('[cleanup] scratch db and test role dropped')
    } catch (e) {
      console.error('[cleanup] FAILED, please clean manually: ' + firstLine(e))
    }
    await admin.$disconnect()
  }

  if (failed) process.exitCode = 1
}

run().catch((e) => {
  console.error('script error: ' + firstLine(e))
  process.exitCode = 1
})
