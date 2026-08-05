/* eslint-disable no-console */
import { basePrisma } from '../src/lib/prisma'
import { DataService } from '../src/services/DataService'

/**
 * 一次性修复：毛利叶子科目被种子 upsert 静默回写为数据类（formula 残留但失效），
 * 恢复为计算类并重建镜像公式（毛利 = 同名收入 - 同名成本）。
 * 走 DataService.convertMetricType/updateMetric 通道（引用校验 + 审计 + 历史留痕），幂等可重跑。
 *
 * 背景：seed-domain.ts 曾以 update.dataType 覆盖运行期转换；修复后种子不再回写类型，
 * 本脚本仅需执行一次，此后 seed 不会再次破坏。
 *
 * 用法：node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/fix-profit-leaf-metrics.ts [--dry-run]
 */
const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  // 1) superadmin 作为审计操作者（convertMetricType/updateMetric 需 ctx.userId）
  const admin = await basePrisma.user.findFirst({
    where: { status: 'active', role: { code: 'superadmin' } },
    select: { id: true, username: true },
  })
  if (!admin) throw new Error('未找到 superadmin 用户，无法执行审计写入')

  // 2) 毛利叶子科目与同名收入/成本镜像科目（镜像配对口径与 seedCalcMetricFormulas 一致）
  const leaves = await basePrisma.accountSubject.findMany({
    where: { subjectType: 'operating', category: '毛利', isLeaf: true },
    select: { code: true, name: true },
  })
  const byName = new Map(
    (await basePrisma.accountSubject.findMany({
      where: { subjectType: 'operating' },
      select: { code: true, name: true },
    })).map((s) => [s.name, s.code]),
  )

  const ctx = { userId: admin.id, traceId: 'fix-profit-leaf-metrics' }
  let changed = 0
  let skipped = 0
  for (const leaf of leaves) {
    const incomeCode = byName.get(leaf.name.replace('毛利', '收入'))
    const costCode = byName.get(leaf.name.replace('毛利', '成本'))
    if (!incomeCode || !costCode) {
      throw new Error(`毛利叶子 ${leaf.name}（${leaf.code}）缺少同名收入/成本镜像科目，请人工确认口径后处理`)
    }
    const formula = `{${incomeCode}} - {${costCode}}`
    const metric = await basePrisma.metric.findUnique({ where: { code: leaf.code }, select: { id: true, dataType: true, formula: true } })
    if (!metric) {
      throw new Error(`毛利叶子 ${leaf.name}（${leaf.code}）无对应 metric，请先执行 seed 初始化科目体系`)
    }
    if (metric.dataType === 'calc' && metric.formula === formula) {
      skipped++
      console.log(`[skip] ${leaf.code} ${leaf.name} 已是计算类且公式正确`)
      continue
    }
    if (metric.dataType === 'display') {
      throw new Error(`毛利叶子 ${leaf.name}（${leaf.code}）为展示类，无法恢复为计算类，请人工处理`)
    }
    const via = metric.dataType === 'calc' ? 'updateMetric' : 'convertMetricType'
    console.log(`[${DRY_RUN ? 'dry-run' : 'fix'}] ${leaf.code} ${leaf.name}: ${metric.dataType}（${metric.formula ?? '无公式'}）→ calc（${formula}），经 ${via}`)
    if (!DRY_RUN) {
      if (metric.dataType === 'calc') {
        await DataService.updateMetric(metric.id, { formula }, ctx)
      } else {
        await DataService.convertMetricType(metric.id, { dataType: 'calc', formula }, ctx)
      }
      changed++
    }
  }
  console.log(DRY_RUN ? `dry-run 完成：待修复 ${leaves.length - skipped} 条，跳过 ${skipped} 条` : `修复完成：${changed} 条，跳过 ${skipped} 条`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => basePrisma.$disconnect())
