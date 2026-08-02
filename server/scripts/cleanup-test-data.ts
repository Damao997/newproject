/* eslint-disable no-console */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

/**
 * 本地模拟生产环境清理脚本：清空业务/运行时数据，保留主数据。
 *
 * 用途：将开发库中的测试业务数据（导入批次、事实表、往来/存货、报告、
 * 审计日志等）安全清除，使数据库进入"主数据 + 空业务数据"的模拟生产状态。
 *
 * 用法（server 目录下）：
 *   npx tsx scripts/cleanup-test-data.ts
 *
 * 安全须知：
 *   - TRUNCATE 不可回滚，执行前必须先备份（见计划：停库复制 server/.pgdata）
 *   - 脚本先输出清理前各表行数基线，TRUNCATE 后再输出清理后行数用于验证
 *   - 主数据表（company/account_subject/metric/user/role/permission 等）不清空，仅统计
 */
const prisma = new PrismaClient()

// 业务/运行时表：模拟生产前清空
const BUSINESS_TABLES = [
  'fact_operating',
  'fact_static',
  'fact_budget',
  'transaction_detail',
  'aging_record',
  'collection_plan',
  'collection_log',
  'inventory_record',
  'report',
  'report_section',
  'report_version',
  'report_comment',
  'report_share',
  'subject_analysis',
  'import_batch',
  'mapping_scheme',
  'reclassification_log',
  'enterprise_info',
  'enterprise_query_log',
  'audit_log',
  'token_blacklist',
  'alert',
]

// 主数据表：保留（仅统计行数验证）
const MASTER_TABLES = [
  'company',
  'company_aggregation_map',
  'account_subject',
  'period_dimension',
  'transaction_account',
  'counterparty',
  'dimension',
  'dimension_member',
  'metric',
  'metric_definition_history',
  'user',
  'role',
  'permission',
  'ai_desensitize_config',
]

async function countRows(table: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM "${table}"`,
  )
  return rows[0]?.n ?? -1
}

async function main(): Promise<void> {
  console.log('=== [1/4] 清理前基线（业务表） ===')
  const before = new Map<string, number>()
  for (const t of BUSINESS_TABLES) {
    const n = await countRows(t)
    before.set(t, n)
    console.log(`  ${t}: ${n} 行`)
  }

  console.log('=== [2/4] 执行 TRUNCATE ... CASCADE ===')
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${BUSINESS_TABLES.join(', ')} CASCADE`,
  )
  console.log('  TRUNCATE 完成')

  console.log('=== [3/4] 清理后验证（业务表应为 0） ===')
  let totalAfter = 0
  for (const t of BUSINESS_TABLES) {
    const n = await countRows(t)
    totalAfter += n
    console.log(`  ${t}: ${n} 行`)
  }
  if (totalAfter !== 0) {
    throw new Error(`业务表清理后仍有 ${totalAfter} 行残留，中止`)
  }

  console.log('=== [4/4] 主数据表保留确认（应 > 0） ===')
  for (const t of MASTER_TABLES) {
    const n = await countRows(t)
    console.log(`  ${t}: ${n} 行`)
  }

  console.log('[cleanup] 清理完成 ✓')
}

main()
  .catch((e) => {
    console.error('[cleanup] 失败：', e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
