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
    await prisma.metric.update({ where: { code: selfCode }, data: { formula: plan.formula, dependsOn: plan.deps as never } })
    count++
  }
  console.log(`[seed] 计算类指标公式 ${count} 条 完成`)
}

// ============================================================
// 批量公式生成规则种子（65 条，覆盖全部 OP_ calc 指标）
// 规则名 = 指标全名（最长匹配保证精确命中），formulaTemplate 直接引用编码。
// ============================================================
const BATCH_FORMULA_RULES: { name: string; formulaTemplate: string; description: string }[] = [
  // ── 回款汇总 ──
  { name: '回款', formulaTemplate: '{OP_003} + {OP_004}', description: '回款 = 增值业务回款 + 直饮水业务回款' },
  { name: '壹品慧回款', formulaTemplate: '{OP_003} + {OP_004}', description: '壹品慧回款 = 增值业务回款 + 直饮水业务回款' },
  // ── 收入汇总 ──
  { name: '收入', formulaTemplate: '{OP_006}', description: '收入 = 壹品慧收入' },
  { name: '壹品慧收入', formulaTemplate: '{OP_007} + {OP_026} + {OP_027} + {OP_030}', description: '壹品慧收入 = 增值业务收入 + 安检业务收入 + 直饮水业务收入 + 其他业务收入' },
  { name: '增值业务收入', formulaTemplate: '{OP_008} + {OP_016} + {OP_020} + {OP_021} + {OP_022} + {OP_023} + {OP_024} + {OP_025}', description: '增值业务收入 = 厨房产品销售收入 + 安防产品收入 + 优选 + 家电 + 宜居 + 宣传 + 维修 + 新产品' },
  { name: '厨房产品销售收入（不含净水及服务）', formulaTemplate: '{OP_009} + {OP_010} + {OP_011} + {OP_012} + {OP_013} + {OP_014} + {OP_015}', description: '厨房产品销售收入 = 灶具 + 热水器 + 烟机 + 消毒柜 + 壁挂炉 + 其他厨房 + 售后' },
  { name: '安防产品销售与服务收入', formulaTemplate: '{OP_017} + {OP_018} + {OP_019}', description: '安防产品收入 = 波纹管 + 报警器 + 安防服务' },
  { name: '直饮水业务收入', formulaTemplate: '{OP_028} + {OP_029}', description: '直饮水业务收入 = 安装收入 + 售水收入' },
  // ── 成本汇总 ──
  { name: '成本', formulaTemplate: '{OP_032}', description: '成本 = 壹品慧成本' },
  { name: '壹品慧成本', formulaTemplate: '{OP_033} + {OP_048} + {OP_049} + {OP_052}', description: '壹品慧成本 = 增值业务成本 + 安检业务成本 + 直饮水业务成本 + 其他业务成本' },
  { name: '增值业务成本', formulaTemplate: '{OP_034} + {OP_042} + {OP_046} + {OP_047} + {OP_048} + {OP_049} + {OP_050} + {OP_051}', description: '增值业务成本 = 厨房产品成本 + 安防产品成本 + 优选 + 家电 + 宜居 + 宣传 + 维修 + 新产品' },
  { name: '厨房产品销售成本（不含净水及服务）', formulaTemplate: '{OP_035} + {OP_036} + {OP_037} + {OP_038} + {OP_039} + {OP_040} + {OP_041}', description: '厨房产品销售成本 = 灶具 + 热水器 + 烟机 + 消毒柜 + 壁挂炉 + 其他厨房 + 售后' },
  { name: '安防产品销售与服务成本', formulaTemplate: '{OP_043} + {OP_044} + {OP_045}', description: '安防产品成本 = 波纹管 + 报警器 + 安防服务' },
  { name: '直饮水业务成本', formulaTemplate: '{OP_050} + {OP_051}', description: '直饮水业务成本 = 直饮水安装成本 + 直饮水售水成本' },
  // ── 毛利汇总（毛利 = 收入 - 成本）──
  { name: '毛利', formulaTemplate: '{OP_005} - {OP_031}', description: '毛利 = 收入 - 成本' },
  { name: '壹品慧毛利', formulaTemplate: '{OP_006} - {OP_032}', description: '壹品慧毛利 = 壹品慧收入 - 壹品慧成本' },
  { name: '增值业务毛利', formulaTemplate: '{OP_007} - {OP_033}', description: '增值业务毛利 = 增值业务收入 - 增值业务成本' },
  { name: '厨房产品销售毛利（不含净水及服务）', formulaTemplate: '{OP_008} - {OP_034}', description: '厨房产品销售毛利 = 厨房收入 - 厨房成本' },
  { name: '燃气具-灶具毛利', formulaTemplate: '{OP_009} - {OP_035}', description: '灶具毛利 = 灶具收入 - 灶具成本' },
  { name: '燃气具-热水器毛利', formulaTemplate: '{OP_010} - {OP_036}', description: '热水器毛利 = 热水器收入 - 热水器成本' },
  { name: '燃气具-烟机毛利', formulaTemplate: '{OP_011} - {OP_037}', description: '烟机毛利 = 烟机收入 - 烟机成本' },
  { name: '燃气具-消毒柜毛利', formulaTemplate: '{OP_012} - {OP_038}', description: '消毒柜毛利 = 消毒柜收入 - 消毒柜成本' },
  { name: '燃气具-壁挂炉毛利', formulaTemplate: '{OP_013} - {OP_039}', description: '壁挂炉毛利 = 壁挂炉收入 - 壁挂炉成本' },
  { name: '燃气具-其他厨房用品毛利', formulaTemplate: '{OP_014} - {OP_040}', description: '其他厨房用品毛利 = 其他厨房收入 - 其他厨房成本' },
  { name: '燃气具售后/安装/维保服务毛利', formulaTemplate: '{OP_015} - {OP_041}', description: '售后毛利 = 售后收入 - 售后成本' },
  { name: '安防产品销售与服务毛利', formulaTemplate: '{OP_016} - {OP_042}', description: '安防产品毛利 = 安防收入 - 安防成本' },
  { name: '波纹管毛利', formulaTemplate: '{OP_017} - {OP_043}', description: '波纹管毛利 = 波纹管收入 - 波纹管成本' },
  { name: '报警器毛利', formulaTemplate: '{OP_018} - {OP_044}', description: '报警器毛利 = 报警器收入 - 报警器成本' },
  { name: '安防产品服务毛利', formulaTemplate: '{OP_019} - {OP_045}', description: '安防服务毛利 = 安防服务收入 - 安防服务成本' },
  { name: '安检业务毛利', formulaTemplate: '{OP_026} - {OP_048}', description: '安检业务毛利 = 安检收入 - 安检成本' },
  { name: '直饮水业务毛利', formulaTemplate: '{OP_027} - {OP_049}', description: '直饮水业务毛利 = 直饮水收入 - 直饮水成本' },
  // ── 费用汇总 ──
  { name: '费用', formulaTemplate: '{OP_075}', description: '费用 = 壹品慧费用' },
  { name: '壹品慧费用', formulaTemplate: '{OP_076} + {OP_094}', description: '壹品慧费用 = 运营费用 + 财务费用' },
  { name: '运营费用', formulaTemplate: '{OP_077} + {OP_093}', description: '运营费用 = 付现运营费用 + 非付现运营费用' },
  { name: '付现运营费用', formulaTemplate: '{OP_078} + {OP_079} + {OP_080} + {OP_081} + {OP_082} + {OP_083} + {OP_084} + {OP_085} + {OP_087} + {OP_088} + {OP_089} + {OP_090} + {OP_091} + {OP_092}', description: '付现运营费用 = 人力 + 生产运营 + 行政 + 市场 + 差旅 + 招待 + 会议 + 客服 + 车辆 + 税费 + 劳保 + 信息 + 中介 + 保险 + 其他 + 技术 + 安全监察' },
  { name: '非付现运营费用', formulaTemplate: '{OP_093}', description: '非付现运营费用 = 折旧摊销' },
  // ── 毛利率（毛利率 = 毛利 / 收入）──
  { name: '壹品慧毛利率', formulaTemplate: '{OP_053} / {OP_006}', description: '壹品慧毛利率 = 壹品慧毛利 / 壹品慧收入' },
  { name: '增值业务毛利率', formulaTemplate: '{OP_054} / {OP_007}', description: '增值业务毛利率 = 增值业务毛利 / 增值业务收入' },
  { name: '厨房产品销售毛利率（不含净水及服务）', formulaTemplate: '{OP_055} / {OP_008}', description: '厨房产品销售毛利率 = 厨房毛利 / 厨房收入' },
  { name: '燃气具-灶具毛利率', formulaTemplate: '{OP_056} / {OP_009}', description: '灶具毛利率 = 灶具毛利 / 灶具收入' },
  { name: '燃气具-热水器毛利率', formulaTemplate: '{OP_057} / {OP_010}', description: '热水器毛利率 = 热水器毛利 / 热水器收入' },
  { name: '燃气具-烟机毛利率', formulaTemplate: '{OP_058} / {OP_011}', description: '烟机毛利率 = 烟机毛利 / 烟机收入' },
  { name: '燃气具-消毒柜毛利率', formulaTemplate: '{OP_059} / {OP_012}', description: '消毒柜毛利率 = 消毒柜毛利 / 消毒柜收入' },
  { name: '燃气具-壁挂炉毛利率', formulaTemplate: '{OP_060} / {OP_013}', description: '壁挂炉毛利率 = 壁挂炉毛利 / 壁挂炉收入' },
  { name: '燃气具-其他厨房用品毛利率', formulaTemplate: '{OP_061} / {OP_014}', description: '其他厨房毛利率 = 其他厨房毛利 / 其他厨房收入' },
  { name: '燃气具售后/安装/维保服务毛利率', formulaTemplate: '{OP_062} / {OP_015}', description: '售后毛利率 = 售后毛利 / 售后收入' },
  { name: '安防产品销售与服务毛利率', formulaTemplate: '{OP_063} / {OP_016}', description: '安防产品毛利率 = 安防毛利 / 安防收入' },
  { name: '波纹管毛利率', formulaTemplate: '{OP_064} / {OP_017}', description: '波纹管毛利率 = 波纹管毛利 / 波纹管收入' },
  { name: '报警器毛利率', formulaTemplate: '{OP_065} / {OP_018}', description: '报警器毛利率 = 报警器毛利 / 报警器收入' },
  { name: '安防产品服务毛利率', formulaTemplate: '{OP_066} / {OP_019}', description: '安防服务毛利率 = 安防服务毛利 / 安防服务收入' },
  { name: '优选产品毛利率', formulaTemplate: '{OP_067} / {OP_020}', description: '优选产品毛利率 = 优选产品毛利 / 优选产品收入' },
  { name: '家用电器毛利率（含净水）', formulaTemplate: '{OP_068} / {OP_021}', description: '家用电器毛利率 = 家用电器毛利 / 家用电器收入' },
  { name: '宜居产品毛利率', formulaTemplate: '{OP_069} / {OP_022}', description: '宜居产品毛利率 = 宜居产品毛利 / 宜居产品收入' },
  { name: '宣传推广毛利率', formulaTemplate: '{OP_070} / {OP_023}', description: '宣传推广毛利率 = 宣传推广毛利 / 宣传推广收入' },
  { name: '维修改造业务毛利率', formulaTemplate: '{OP_071} / {OP_024}', description: '维修改造毛利率 = 维修改造毛利 / 维修改造收入' },
  { name: '新产品及其它毛利率', formulaTemplate: '{OP_072} / {OP_025}', description: '新产品毛利率 = 新产品毛利 / 新产品收入' },
  { name: '安检业务毛利率', formulaTemplate: '{OP_073} / {OP_026}', description: '安检业务毛利率 = 安检毛利 / 安检收入' },
  { name: '直饮水业务毛利率', formulaTemplate: '{OP_074} / {OP_027}', description: '直饮水业务毛利率 = 直饮水毛利 / 直饮水收入' },
  { name: '直饮水安装毛利率', formulaTemplate: '{OP_118} / {OP_028}', description: '直饮水安装毛利率 = 直饮水安装毛利 / 直饮水安装收入' },
  { name: '直饮水售水毛利率', formulaTemplate: '{OP_119} / {OP_029}', description: '直饮水售水毛利率 = 直饮水售水毛利 / 直饮水售水收入' },
  { name: '其他业务毛利率', formulaTemplate: '{OP_074} / {OP_030}', description: '其他业务毛利率 = 其他业务毛利 / 其他业务收入' },
  // ── 财务比率 ──
  { name: '壹品慧费用率', formulaTemplate: '{OP_075} / {OP_006}', description: '壹品慧费用率 = 壹品慧费用 / 壹品慧收入' },
  { name: '壹品慧净利润率', formulaTemplate: '{OP_097} / {OP_006}', description: '壹品慧净利润率 = 壹品慧净利润 / 壹品慧收入' },
  { name: '劳效比', formulaTemplate: '{OP_006} / {OP_078}', description: '劳效比 = 壹品慧收入 / 人力成本' },
  { name: '费效比', formulaTemplate: '{OP_075} / {OP_006}', description: '费效比 = 壹品慧费用 / 壹品慧收入' },
  // ── 现金流（净额 = 流入 - 流出）──
  { name: '自由现金流', formulaTemplate: '{OP_125} - {OP_128}', description: '自由现金流 = 经营活动现金流量净额 - 投资活动现金流量净额' },
  { name: '经营活动产生的现金流量净额', formulaTemplate: '{OP_126} - {OP_127}', description: '经营活动净额 = 经营流入 - 经营流出' },
  { name: '投资活动产生的现金流量净额', formulaTemplate: '{OP_129} - {OP_130}', description: '投资活动净额 = 投资流入 - 投资流出' },
  { name: '筹资活动产生的现金流量净额', formulaTemplate: '{OP_131} - {OP_132}', description: '筹资活动净额 = 筹资流入 - 筹资流出' },
]

/** 从公式模板中提取 {CODE} 编码数组 */
function extractRefCodes(template: string): string[] {
  const codes: string[] = []
  const re = /\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) codes.push(m[1].trim())
  return Array.from(new Set(codes))
}

/**
 * 批量公式生成规则种子（幂等：按 name upsert）。
 * 覆盖全部 OP_ 前缀 calc 指标，使"批量生成"功能可一次性为所有计算类指标填充公式。
 */
async function seedBatchFormulaRules(prisma: PrismaClient): Promise<void> {
  let count = 0
  for (const rule of BATCH_FORMULA_RULES) {
    const refCodes = extractRefCodes(rule.formulaTemplate)
    await prisma.formulaRule.upsert({
      where: { name: rule.name },
      update: { formulaTemplate: rule.formulaTemplate, refCodes: refCodes as never, description: rule.description, enabled: true },
      create: { name: rule.name, formulaTemplate: rule.formulaTemplate, refCodes: refCodes as never, description: rule.description, enabled: true },
    })
    count++
  }
  console.log(`[seed] 批量公式规则 ${count} 条 完成`)
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
        category: s.category, direction: s.direction, valueType: s.valueType, isLeaf: s.isLeaf, orderNo: s.orderNo,
      },
      create: {
        code: s.code, name: s.name, subjectType: s.subjectType, level: s.level, parentCode: s.parentCode,
        category: s.category, direction: s.direction, valueType: s.valueType, isLeaf: s.isLeaf, orderNo: s.orderNo,
      },
    })
  }
  console.log(`[seed] 科目体系 ${allSubjects.length} 条（经营 ${operating.length} + 静态 ${staticSubs.length}）完成`)

  // 3) 指标（每个科目一条）
  for (const s of allSubjects) {
    const dataType = metricDataTypeOf(s)
    await prisma.metric.upsert({
      where: { code: s.code },
      update: { name: s.name, category: s.category, dataType },
      create: { code: s.code, name: s.name, category: s.category, dataType },
    })
  }
  console.log(`[seed] 指标 ${allSubjects.length} 条 完成`)

  // 4) 公式规则（AI 辅助/批量公式生成）
  await seedFormulaRules(prisma)

  // 4b) 批量公式生成规则（覆盖全部 OP_ calc 指标）
  await seedBatchFormulaRules(prisma)

  // 5) 计算类指标展示公式（供聚合层计算层执行，如 毛利 = 收入 - 成本）
  await seedCalcMetricFormulas(prisma)

  // 注：事实数据不再 mock，由 3 个数据范例 Excel 经导入接口提供真实数据。
}
