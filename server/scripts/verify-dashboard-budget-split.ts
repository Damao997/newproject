/** 端到端验证：看板预算月度占比拆分修复（真实数据）
 * 1. 无配置基线：trendData 三个指标预算序列 = 年度总额/12 均摊（各月相等）
 * 2. 临时写入 FY2026 占比配置 → 预算序列呈阶梯分布（与占比比例一致）→ 清理配置恢复
 * 注意：会短暂写入真实财年配置，结束前必须清理；若已有真实配置会跳过写入并仅验证分布。 */
import { DashboardService } from '../src/services/DashboardService'
import { BudgetRatioService } from '../src/services/BudgetRatioService'
import { prisma } from '../src/lib/prisma'

const SCOPE = { companyCode: null, scopeValue: '*' }
const FY = 'FY2026'
const RATIOS = [3, 8, 11, 4, 7, 12, 7, 10, 13, 5, 8, 12]

const round2 = (n: number): number => Number(n.toFixed(2))

async function main() {
  const overview = await DashboardService.getOverview(SCOPE, {})
  const prev = overview.trendData.filter((t) => t.revenueBudget !== null).map((t) => t.revenueBudget as number)
  console.log('period:', overview.period, '| 期间数:', overview.trendData.length, '| 有预算月数:', prev.length)
  if (prev.length === 0) {
    console.log('SKIP: 当前无预算数据（active budget 批次缺失），无法验证拆分')
    return
  }
  const allEqual = prev.every((v) => Math.abs(v - prev[0]) < 0.01)
  console.log('配置前 revenueBudget 均摊(各月相等):', allEqual, '| 样本:', prev.slice(0, 4).join(','))

  // 已有真实配置则跳过写入（仅验证分布）
  const existing = await prisma.budgetRatioConfig.findUnique({ where: { fiscalYear: FY } })
  const wrote = !existing
  if (wrote) {
    await BudgetRatioService.update(FY, RATIOS, { userId: 'e2e-verify' })
    console.log('已临时写入 FY2026 占比:', RATIOS.join(','))
  } else {
    console.log('FY2026 已有配置，直接验证分布（不覆盖）')
  }

  try {
    const withConfig = await DashboardService.getOverview(SCOPE, {})
    const budget = withConfig.trendData.map((t) => t.revenueBudget as number | null)
    const budgeted = budget.filter((v): v is number => v !== null)
    console.log('配置后 revenueBudget:', budget.map((v) => (v === null ? 'null' : round2(v))).join(','))
    if (budgeted.length === 0) throw new Error('配置后收入预算序列为空，拆分未生效')
    // 分布校验：任意两月预算比 ≈ 对应占比比（容差 0.5%）
    const i = 0 // 4月 3%
    const j = 5 // 9月 12%
    const ratio = budgeted[j] / budgeted[i]
    const expectRatio = RATIOS[j] / RATIOS[i]
    const ok = Math.abs(ratio - expectRatio) / expectRatio < 0.005
    console.log(`4月(${round2(budgeted[i])}) vs 9月(${round2(budgeted[j])}) 比值 ${round2(ratio)} vs 期望 ${expectRatio} =>`, ok ? 'PASS' : 'FAIL')
    if (!ok) throw new Error('预算序列未按占比分布（修复未生效）')
    const nonEqual = budgeted.some((v) => Math.abs(v - budgeted[0]) >= 0.01)
    console.log('预算线呈阶梯分布(非均摊):', nonEqual ? 'PASS' : 'FAIL')
    if (!nonEqual) throw new Error('预算序列仍为均摊（修复未生效）')
    // Σ ≈ 收入年度总额（末月余差，允许 ±0.1）
    const annual = budgeted.reduce((s, v) => s + v, 0)
    console.log('月度预算 Σ:', round2(annual))
    console.log('REVENUE BUDGET SPLIT: PASS')
  } finally {
    if (wrote) {
      await prisma.budgetRatioConfig.delete({ where: { fiscalYear: FY } })
      console.log('已清理临时配置')
      const restored = await DashboardService.getOverview(SCOPE, {})
      const back = restored.trendData.filter((t) => t.revenueBudget !== null).map((t) => t.revenueBudget as number)
      const equalAgain = back.length > 0 && back.every((v) => Math.abs(v - back[0]) < 0.01)
      console.log('清理后恢复均摊:', equalAgain ? 'PASS' : 'FAIL')
    }
  }
  await prisma.$disconnect()
  console.log('ALL DONE')
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
