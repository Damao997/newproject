/* eslint-disable no-console */
// 往来相关数据迁移：主工作树库（5432 旧体系）→ 独立库（5434 新体系）
// 范围：company / company_aggregation_map / import_batch(transaction) / counterparty /
//       transaction_detail / customer_ext / salesman / salesman_company / collection_plan / aging_record
import { PrismaClient } from '@prisma/client'

const master = new PrismaClient({
  datasources: { db: { url: 'postgresql://postgres:postgres@localhost:5432/yipinhui_finance?schema=public' } },
})
const target = new PrismaClient() // 默认 .env DATABASE_URL（5434）

const BATCH = 500

async function copyTable<T extends { id: string }>(
  table: 'company' | 'companyAggregationMap' | 'counterparty' | 'customerExt' | 'salesman' | 'salesmanCompany' | 'collectionPlan' | 'agingRecord',
  opts: { clear?: boolean; where?: Record<string, unknown> } = {},
): Promise<number> {
  if (opts.clear) {
    await (target[table] as unknown as { deleteMany: (q: { where?: Record<string, unknown> }) => Promise<unknown> }).deleteMany({})
  }
  let total = 0
  let lastId: string | null = null
  for (;;) {
    const rows = await (master[table] as unknown as { findMany: (q: unknown) => Promise<T[]> }).findMany({
      where: { ...(opts.where ?? {}), ...(lastId ? { id: { gt: lastId } } : {}) },
      orderBy: { id: 'asc' },
      take: BATCH,
    })
    if (rows.length === 0) break
    for (let i = 0; i < rows.length; i += BATCH) {
      await (target[table] as unknown as { createMany: (q: { data: unknown[]; skipDuplicates?: boolean }) => Promise<unknown> }).createMany({
        data: rows.slice(i, i + BATCH),
        skipDuplicates: true,
      })
    }
    total += rows.length
    lastId = rows[rows.length - 1].id
    if (rows.length < BATCH) break
  }
  return total
}

/** 大表（transaction_detail 无 orderBy 兼容的 id 游标：用 id 排序游标） */
async function copyTransactionDetail(): Promise<number> {
  let total = 0
  let lastId: string | null = null
  for (;;) {
    const rows = await master.transactionDetail.findMany({
      where: lastId ? { id: { gt: lastId } } : undefined,
      orderBy: { id: 'asc' },
      take: BATCH,
    })
    if (rows.length === 0) break
    for (let i = 0; i < rows.length; i += BATCH) {
      await target.transactionDetail.createMany({ data: rows.slice(i, i + BATCH), skipDuplicates: true })
    }
    total += rows.length
    lastId = rows[rows.length - 1].id
    if (rows.length < BATCH) break
  }
  return total
}

async function copyTransactionBatches(): Promise<number> {
  const rows = await master.importBatch.findMany({ where: { dataType: 'transaction' } })
  for (let i = 0; i < rows.length; i += BATCH) {
    await target.importBatch.createMany({ data: rows.slice(i, i + BATCH), skipDuplicates: true })
  }
  return rows.length
}

async function main(): Promise<void> {
  console.log('[txn-migrate] 开始往来数据迁移（5432 → 5434）...')
  // 1) 公司主数据覆盖（先删汇总映射再删公司，避免残留引用）
  const mapBefore = await target.companyAggregationMap.count()
  if (mapBefore > 0) await target.companyAggregationMap.deleteMany({})
  const companyBefore = await target.company.count()
  if (companyBefore > 0) await target.company.deleteMany({})
  const companies = await copyTable('company')
  const maps = await copyTable('companyAggregationMap')
  console.log(`[txn-migrate] company 覆盖 ${companies} 条（原 ${companyBefore} 删除）/ aggregation_map ${maps} 条`)

  // 2) transaction 批次
  const batches = await copyTransactionBatches()
  console.log(`[txn-migrate] import_batch(transaction) ${batches} 条`)

  // 3) 往来主数据与明细
  const counterparties = await copyTable('counterparty')
  console.log(`[txn-migrate] counterparty ${counterparties} 条`)
  const details = await copyTransactionDetail()
  console.log(`[txn-migrate] transaction_detail ${details} 条`)
  const exts = await copyTable('customerExt')
  const salesmen = await copyTable('salesman')
  const sc = await copyTable('salesmanCompany')
  const plans = await copyTable('collectionPlan')
  const agings = await copyTable('agingRecord')
  console.log(`[txn-migrate] customer_ext ${exts} / salesman ${salesmen} / salesman_company ${sc} / collection_plan ${plans} / aging_record ${agings} 条`)

  console.log('[txn-migrate] 迁移完成')
}

main()
  .catch((e) => {
    console.error('[txn-migrate] 失败：', e)
    process.exitCode = 1
  })
  .finally(async () => {
    await master.$disconnect()
    await target.$disconnect()
  })
