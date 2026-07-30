/* eslint-disable no-console */
import { basePrisma } from '../src/lib/prisma'
import { derivePartyType } from '../src/lib/party'

/**
 * 一次性回填：为存量 transaction_detail 与 counterparty 计算 partyType。
 * 分类口径见 src/lib/party.ts（internal/related/external）。幂等可重跑。
 *
 * 用法：node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/backfill-party-type.ts
 */
async function main() {
  // 1) transaction_detail：逐批读取（isInternal, counterpartyCode）→ 计算 partyType 回写
  const PAGE = 5000
  let cursor: string | undefined
  let detailUpdated = 0
  for (;;) {
    const rows = await basePrisma.transactionDetail.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: 'asc' },
      take: PAGE,
      select: { id: true, isInternal: true, counterpartyCode: true },
    })
    if (rows.length === 0) break
    cursor = rows[rows.length - 1].id
    // 按计算结果分桶，减少 update 次数
    const buckets = new Map<string, string[]>()
    for (const r of rows) {
      const pt = derivePartyType(r.isInternal, r.counterpartyCode)
      if (!buckets.has(pt)) buckets.set(pt, [])
      buckets.get(pt)!.push(r.id)
    }
    for (const [pt, ids] of buckets) {
      const res = await basePrisma.transactionDetail.updateMany({ where: { id: { in: ids } }, data: { partyType: pt } })
      detailUpdated += res.count
    }
    console.log(`transaction_detail 已处理至 ${cursor}（累计 ${detailUpdated}）`)
  }

  // 2) counterparty：同样回填
  const cps = await basePrisma.counterparty.findMany({ select: { id: true, isInternal: true, code: true } })
  const cpBuckets = new Map<string, string[]>()
  for (const c of cps) {
    const pt = derivePartyType(c.isInternal, c.code)
    if (!cpBuckets.has(pt)) cpBuckets.set(pt, [])
    cpBuckets.get(pt)!.push(c.id)
  }
  let cpUpdated = 0
  for (const [pt, ids] of cpBuckets) {
    const res = await basePrisma.counterparty.updateMany({ where: { id: { in: ids } }, data: { partyType: pt } })
    cpUpdated += res.count
  }

  console.log(`完成：transaction_detail ${detailUpdated} 条，counterparty ${cpUpdated} 条`)
  const stats = await basePrisma.transactionDetail.groupBy({ by: ['partyType'], _count: { id: true } })
  console.log('transaction_detail 分布：', JSON.stringify(stats))
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => basePrisma.$disconnect())
