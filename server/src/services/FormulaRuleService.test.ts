import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma, prisma } from '../lib/prisma'
import { FormulaRuleService, extractCodes, validateFormula, matchRule } from './FormulaRuleService'

describe('FormulaRuleService 纯函数', () => {
  it('extractCodes 提取 {CODE} 操作数并去重', () => {
    expect(extractCodes('{OP_040} / {OP_001}')).toEqual(['OP_040', 'OP_001'])
    expect(extractCodes('{A} + {A} - {B}')).toEqual(['A', 'B'])
    expect(extractCodes('1 + 2')).toEqual([])
  })

  it('validateFormula：合法公式无告警', () => {
    const known = new Set(['OP_040', 'OP_001'])
    expect(validateFormula('{OP_040} / {OP_001}', known, 'CALC_X')).toEqual([])
  })

  it('validateFormula：未知编码 / 非法语法 / 环 各自告警', () => {
    const known = new Set(['OP_001'])
    expect(validateFormula('{OP_999} / {OP_001}', known, 'CALC_X').some((w) => w.includes('不存在'))).toBe(true)
    expect(validateFormula('{OP_001} +', known, 'CALC_X').some((w) => w.includes('语法'))).toBe(true)
    expect(validateFormula('{CALC_X}', known, 'CALC_X').some((w) => w.includes('环'))).toBe(true)
  })

  it('matchRule：指标名包含规则名，取最长匹配', () => {
    const rules = [
      { id: '1', name: '毛利率', formulaTemplate: '{A}/{B}', refCodes: [], description: null },
      { id: '2', name: '增值业务毛利率', formulaTemplate: '{C}/{D}', refCodes: [], description: null },
    ]
    expect(matchRule('壹品慧毛利率', rules)?.name).toBe('毛利率')
    expect(matchRule('增值业务毛利率', rules)?.name).toBe('增值业务毛利率')
    expect(matchRule('无关指标', rules)).toBeNull()
  })
})

describe('FormulaRuleService 集成（真实 DB）', () => {
  let dbReady = false
  let adminId = ''
  const tempMetricCodes: string[] = []

  beforeAll(async () => {
    try {
      await basePrisma.$queryRaw`SELECT 1`
      const admin = await prisma.user.findUnique({ where: { username: 'admin' }, select: { id: true } })
      dbReady = !!admin
      if (admin) adminId = admin.id
    } catch {
      dbReady = false
    }
  })

  afterAll(async () => {
    if (!dbReady) return
    await basePrisma.metric.deleteMany({ where: { code: { in: tempMetricCodes } } }).catch(() => undefined)
  })

  it('listRules 返回已种子规则', async () => {
    if (!dbReady) return
    const rules = await FormulaRuleService.listRules()
    expect(rules.length).toBeGreaterThan(0)
    expect(rules.some((r) => r.name === '毛利率')).toBe(true)
  })

  it('batchGenerate 为 calc 指标生成公式（含命中与未命中）', async () => {
    if (!dbReady) return
    const results = await FormulaRuleService.batchGenerate({ subjectType: 'operating' })
    expect(results.length).toBeGreaterThan(0)
    const matched = results.filter((r) => r.ruleName)
    expect(matched.length).toBeGreaterThan(0)
    // 命中项的公式应通过校验（引用编码均存在于经营科目）
    for (const r of matched) {
      expect(r.formula).toBeTruthy()
      expect(r.valid).toBe(true)
    }
  })

  it('batchApply 落库公式', async () => {
    if (!dbReady) return
    const code = `CALC_APPLY_${Date.now().toString(36)}`
    tempMetricCodes.push(code)
    await prisma.metric.create({ data: { code, name: '临时应用指标', category: '自定义', dataType: 'calc' } })

    const res = await FormulaRuleService.batchApply([{ code, formula: '{OP_040} / {OP_001}', dependsOn: ['OP_040', 'OP_001'] }], adminId, 'trace')
    expect(res.applied).toBe(1)

    const metric = await basePrisma.metric.findUnique({ where: { code } })
    expect(metric?.formula).toBe('{OP_040} / {OP_001}')
    expect(metric?.isDerived).toBe(true)
  })
})
