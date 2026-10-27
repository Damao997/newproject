/* eslint-disable no-console */
import { basePrisma } from '../src/lib/prisma'
import { syncAllDimensionMembers } from '../src/services/analysis/dimension-members'

/**
 * 一次性回填（L2/T31）：为存量库把品类/产品/费用配置镜像进 dimension / dimension_member。
 * 之后由三处配置 CRUD 的同事务同步自动维护（见 services/analysis/dimension-members.ts）。
 * 幂等可重跑：按当前活跃配置全集 reconcile（差集删 + 全集 upsert）。
 *
 * 用法：node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/backfill-dimension-members.ts
 * 注意：与 seed 的生产防护同理，生产库执行前先备份（backup-zjyph.ps1）。
 */
async function main() {
  const counts = await syncAllDimensionMembers()
  console.log(`[backfill] 维度成员已同步：品类 ${counts.category} / 产品 ${counts.product} / 费用 ${counts.expense}`)
  const members = await basePrisma.dimensionMember.count()
  console.log(`[backfill] dimension_member 表现存 ${members} 条`)
}

main()
  .catch((e) => {
    console.error('[backfill] 失败：', e)
    process.exitCode = 1
  })
  .finally(() => basePrisma.$disconnect())
