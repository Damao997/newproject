import { PrismaClient } from '@prisma/client'
import { decorateTree, rawOperatingAnalysis, rawStaticAnalysis, type DecoratedSubject } from './seed-data/subject-trees'
import { OPERATING_DIMS, STATIC_DIMS } from '../src/lib/metric-values'

/**
 * 领域种子：期间维度 + 科目体系 + 指标 + 公式规则。
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

function metricDataTypeOf(s: DecoratedSubject): 'data' | 'calc' | 'display' {
  return s.dataType
}

// 公式规则种子：业务名 → 公式模板（引用科目按名称解析为编码）
const FORMULA_RULE_DEFS: { name: string; refs: string[]; template: (c: string[]) => string; description: string }[] = [
  { name: '毛利率', refs: ['毛利', '收入'], template: (c) => `${c[0]} / ${c[1]}`, description: '毛利率 = 毛利 / 收入' },
  { name: '费用率', refs: ['费用', '收入'], template: (c) => `${c[0]} / ${c[1]}`, description: '费用率 = 费用 / 收入' },
  { name: '净利率', refs: ['壹品慧净利润', '收入'], template: (c) => `${c[0]} / ${c[1]}`, description: '净利率 = 净利润 / 收入' },
  { name: '资产负债率', refs: ['总负债', '总资产'], template: (c) => `${c[0]} / ${c[1]}`, description: '资产负债率 = 总负债 / 总资产' },
  { name: '净资产回报率', refs: ['壹品慧净利润', '权益净资产'], template: (c) => `${c[0]} / ${c[1]}`, description: '净资产回报率(ROE) = 净利润 / 权益净资产' },
  { name: '总资产报酬率', refs: ['壹品慧净利润', '总资产'], template: (c) => `${c[0]} / ${c[1]}`, description: '总资产报酬率(ROA) = 净利润 / 总资产' },
]

async function seedFormulaRules(prisma: PrismaClient): Promise<void> {
  const subjects = await prisma.accountSubject.findMany({ select: { code: true, name: true } })
  const nameToCode = new Map(subjects.map((s) => [s.name, s.code]))
  let created = 0
  for (const def of FORMULA_RULE_DEFS) {
    const codes = def.refs.map((n) => nameToCode.get(n))
    if (codes.some((c) => !c)) continue // 依赖科目缺失则跳过
    const refCodes = codes as string[]
    const formulaTemplate = def.template(refCodes.map((c) => `{${c}}`))
    await prisma.formulaRule.upsert({
      where: { name: def.name },
      update: { formulaTemplate, refCodes: refCodes as never, description: def.description, enabled: true },
      create: { name: def.name, formulaTemplate, refCodes: refCodes as never, description: def.description, enabled: true },
    })
    created++
  }
  console.log(`[seed] 公式规则 ${created} 条 完成`)
}

// 计算类科目显式比率公式（无法由“毛利/毛利率”镜像配对自动覆盖的部分）：
// 费用率/净利率（内树）与跨树比率（资产负债率/ROE/ROA，ROE/ROA 引用经营“壹品慧净利润”）
const CALC_METRIC_FORMULA_DEFS: { name: string; refs: string[]; template: (c: string[]) => string }[] = [
  { name: '壹品慧费用率', refs: ['费用', '收入'], template: (c) => `${c[0]} / ${c[1]}` },
  { name: '壹品慧净利润率', refs: ['壹品慧净利润', '收入'], template: (c) => `${c[0]} / ${c[1]}` },
  { name: '资产负债率(%)', refs: ['总负债', '总资产'], template: (c) => `${c[0]} / ${c[1]}` },
  { name: '净资产回报率（ROE,%）', refs: ['壹品慧净利润', '权益净资产'], template: (c) => `${c[0]} / ${c[1]}` },
  { name: '总资产报酬率（ROA,%）', refs: ['壹品慧净利润', '总资产'], template: (c) => `${c[0]} / ${c[1]}` },
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
    plans.set(selfCode, { formula: tmpl(refs.map((c) => `{${c}}`)), deps: refs })
  }

  // 自动镜像配对：毛利子树与毛利率子树（先判“毛利率”再判“毛利”，避免子串误匹配）
  for (const s of subjects) {
    if (!calcCodes.has(s.code)) continue
    if (s.name.includes('毛利率')) {
      tryPair(s.name, [s.name.replace('毛利率', '毛利'), s.name.replace('毛利率', '收入')], (c) => `${c[0]} / ${c[1]}`)
    } else if (s.category === '毛利') {
      tryPair(s.name, [s.name.replace('毛利', '收入'), s.name.replace('毛利', '成本')], (c) => `${c[0]} - ${c[1]}`)
    }
  }

  // 叠加显式比率定义（覆盖同 code）
  for (const def of CALC_METRIC_FORMULA_DEFS) tryPair(def.name, def.refs, def.template)

  let count = 0
  for (const [selfCode, plan] of plans) {
    await prisma.metric.update({ where: { code: selfCode }, data: { formula: plan.formula, dependsOn: plan.deps as never, isDerived: true } })
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

  // 2) 科目体系
  const operating = decorateTree(rawOperatingAnalysis, 'OP')
  const staticSubs = decorateTree(rawStaticAnalysis, 'ST')
  const allSubjects = [...operating, ...staticSubs]
  for (const s of allSubjects) {
    await prisma.accountSubject.upsert({
      where: { code: s.code },
      update: {
        name: s.name, subjectType: s.subjectType, level: s.level, parentCode: s.parentCode,
        category: s.category, direction: s.direction, isLeaf: s.isLeaf, orderNo: s.orderNo,
      },
      create: {
        code: s.code, name: s.name, subjectType: s.subjectType, level: s.level, parentCode: s.parentCode,
        category: s.category, direction: s.direction, isLeaf: s.isLeaf, orderNo: s.orderNo,
      },
    })
  }
  console.log(`[seed] 科目体系 ${allSubjects.length} 条（经营 ${operating.length} + 静态 ${staticSubs.length}）完成`)

  // 3) 指标（每个科目一条）
  for (const s of allSubjects) {
    const dataType = metricDataTypeOf(s)
    await prisma.metric.upsert({
      where: { code: s.code },
      update: { name: s.name, category: s.category, dataType, direction: s.direction, isDerived: dataType === 'calc' },
      create: {
        code: s.code, name: s.name, category: s.category, dataType,
        direction: s.direction, isDerived: dataType === 'calc',
      },
    })
  }
  console.log(`[seed] 指标 ${allSubjects.length} 条 完成`)

  // 4) 公式规则（AI 辅助/批量公式生成）
  await seedFormulaRules(prisma)

  // 5) 计算类指标展示公式（供聚合层计算层执行，如 毛利 = 收入 - 成本）
  await seedCalcMetricFormulas(prisma)

  // 注：事实数据不再 mock，由 3 个数据范例 Excel 经导入接口提供真实数据。
}
