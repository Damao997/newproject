/** 端到端验证：三个预算表格接口的月度预算按占比拆分（真实数据 + FY2026 已配置占比）
 * 校验 getProductBudget / getSubjectBudget / getExpenseAnalysis 返回的 monthBudget：
 * 与年度预算的比例应等于当前期间（财年 4月起）对应的月度占比，且与 /12 均摊明显区分。 */
import { DashboardService } from '../src/services/DashboardService'

const SCOPE = { companyCode: null, scopeValue: '*' }
// 预设占比（FY2026 已有配置，与 budget_ratio_config 一致）
const RATIOS = [3, 8, 11, 4, 7, 12, 7, 10, 13, 5, 8, 12]

const round2 = (n: number): number => Number(n.toFixed(2))

function checkGroup(label: string, budget: number, monthBudget: number | null): void {
  if (monthBudget === null || budget === 0) {
    console.log(`${label}: 无预算（budget=${budget}, monthBudget=${monthBudget}）— 跳过`)
    return
  }
  const actual = monthBudget / budget
  const expected = RATIOS[3] / 100 // 2026-07 = 财年第 4 个月 → 7月 4%
  const ok = Math.abs(actual - expected) / expected < 0.005
  const flat = Math.abs(monthBudget - budget / 12) / (budget / 12) < 0.005
  console.log(
    `${label}: 月预算=${round2(monthBudget)} 年预算=${round2(budget)} 占比=${(actual * 100).toFixed(2)}% ` +
    `期望 4% => ${ok ? 'PASS' : 'FAIL'}${flat ? '（注意：与 /12 均摊一致）' : ''}`,
  )
  if (!ok) throw new Error(`${label} 未按占比拆分`)
}

async function main() {
  const overview = await DashboardService.getOverview(SCOPE, {})
  console.log('period:', overview.period)
  if (overview.period !== '2026-07') console.log('注意：当前期间非 2026-07，占比期望值需人工核对')

  // 1. 品类预算达成（收入组）
  const pb = await DashboardService.getProductBudget(SCOPE, {})
  console.log(`\n[品类预算达成] ${pb.rows.length} 行`)
  for (const r of pb.rows.slice(0, 3)) checkGroup(`  品类「${r.category}」收入`, r.income.budget, r.income.monthBudget)

  // 2. 主体预算达成（收入组，首行）
  const sb = await DashboardService.getSubjectBudget(SCOPE, {})
  console.log(`\n[公司预算达成] ${sb.rows.length} 行`)
  for (const r of sb.rows.slice(0, 3)) checkGroup(`  主体「${r.name}」收入`, r.income.budget, r.income.monthBudget)

  // 3. 运营费用分析
  const ea = await DashboardService.getExpenseAnalysis(SCOPE, {})
  console.log(`\n[运营费用分析] ${ea.rows.length} 行`)
  for (const r of ea.rows.slice(0, 3)) checkGroup(`  指标「${r.name}」`, r.budget, r.monthBudget)

  console.log('\nALL PASS')
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
