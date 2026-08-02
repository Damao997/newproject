import { PrismaClient } from '@prisma/client'
import { decorateTree, rawOperatingAnalysis, rawStaticAnalysis, type DecoratedSubject } from './seed-data/subject-trees'
import { transactionAccounts } from './seed-data/transaction-accounts'
import { OPERATING_DIMS, STATIC_DIMS } from '../src/lib/metric-values'

/**
 * 领域种子：期间维度 + 科目体系 + 指标。
 * 事实数据不再 mock，改由 3 个数据范例 Excel 经导入接口提供真实数据。
 * 幂等：科目/指标/维度按 code upsert。
 */

const PERIOD_DIMENSIONS = [
  { code: OPERATING_DIMS.BUDGET_AMOUNT, name: '预算金额', applicableType: 'operating' as const, orderNo: 1 },
  { code: OPERATING_DIMS.ACTUAL_MONTH, name: '本月实际', applicableType: 'operating' as const, orderNo: 2 },
  { code: OPERATING_DIMS.SAME_PERIOD_ACTUAL, name: '同期实际', applicableType: 'operating' as const, orderNo: 3 },
  { code: OPERATING_DIMS.YTD_ACTUAL, name: '本年累计', applicableType: 'operating' as const, orderNo: 4 },
  { code: OPERATING_DIMS.SAME_PERIOD_YTD, name: '同期累计', applicableType: 'operating' as const, orderNo: 5 },
  { code: STATIC_DIMS.CURRENT_AMOUNT, name: '本期金额', applicableType: 'static' as const, orderNo: 6 },
  { code: STATIC_DIMS.YEAR_START, name: '年初金额', applicableType: 'static' as const, orderNo: 7 },
  { code: STATIC_DIMS.SAME_PERIOD_AMOUNT, name: '同期金额', applicableType: 'static' as const, orderNo: 8 },
  { code: STATIC_DIMS.LAST_YEAR_START, name: '上年年初金额', applicableType: 'static' as const, orderNo: 9 },
]

/**
 * 品类预算达成分析：10 个业务品类配置（品类 ↔ 收入类别科目名关键词）。
 * 匹配限定 category=收入；毛利按镜像名（"XX收入"→"XX毛利"）自动配对。
 */
const PRODUCT_CATEGORIES = [
  { code: 'kitchen', name: '厨房产品销售（不含净水及服务）', subjectKeyword: '厨房产品销售', sortOrder: 1 },
  { code: 'security', name: '安防产品销售与服务', subjectKeyword: '安防产品销售与服务', sortOrder: 2 },
  { code: 'premium', name: '优选产品', subjectKeyword: '优选产品', sortOrder: 3 },
  { code: 'appliance', name: '家用电器（含净水）', subjectKeyword: '家用电器', sortOrder: 4 },
  { code: 'livable', name: '宜居产品', subjectKeyword: '宜居产品', sortOrder: 5 },
  { code: 'promotion', name: '宣传推广', subjectKeyword: '宣传推广', sortOrder: 6 },
  { code: 'renovation', name: '维修改造业务', subjectKeyword: '维修改造业务', sortOrder: 7 },
  { code: 'newProducts', name: '新产品及其它', subjectKeyword: '新产品及其它', sortOrder: 8 },
  { code: 'inspection', name: '安检业务', subjectKeyword: '安检业务', sortOrder: 9 },
  { code: 'directWater', name: '直饮水业务', subjectKeyword: '直饮水业务', sortOrder: 10 },
]

function metricDataTypeOf(s: DecoratedSubject): 'data' | 'calc' | 'display' {
  return s.dataType
}

// 计算类科目显式公式（无法由“毛利/毛利率”镜像配对自动覆盖的部分）：
// 费用率/净利率（内树）、跨树比率（资产负债率/ROE/ROA，ROE/ROA 引用经营“壹品慧净利润”）、
// 跨期间周转天数（平均余额 × 财年累计天数 ÷ 经营累计，用 {编码@维度} 与 {DAYS_YTD} 语法）。
// template 接收裸编码数组，自行拼接 {编码} / {编码@维度}。
const CALC_METRIC_FORMULA_DEFS: { name: string; refs: string[]; template: (c: string[]) => string }[] = [
  { name: '壹品慧费用率', refs: ['费用', '收入'], template: (c) => `{${c[0]}} / {${c[1]}}` },
  { name: '壹品慧净利润率', refs: ['壹品慧净利润', '收入'], template: (c) => `{${c[0]}} / {${c[1]}}` },
  { name: '资产负债率(%)', refs: ['总负债', '总资产'], template: (c) => `{${c[0]}} / {${c[1]}}` },
  { name: '净资产回报率（ROE,%）', refs: ['壹品慧净利润', '权益净资产'], template: (c) => `{${c[0]}} / {${c[1]}}` },
  { name: '总资产报酬率（ROA,%）', refs: ['壹品慧净利润', '总资产'], template: (c) => `{${c[0]}} / {${c[1]}}` },
  // 周转天数 = (年初余额 + 期末余额) / 2 × 财年累计天数 ÷ 经营累计（成本/收入）
  { name: '存货周转天数', refs: ['存货', '成本'], template: (c) => `({${c[0]}@YEAR_START} + {${c[0]}}) / 2 * {DAYS_YTD} / {${c[1]}@YTD_ACTUAL}` },
  { name: '应收账款周转天数', refs: ['应收账款', '收入'], template: (c) => `({${c[0]}@YEAR_START} + {${c[0]}}) / 2 * {DAYS_YTD} / {${c[1]}@YTD_ACTUAL}` },
]

/**
 * 为计算类指标回填展示公式（幂等：按 code 更新 formula/dependsOn）。
 * 自动镜像配对：毛利类目（category=毛利）= 同名收入 - 同名成本；名称含“毛利率” = 同名毛利 / 同名收入。
 * 叠加显式比率定义。名称跨全树唯一解析，仅当自身为计算类且所有引用科目均可解析时才写入。
 */
async function seedCalcMetricFormulas(prisma: PrismaClient): Promise<void> {
  const subjects = await prisma.accountSubject.findMany({ select: { code: true, name: true, category: true } })
  const nameToCode = new Map(subjects.map((s) => [s.name, s.code]))
  const calcMetrics = await prisma.metric.findMany({ where: { dataType: 'calc' }, select: { code: true } })
  const calcCodes = new Set(calcMetrics.map((m) => m.code))

  // selfCode -> { formula, deps }
  const plans = new Map<string, { formula: string; deps: string[] }>()
  const tryPair = (selfName: string, refNames: string[], tmpl: (c: string[]) => string): void => {
    const selfCode = nameToCode.get(selfName)
    if (!selfCode || !calcCodes.has(selfCode)) return // 仅为计算类目写公式
    const refCodes = refNames.map((n) => nameToCode.get(n))
    if (refCodes.some((c) => !c)) return // 引用科目缺失则跳过
    const refs = refCodes as string[]
    plans.set(selfCode, { formula: tmpl(refs), deps: refs })
  }

  // 自动镜像配对：毛利子树与毛利率子树（先判“毛利率”再判“毛利”，避免子串误匹配）
  for (const s of subjects) {
    if (!calcCodes.has(s.code)) continue
    if (s.name.includes('毛利率')) {
      tryPair(s.name, [s.name.replace('毛利率', '毛利'), s.name.replace('毛利率', '收入')], (c) => `{${c[0]}} / {${c[1]}}`)
    } else if (s.category === '毛利') {
      tryPair(s.name, [s.name.replace('毛利', '收入'), s.name.replace('毛利', '成本')], (c) => `{${c[0]}} - {${c[1]}}`)
    }
  }

  // 叠加显式比率定义（覆盖同 code）
  for (const def of CALC_METRIC_FORMULA_DEFS) tryPair(def.name, def.refs, def.template)

  let count = 0
  for (const [selfCode, plan] of plans) {
    await prisma.metric.update({ where: { code: selfCode }, data: { formula: plan.formula, dependsOn: plan.deps as never } })
    count++
  }
  console.log(`[seed] 计算类指标公式 ${count} 条 完成`)
}

export async function seedDomain(prisma: PrismaClient): Promise<void> {
  // 1) 期间维度
  for (const pd of PERIOD_DIMENSIONS) {
    await prisma.periodDimension.upsert({
      where: { code: pd.code },
      update: { name: pd.name, applicableType: pd.applicableType, orderNo: pd.orderNo },
      create: pd,
    })
  }
  console.log(`[seed] 期间维度 ${PERIOD_DIMENSIONS.length} 条 完成`)

  // 2) 品类配置（品类预算达成分析，按 code 幂等）
  for (const pc of PRODUCT_CATEGORIES) {
    await prisma.productCategory.upsert({
      where: { code: pc.code },
      update: { name: pc.name, subjectKeyword: pc.subjectKeyword, sortOrder: pc.sortOrder, status: 'active' },
      create: pc,
    })
  }
  console.log(`[seed] 品类配置 ${PRODUCT_CATEGORIES.length} 条 完成`)

  // 3) 主体展示配置（主体预算达成分析，按 companyCode 幂等：全量 active 主体默认展示）
  const activeSubjects = await prisma.company.findMany({
    where: { status: 'active', entityType: { in: ['single', 'summary'] } },
    select: { code: true, orderNo: true },
    orderBy: { orderNo: 'asc' },
  })
  for (const s of activeSubjects) {
    await prisma.subjectBudgetConfig.upsert({
      where: { companyCode: s.code },
      update: { sortOrder: s.orderNo, status: 'active' },
      create: { companyCode: s.code, sortOrder: s.orderNo, status: 'active' },
    })
  }
  console.log(`[seed] 主体展示配置 ${activeSubjects.length} 条 完成`)

  // 4) 科目体系
  const operating = decorateTree(rawOperatingAnalysis, 'OP')
  const staticSubs = decorateTree(rawStaticAnalysis, 'ST')
  const allSubjects = [...operating, ...staticSubs]
  for (const s of allSubjects) {
    await prisma.accountSubject.upsert({
      where: { code: s.code },
      update: {
        name: s.name, subjectType: s.subjectType, level: s.level, parentCode: s.parentCode,
        category: s.category, direction: s.direction, valueType: s.valueType, isLeaf: s.isLeaf, orderNo: s.orderNo,
      },
      create: {
        code: s.code, name: s.name, subjectType: s.subjectType, level: s.level, parentCode: s.parentCode,
        category: s.category, direction: s.direction, valueType: s.valueType, isLeaf: s.isLeaf, orderNo: s.orderNo,
      },
    })
  }
  console.log(`[seed] 科目体系 ${allSubjects.length} 条（经营 ${operating.length} + 静态 ${staticSubs.length}）完成`)

  // 5) 指标（每个科目一条）
  for (const s of allSubjects) {
    const dataType = metricDataTypeOf(s)
    await prisma.metric.upsert({
      where: { code: s.code },
      update: { name: s.name, category: s.category, dataType },
      create: { code: s.code, name: s.name, category: s.category, dataType },
    })
  }
  console.log(`[seed] 指标 ${allSubjects.length} 条 完成`)

  // 6) 计算类指标展示公式（供聚合层计算层执行，如 毛利 = 收入 - 成本）
  await seedCalcMetricFormulas(prisma)

  // 7) 往来会计科目主数据（集团 ERP 科目表中六大往来相关科目，供往来分析科目筛选器）
  for (let i = 0; i < transactionAccounts.length; i++) {
    const a = transactionAccounts[i]
    await prisma.transactionAccount.upsert({
      where: { code: a.code },
      update: { name: a.name, transactionType: a.transactionType, direction: a.direction, note: a.note, orderNo: i },
      create: { code: a.code, name: a.name, transactionType: a.transactionType, direction: a.direction, note: a.note, orderNo: i },
    })
  }
  console.log(`[seed] 往来会计科目 ${transactionAccounts.length} 条 完成`)

  // 注：事实数据不再 mock，由 3 个数据范例 Excel 经导入接口提供真实数据。
}
