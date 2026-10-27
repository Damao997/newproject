/**
 * simulate-demo-data.ts — 生成一套演示数据（本地 DEV 用）
 *
 * 目标：让经营分析各子页与即席分析在**零人工导入**的情况下有数可看。
 * 生成内容（幂等：固定批次 ID，可重复执行，自动更新而非重复插入）：
 *   1. 两个 active 导入批次：operating / budget（事实行必须挂 active 批次才会被聚合层读取）
 *   2. FY2026 预算月度占比配置（budget_ratio_config，12 项和 100）
 *   3. fact_operating：3 家单体 × 63 个经营 data 类叶子科目 × 12 期 ACTUAL_MONTH
 *      （YTD / 同期 / 同期累计口径由聚合层按期间区间自动求和，无需手写）
 *   4. fact_budget：3 家单体 × 61 个收支费科目 FY2026 年度预算
 *   5. subject_budget_config：3 家公司行（科目预算分析页的主体清单）
 *
 * 值模型：固定种子的确定性伪随机（同参数可复现），收入基础值按科目索引分布，
 * 成本 ≈ 收入 × 0.72、费用 ≈ 收入 × 0.11、回款 ≈ 收入 × 0.96；
 * 月度带季节因子，同比增速 12%（去年同期 = 今年同月 / 1.12）。
 *
 * 用法（仓库根目录）：
 *   npx tsx server/scripts/simulate-demo-data.ts            # 写入
 *   npx tsx server/scripts/simulate-demo-data.ts --dry-run  # 只打印计划不写库
 */
import { prisma, basePrisma } from '../src/lib/prisma'

// ── 演示范围 ──────────────────────────────────────────────
const COMPANIES = ['EN330058', 'EN330049', 'EN100068'] // 浙江壹品慧 / 金华壹品慧 / 上海壹品慧
const FY = 'FY2026'
const FY_START = '2026-04' // 财年起始月（4 月~次年 3 月）
const CURRENT_PERIODS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']
const PREV_PERIODS = ['2025-04', '2025-05', '2025-06', '2025-07', '2025-08', '2025-09']

/** 固定批次 ID（幂等键）：重跑脚本走 update，不产生重复行 */
const OP_BATCH_ID = '00000000-0000-4000-8000-00000000d001'
const BUDGET_BATCH_ID = '00000000-0000-4000-8000-00000000d002'

/** FY2026 月度预算占比（4 月起 12 项，和 = 100） */
const RATIOS = [8, 7, 8, 8, 9, 8, 8, 9, 9, 8, 9, 7]

// ── 确定性伪随机（mulberry32，同种子同序列） ─────────────────
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MONTH_SEASON: Record<string, number> = {
  '2026-04': 0.96, '2026-05': 1.02, '2026-06': 1.08, '2026-07': 1.05, '2026-08': 0.98, '2026-09': 1.01,
  '2025-04': 0.94, '2025-05': 1.00, '2025-06': 1.06, '2025-07': 1.03, '2025-08': 0.96, '2025-09': 1.00,
}

const round2 = (n: number) => Math.round(n * 100) / 100

async function main() {
  const dryRun = process.argv.includes('--dry-run')

  // ── 1. 批次 ──
  const opBatch = {
    id: OP_BATCH_ID,
    fileName: '模拟-经营数据-FY2026（脚本生成）',
    dataType: 'operating' as const,
    status: 'success' as const,
    lifecycleStatus: 'active' as const,
    fiscalYear: FY,
    rowCount: 0,
    detailCount: 0,
    errorCount: 0,
    sourceType: 'simulate-script',
  }
  const budgetBatch = { ...opBatch, id: BUDGET_BATCH_ID, fileName: '模拟-预算-FY2026（脚本生成）', dataType: 'budget' as const }

  // ── 2. 预算占比 ──
  const ratioRow = { id: '00000000-0000-4000-8000-00000000d003', fiscalYear: FY, ratios: RATIOS }

  // ── 3. 科目清单：经营四类 data 类叶子 ──
  const subjects = await prisma.accountSubject.findMany({
    where: {
      subjectType: 'operating',
      isLeaf: true,
      category: { in: ['壹品慧收入', '壹品慧成本', '壹品慧费用', '壹品慧回款'] },
      status: 'active',
    },
    select: { code: true, name: true, category: true },
    orderBy: { orderNo: 'asc' },
  })
  // metric 表再次确认 data 类（calc/display 由公式派生，不写事实）
  const metrics = await prisma.metric.findMany({ select: { code: true, dataType: true } })
  const dataTypeOf = new Map(metrics.map((m) => [m.code, m.dataType]))
  const factSubjects = subjects.filter((s) => (dataTypeOf.get(s.code) ?? 'data') === 'data')
  const budgetSubjects = factSubjects.filter((s) => s.category !== '壹品慧回款')

  // ── 4. 事实行生成 ──
  const opRows: { batchId: string; companyCode: string; accountCode: string; period: string; periodDimCode: string; fiscalYear: string; value: number }[] = []
  const budgetRows: { batchId: string; companyCode: string; accountCode: string; fiscalYear: string; period: string; value: number }[] = []

  for (const company of COMPANIES) {
    const cr = rng(company.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0))
    const companyScale = 0.6 + cr() * 0.9 // 公司规模系数 0.6~1.5
    for (let i = 0; i < factSubjects.length; i++) {
      const s = factSubjects[i]
      const sr = rng(company.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0) + i * 7919)
      const baseByCategory: Record<string, number> = {
        '壹品慧收入': 60 + Math.floor(sr() * 340),
        '壹品慧成本': 40 + Math.floor(sr() * 240),
        '壹品慧费用': 5 + Math.floor(sr() * 40),
        '壹品慧回款': 50 + Math.floor(sr() * 320),
      }
      const base = (baseByCategory[s.category] ?? 50) * companyScale
      for (const period of [...CURRENT_PERIODS, ...PREV_PERIODS]) {
        const noise = 0.9 + sr() * 0.2
        const season = MONTH_SEASON[period] ?? 1
        const yoyFactor = period.startsWith('2025') ? 1 / 1.12 : 1
        const fy = period >= FY_START ? FY : 'FY2025'
        opRows.push({
          batchId: OP_BATCH_ID,
          companyCode: company,
          accountCode: s.code,
          period,
          periodDimCode: 'ACTUAL_MONTH',
          fiscalYear: fy,
          value: round2(base * noise * season * yoyFactor),
        })
      }
    }
    // 年度预算：收入按今年 12 个月合计口径估，成本/费用同比推导
    for (const s of budgetSubjects) {
      const yr = rng(company.split('').reduce((a, ch) => a + ch.charCodeAt(0), 0) + s.code.length * 104729)
      const baseByCategory: Record<string, number> = {
        '壹品慧收入': 800 + Math.floor(yr() * 4200),
        '壹品慧成本': 560 + Math.floor(yr() * 3000),
        '壹品慧费用': 70 + Math.floor(yr() * 480),
      }
      budgetRows.push({
        batchId: BUDGET_BATCH_ID,
        companyCode: company,
        accountCode: s.code,
        fiscalYear: FY,
        period: FY,
        value: round2((baseByCategory[s.category] ?? 500) * companyScale),
      })
    }
  }

  // ── 5. subject_budget_config（科目预算分析页主体清单，upsert 三行） ──
  const subjectBudgetRows = COMPANIES.map((code, i) => ({ id: `00000000-0000-4000-8000-00000000d01${i + 1}`, companyCode: code, sortOrder: i + 1, status: 'active' as const }))

  opBatch.rowCount = opRows.length
  budgetBatch.rowCount = budgetRows.length

  // ── 汇总 ──
  const summary = {
    公司: COMPANIES,
    经营科目: factSubjects.length,
    预算科目: budgetSubjects.length,
    '经营事实行': opRows.length,
    '预算事实行': budgetRows.length,
    期间: [...CURRENT_PERIODS, ...PREV_PERIODS].join(', '),
    月度占比: RATIOS.join(','),
  }
  console.log('模拟计划：', JSON.stringify(summary, null, 2))
  if (dryRun) {
    console.log('--dry-run：未写库')
    await basePrisma.$disconnect()
    return
  }

  // ── 6. 写库（幂等 upsert） ──
  for (const b of [opBatch, budgetBatch]) {
    await prisma.importBatch.upsert({ where: { id: b.id }, create: b, update: { ...b, uploadedAt: new Date() } })
  }
  await prisma.budgetRatioConfig.upsert({ where: { fiscalYear: FY }, create: ratioRow, update: { ratios: RATIOS } })
  for (const r of subjectBudgetRows) {
    await prisma.subjectBudgetConfig.upsert({ where: { companyCode: r.companyCode }, create: r, update: { sortOrder: r.sortOrder, status: r.status } })
  }
  // 事实行逐条 upsert（唯一键含 batchId，键固定 → 天然幂等）；批量 500 一批
  for (let i = 0; i < opRows.length; i += 500) {
    for (const row of opRows.slice(i, i + 500)) {
      await prisma.factOperating.upsert({
        where: { companyCode_accountCode_period_periodDimCode_batchId: { companyCode: row.companyCode, accountCode: row.accountCode, period: row.period, periodDimCode: row.periodDimCode, batchId: row.batchId } },
        create: row,
        update: { value: row.value, fiscalYear: row.fiscalYear },
      })
    }
    console.log(`  fact_operating ${Math.min(i + 500, opRows.length)}/${opRows.length}`)
  }
  for (const row of budgetRows) {
    await prisma.factBudget.upsert({
      where: { companyCode_accountCode_fiscalYear_period_batchId: { companyCode: row.companyCode, accountCode: row.accountCode, fiscalYear: row.fiscalYear, period: row.period, batchId: row.batchId } },
      create: row,
      update: { value: row.value },
    })
  }
  console.log(`  fact_budget ${budgetRows.length}/${budgetRows.length}`)

  // ── 7. 自检 ──
  const [opN, budN, ytdSample, budgetSample] = await Promise.all([
    prisma.factOperating.count({ where: { batchId: OP_BATCH_ID } }),
    prisma.factBudget.count({ where: { batchId: BUDGET_BATCH_ID } }),
    prisma.factOperating.groupBy({ by: ['accountCode'], where: { companyCode: COMPANIES[0], batchId: OP_BATCH_ID, periodDimCode: 'ACTUAL_MONTH', period: { gte: FY_START, lte: '2026-09' } }, _sum: { value: true }, orderBy: { _sum: { value: 'desc' } }, take: 5 }),
    prisma.factBudget.groupBy({ by: ['companyCode'], where: { batchId: BUDGET_BATCH_ID }, _sum: { value: true } }),
  ])
  console.log('自检 fact_operating:', opN, '| fact_budget:', budN)
  console.log('浙江 YTD Top5 科目:', JSON.stringify(ytdSample.map((r) => ({ code: r.accountCode, ytd: Number(r._sum.value ?? 0) }))))
  console.log('各单位年度预算合计:', JSON.stringify(budgetSample.map((r) => ({ company: r.companyCode, total: Number(r._sum.value ?? 0) }))))

  await basePrisma.$disconnect()
}

main().catch((err) => {
  console.error('模拟失败:', err)
  process.exit(1)
})
