/** 端到端验证：BudgetRatioService get/update/校验 + DashboardService 占比查询（FY2099 隔离财年，用完清理） */
import { BudgetRatioService } from '../src/services/BudgetRatioService'
import { prisma } from '../src/lib/prisma'

const FY = 'FY2099'

async function main() {
  // 1. get：无配置 → 默认占比 + 无预算
  const fresh = await BudgetRatioService.get(FY)
  console.log('fresh ratios:', fresh.ratios.join(','), 'annualTotal:', fresh.annualTotal)
  if (fresh.ratios.length !== 12 || fresh.ratios.reduce((s, r) => s + r, 0) !== 100) throw new Error('默认占比异常')
  if (fresh.annualTotal !== 0) throw new Error('FY2099 不应有预算')

  // 2. 非法占比拒绝（和≠100 / 长度不足 / 负数）
  const bad1 = await BudgetRatioService.update(FY, [...fresh.ratios.slice(0, 11), 13], { userId: 'e2e' }).then(() => 'PASS').catch((e) => `REJECT:${e.message}`)
  const bad2 = await BudgetRatioService.update(FY, [3, 8], { userId: 'e2e' }).then(() => 'PASS').catch((e) => `REJECT:${e.message}`)
  const bad3 = await BudgetRatioService.update(FY, [...fresh.ratios.slice(0, 11), -5], { userId: 'e2e' }).then(() => 'PASS').catch((e) => `REJECT:${e.message}`)
  console.log('bad sum=101:', bad1)
  console.log('bad length=2:', bad2)
  console.log('bad negative:', bad3)
  if (!bad1.startsWith('REJECT') || !bad2.startsWith('REJECT') || !bad3.startsWith('REJECT')) throw new Error('非法占比未被拒绝')

  // 3. 合法保存 + 重读
  const custom = [4, 8, 10, 4, 7, 12, 7, 10, 13, 5, 8, 12] // 和 = 100
  await BudgetRatioService.update(FY, custom, { userId: 'e2e' })
  const saved = await BudgetRatioService.get(FY)
  console.log('saved ratios:', saved.ratios.join(','))
  if (JSON.stringify(saved.ratios) !== JSON.stringify(custom)) throw new Error('占比未落库')

  // 4. DashboardService 占比查询链路
  const { DashboardService } = await import('../src/services/DashboardService')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ratiosOf = await (BudgetRatioService as any).budgetRatiosOf(FY)
  console.log('budgetRatiosOf:', ratiosOf.join(','))
  if (!ratiosOf || ratiosOf.length !== 12) throw new Error('budgetRatiosOf 查询异常')

  // 5. 清理（删除 FY2099 配置，不污染真实财年）
  await prisma.budgetRatioConfig.delete({ where: { fiscalYear: FY } })
  console.log('CLEANUP OK')
  await prisma.$disconnect()
  console.log('ALL PASS')
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
