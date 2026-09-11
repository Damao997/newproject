import { PrismaClient } from '@prisma/client'
import { decorateTree, rawOperatingAnalysis, rawStaticAnalysis, rawCashflowAnalysis, type DecoratedSubject } from './seed-data/subject-trees'
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
  // 现金流维度（独立 cashflow 类型）：本月/本年累计/同期/同期累计（流入流出共用，方向由科目段区分）
  { code: 'CF_ACTUAL_MONTH', name: '本月金额', applicableType: 'cashflow' as const, orderNo: 10 },
  { code: 'CF_YTD_ACTUAL', name: '本年累计', applicableType: 'cashflow' as const, orderNo: 11 },
  { code: 'CF_SAME_PERIOD_ACTUAL', name: '同期金额', applicableType: 'cashflow' as const, orderNo: 12 },
  { code: 'CF_SAME_PERIOD_YTD', name: '同期累计', applicableType: 'cashflow' as const, orderNo: 13 },
  // 现金流预算维度（年度预算经「年度预算」模板导入，仅流入/流出层直填，净额类由公式推导）
  { code: 'CF_BUDGET_AMOUNT', name: '预算金额', applicableType: 'cashflow' as const, orderNo: 14 },
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
  // 服务类子项自 6 起编排（整体 +1，相对顺序不变），为关键指标产品配置的「服务类」合计行腾出 sortOrder=6
  { code: 'promotion', name: '宣传推广', subjectKeyword: '宣传推广', sortOrder: 7 },
  { code: 'renovation', name: '维修改造业务', subjectKeyword: '维修改造业务', sortOrder: 8 },
  { code: 'newProducts', name: '新产品及其它', subjectKeyword: '新产品及其它', sortOrder: 9 },
  { code: 'inspection', name: '安检业务', subjectKeyword: '安检业务', sortOrder: 10 },
  { code: 'directWater', name: '直饮水业务', subjectKeyword: '直饮水业务', sortOrder: 11 },
]

/**
 * 关键指标产品配置（壹品慧关键指标表「按产品分」明细，独立于品类配置）：
 * 初始数据复制品类配置的产品线（名称/关键词同源），后续在看板管理「产品配置」独立维护。
 * 另含「服务类」合计行：科目树无「服务类」汇总节点，用多关键词并集求和
 * （宣传推广+维修改造+安检+技术服务，逗号分隔；「技术服务」暂无对应科目，命中为空不报错），
 * 排序置于服务类子项（宣传推广 7 / 维修改造 8 / 安检 10）之前，配合「其中：」名称约定实现缩进层级。
 */
const KEY_METRICS_PRODUCTS = [
  ...PRODUCT_CATEGORIES.map((pc) => ({
    code: `km_${pc.code}`,
    name: pc.name,
    subjectKeyword: pc.subjectKeyword,
    sortOrder: pc.sortOrder,
  })),
  {
    code: 'km_services',
    name: '服务类',
    subjectKeyword: '宣传推广,维修改造,安检,技术服务',
    sortOrder: 6,
  },
]

/**
 * 运营费用分析默认映射：费用 > 壹品慧费用 > 运营费用 下 19 个叶子科目一对一
 * （付现运营费用 17 个 + 非付现折旧摊销 + 财务费用），展示名称=科目名。
 * 统一编码：映射编码为 EXP_ 数字序号（EXP_001 起，与 sortOrder 对应），科目编码仅在 subjectCodes 中；
 * 科目编码运行时按名称解析（级联数字编码随科目树生成，避免硬编码漂移）。
 * 管理员可在「看板管理 > 运营费用映射」中归并多个科目或停用。
 */
const EXPENSE_SUBJECT_NAMES = [
  '人力成本', '生产运营类费用', '行政办公类费用', '差旅费', '招待费', '会议费',
  '市场费用', '客服费用', '地方税费', '劳动保护', '商业保险', '信息服务费',
  '中介服务费', '技术服务费', '安全监察专项费用', '核算共享中心服务费', '仓储及配送费用',
  '其他费用', '研发费用', // 付现运营费用（PL050101）
  '折旧摊销', // 非付现运营费用（PL050102）
  '财务费用', // PL0502
] as const

function metricDataTypeOf(s: DecoratedSubject): 'data' | 'calc' | 'display' {
  return s.dataType
}

// 计算类科目显式公式（无法由“毛利/毛利率”镜像配对自动覆盖的部分）：
// 费用率/净利率（内树）、跨树比率（资产负债率/ROE/ROA，ROE/ROA 引用经营“壹品慧净利润”）、
// 跨期间周转天数（平均余额 × 财年累计天数 ÷ 经营累计，用 {编码@维度} 与 {DAYS_YTD} 语法）。
// template 接收裸编码数组，自行拼接 {编码} / {编码@维度}。
const CALC_METRIC_FORMULA_DEFS: { name: string; refs: string[]; template: (c: string[]) => string }[] = [
  { name: '壹品慧费用率', refs: ['壹品慧费用', '壹品慧收入'], template: (c) => `{${c[0]}} / {${c[1]}}` },
  { name: '壹品慧净利润率', refs: ['壹品慧净利润', '壹品慧收入'], template: (c) => `{${c[0]}} / {${c[1]}}` },
  { name: '资产负债率(%)', refs: ['总负债', '总资产'], template: (c) => `{${c[0]}} / {${c[1]}}` },
  { name: '净资产回报率（ROE,%）', refs: ['壹品慧净利润', '权益净资产'], template: (c) => `{${c[0]}} / {${c[1]}}` },
  { name: '总资产报酬率（ROA,%）', refs: ['壹品慧净利润', '总资产'], template: (c) => `{${c[0]}} / {${c[1]}}` },
  // 周转天数 = (年初余额 + 期末余额) / 2 × 财年累计天数 ÷ 经营累计（成本/收入）
  { name: '存货周转天数', refs: ['存货', '壹品慧成本'], template: (c) => `({${c[0]}@YEAR_START} + {${c[0]}}) / 2 * {DAYS_YTD} / {${c[1]}@YTD_ACTUAL}` },
  { name: '应收账款周转天数', refs: ['应收账款', '壹品慧收入'], template: (c) => `({${c[0]}@YEAR_START} + {${c[0]}}) / 2 * {DAYS_YTD} / {${c[1]}@YTD_ACTUAL}` },
  // 现金流量净额 = 流入 - 流出（现金流科目树，CF_ 维度）
  { name: '经营活动产生的现金流量', refs: ['经营活动产生的现金流入', '经营活动产生的现金流出'], template: (c) => `{${c[0]}} - {${c[1]}}` },
  { name: '投资活动产生的现金流量', refs: ['投资活动产生的现金流入', '投资活动产生的现金流出'], template: (c) => `{${c[0]}} - {${c[1]}}` },
  { name: '筹资活动产生的现金流量', refs: ['筹资活动产生的现金流入', '筹资活动产生的现金流出'], template: (c) => `{${c[0]}} - {${c[1]}}` },
  // 自由现金流 = 经营活动产生的现金流量 - 投资活动产生的现金流出（关键指标表现金流板块行）
  { name: '自由现金流', refs: ['经营活动产生的现金流量', '投资活动产生的现金流出'], template: (c) => `{${c[0]}} - {${c[1]}}` },
]

/**
 * 为计算类指标回填展示公式（幂等：按 code 更新 formula/dependsOn）。
 * 自动镜像配对：毛利类目（category=毛利）= 同名收入 - 同名成本；名称含“毛利率” = 同名毛利 / 同名收入。
 * 叠加显式比率定义。名称跨全树唯一解析，仅当自身为计算类且所有引用科目均可解析时才写入。
 */
async function seedCalcMetricFormulas(prisma: PrismaClient): Promise<void> {
  // 仅 active 科目参与公式配对（迁移停用的旧树科目不参与，避免同名覆盖新树编码）
  const subjects = await prisma.accountSubject.findMany({ where: { status: 'active' }, select: { code: true, name: true, category: true } })
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
    } else if (s.category === '壹品慧毛利') {
      tryPair(s.name, [s.name.replace('毛利', '收入'), s.name.replace('毛利', '成本')], (c) => `{${c[0]}} - {${c[1]}}`)
    }
  }

  // 叠加显式比率定义（覆盖同 code）
  for (const def of CALC_METRIC_FORMULA_DEFS) tryPair(def.name, def.refs, def.template)

  // 配对失败警告：毛利计算类科目未写入公式时，聚合层叶子计算值（含预算）将塌缩为 0，
  // 静默失败是毛利数据异常高危点，显式告警便于定位（通常是同名收入/成本科目缺失或改名）
  for (const s of subjects) {
    if (s.category !== '壹品慧毛利' || !calcCodes.has(s.code) || plans.has(s.code)) continue
    console.warn(`[seed] 警告：毛利计算类科目镜像配对失败，未写入公式：${s.code} ${s.name}（请检查同名收入/成本科目是否存在）`)
  }

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

  // 2) 品类配置（品类预算达成分析，按 code 幂等：仅创建缺失的品类，
  // 不覆盖管理员对既有配置的修改（名称/关键词/排序/状态）——seed 重复执行不得重置业务配置）
  const existingProductCodes = new Set(
    (await prisma.productCategory.findMany({ select: { code: true } })).map((c) => c.code),
  )
  const productToCreate = PRODUCT_CATEGORIES.filter((pc) => !existingProductCodes.has(pc.code))
  for (const pc of productToCreate) {
    await prisma.productCategory.create({ data: pc })
  }
  console.log(`[seed] 品类配置 新增 ${productToCreate.length} 条（既有 ${existingProductCodes.size} 条保留） 完成`)

  // 2-1) 关键指标产品配置（壹品慧关键指标表「按产品分」明细，按 code 幂等：仅创建缺失的产品，
  // 不覆盖管理员对既有配置的修改（名称/关键词/排序/状态）——seed 重复执行不得重置业务配置）
  const existingKmProductCodes = new Set(
    (await prisma.keyMetricsProduct.findMany({ select: { code: true } })).map((c) => c.code),
  )
  const kmProductToCreate = KEY_METRICS_PRODUCTS.filter((pc) => !existingKmProductCodes.has(pc.code))
  for (const pc of kmProductToCreate) {
    await prisma.keyMetricsProduct.create({ data: pc })
  }
  console.log(`[seed] 关键指标产品配置 新增 ${kmProductToCreate.length} 条（既有 ${existingKmProductCodes.size} 条保留） 完成`)

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

  // 4) 科目体系（PL_ 经营 / BS_ 静态 / CF_ 现金流三套，级联编码）
  const operating = decorateTree(rawOperatingAnalysis, 'PL')
  const staticSubs = decorateTree(rawStaticAnalysis, 'BS')
  const cashflowSubs = decorateTree(rawCashflowAnalysis, 'CF')
  const allSubjects = [...operating, ...staticSubs, ...cashflowSubs]
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
  console.log(`[seed] 科目体系 ${allSubjects.length} 条（经营 ${operating.length} + 静态 ${staticSubs.length} + 现金流 ${cashflowSubs.length}）完成`)

  // 5) 指标（每个科目一条）
  for (const s of allSubjects) {
    const dataType = metricDataTypeOf(s)
    await prisma.metric.upsert({
      where: { code: s.code },
      // 更新分支不覆盖 dataType：类型变更为高危操作，须走 DataService.convertMetricType
      // （含引用保护与审计）。种子静默回写会撤销运行期转换（如毛利叶子被转回数据类导致公式失效），
      // 仅在新建时按树定义初始化类型。
      update: { name: s.name, category: s.category },
      create: { code: s.code, name: s.name, category: s.category, dataType },
    })
  }
  console.log(`[seed] 指标 ${allSubjects.length} 条 完成`)

  // 6) 计算类指标展示公式（供聚合层计算层执行，如 毛利 = 收入 - 成本）
  await seedCalcMetricFormulas(prisma)

  // 6-1) 运营费用映射（运营费用分析，仅空表初始化：默认叶子科目一对一）。
  // 加固（2026-09-04 事故复盘）：旧逻辑按「编码不存在则补建默认」执行，管理员归并维护后（如仅保留
  // EXP_001~010），seed 会把默认清单剩余项以单科目形式补回（仓储/研发/折旧/财务费用等重复计入，
  // 运营费用预算虚增）。现改为：表内存在任何活跃映射（含旧格式 PL 编码行）即视为管理员已维护，
  // seed 完全不介入（不补建、不迁移）；仅在无活跃映射（空表或全墓碑）时初始化默认配置。
  // 注：删除为软删除（墓碑，见 ExpenseAnalysisService.remove），被管理员删除过的编码不随 seed 复活。
  const feeSubjects = await prisma.accountSubject.findMany({
    where: { subjectType: 'operating', category: '壹品慧费用', status: 'active' },
    select: { code: true, name: true },
  })
  const feeNameToCode = new Map(feeSubjects.map((s) => [s.name, s.code]))
  const expenseMappings = EXPENSE_SUBJECT_NAMES
    .filter((n) => feeNameToCode.has(n))
    .map((n, i) => ({ code: `EXP_${String(i + 1).padStart(3, '0')}`, name: n, subjectCodes: [feeNameToCode.get(n) as string], sortOrder: i + 1 }))
  const mappingRows = await prisma.expenseSubjectMapping.findMany({ select: { code: true, deletedAt: true } })
  const activeMappings = mappingRows.filter((m) => !m.deletedAt)
  if (activeMappings.length > 0) {
    console.log(`[seed] 运营费用映射 既有 ${activeMappings.length} 条活跃映射，跳过默认初始化（管理员口径优先） 完成`)
  } else {
    const tombstoneCodes = new Set(mappingRows.filter((m) => m.deletedAt).map((m) => m.code))
    const toCreate = expenseMappings.filter((em) => !tombstoneCodes.has(em.code))
    for (const em of toCreate) {
      await prisma.expenseSubjectMapping.create({
        data: { code: em.code, name: em.name, subjectCodes: em.subjectCodes, sortOrder: em.sortOrder, status: 'active' },
      })
    }
    console.log(`[seed] 运营费用映射 初始化 ${toCreate.length} 条（墓碑 ${tombstoneCodes.size} 个编码不复活） 完成`)
  }

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
