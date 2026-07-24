import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma, prisma } from '../lib/prisma'
import { validateFormulaChange } from './FormulaRuleService'
import { DataService } from './DataService'

/**
 * P0 正确性测试（真实 DB）：全图环检测、dependsOn 重算、清空公式、版本历史。
 * 无 DB 时整组跳过。
 */

let dbReady = false
let adminId = ''
const tempMetricCodes: string[] = []
let realCodeA = 'OP_001'
let realCodeB = 'OP_002'

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    const admin = await prisma.user.findUnique({ where: { username: 'admin' }, select: { id: true } })
    dbReady = !!admin
    if (admin) adminId = admin.id
    const subjects = await prisma.accountSubject.findMany({ take: 2, select: { code: true } })
    if (subjects.length >= 2) {
      realCodeA = subjects[0].code
      realCodeB = subjects[1].code
    }
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  const tempMetrics = await basePrisma.metric.findMany({ where: { code: { in: tempMetricCodes } }, select: { id: true } })
  const tempIds = tempMetrics.map((m) => m.id)
  await basePrisma.metricDefinitionHistory.deleteMany({ where: { metricId: { in: tempIds } } }).catch(() => undefined)
  await basePrisma.metric.deleteMany({ where: { code: { in: tempMetricCodes } } }).catch(() => undefined)
})

const ctx = () => ({ userId: adminId, traceId: 'test' })

describe('validateFormulaChange 全图校验', () => {
  it('合法公式：dependsOn 重算且无告警', async () => {
    if (!dbReady) return
    const res = await validateFormulaChange('CALC_TMP_OK', `{${realCodeA}} / {${realCodeB}}`)
    expect(res.dependsOn.sort()).toEqual([realCodeA, realCodeB].sort())
    expect(res.warnings).toEqual([])
  })

  it('引用不存在编码 → 告警', async () => {
    if (!dbReady) return
    const res = await validateFormulaChange('CALC_TMP_BAD', '{OP_NOT_EXIST} + 1')
    expect(res.warnings.some((w) => w.includes('不存在'))).toBe(true)
  })

  it('多节点间接环（X→Y→X）应被检测', async () => {
    if (!dbReady) return
    const codeX = `CALC_CYC_X_${Date.now().toString(36)}`
    const codeY = `CALC_CYC_Y_${Date.now().toString(36)}`
    tempMetricCodes.push(codeX, codeY)
    await prisma.metric.create({ data: { code: codeY, name: 'Y', category: '自定义', dataType: 'calc', formula: `{${codeX}}`, dependsOn: [codeX] as never } })
    const res = await validateFormulaChange(codeX, `{${codeY}} + 1`)
    expect(res.warnings.some((w) => w.includes('环'))).toBe(true)
  })
})

describe('DataService 公式变更', () => {
  it('createMetric 重算 dependsOn 并写历史', async () => {
    if (!dbReady) return
    const code = `CALC_CR_${Date.now().toString(36)}`
    tempMetricCodes.push(code)
    await DataService.createMetric({ code, name: '创建测试', dataType: 'calc', formula: `{${realCodeA}} - {${realCodeB}}`, category: '自定义' }, ctx())
    const metric = await basePrisma.metric.findUnique({ where: { code } })
    expect((metric?.dependsOn as string[]).sort()).toEqual([realCodeA, realCodeB].sort())
    const history = await basePrisma.metricDefinitionHistory.findMany({ where: { metricId: metric!.id } })
    expect(history.length).toBe(1)
    expect(history[0].formula).toBe(`{${realCodeA}} - {${realCodeB}}`)
  })

  it('updateMetric 改公式 → dependsOn 同步 + 版本+1 + 历史新增', async () => {
    if (!dbReady) return
    const code = `CALC_UP_${Date.now().toString(36)}`
    tempMetricCodes.push(code)
    const created = await DataService.createMetric({ code, name: '更新测试', dataType: 'calc', formula: `{${realCodeA}}`, category: '自定义' }, ctx())
    const newFormula = `{${realCodeA}} + {${realCodeB}}`
    await DataService.updateMetric(created.id, { formula: newFormula }, ctx())
    const metric = await basePrisma.metric.findUnique({ where: { code } })
    expect(metric?.formula).toBe(newFormula)
    expect((metric?.dependsOn as string[]).sort()).toEqual([realCodeA, realCodeB].sort())
    expect(metric?.version).toBe(2)
    const history = await basePrisma.metricDefinitionHistory.findMany({ where: { metricId: metric!.id }, orderBy: { version: 'asc' } })
    expect(history.length).toBe(2)
  })

  it('updateMetric 传 formula=null → 清空公式与依赖', async () => {
    if (!dbReady) return
    const code = `CALC_CLR_${Date.now().toString(36)}`
    tempMetricCodes.push(code)
    const created = await DataService.createMetric({ code, name: '清空测试', dataType: 'calc', formula: `{${realCodeA}}`, category: '自定义' }, ctx())
    await DataService.updateMetric(created.id, { formula: null }, ctx())
    const metric = await basePrisma.metric.findUnique({ where: { code } })
    expect(metric?.formula).toBeNull()
    expect(metric?.dependsOn).toEqual([])
  })

  it('updateMetric 非法公式（不存在编码）→ 抛错且不落库', async () => {
    if (!dbReady) return
    const code = `CALC_INV_${Date.now().toString(36)}`
    tempMetricCodes.push(code)
    const created = await DataService.createMetric({ code, name: '非法测试', dataType: 'calc', formula: `{${realCodeA}}`, category: '自定义' }, ctx())
    await expect(DataService.updateMetric(created.id, { formula: '{OP_NOT_EXIST} + 1' }, ctx())).rejects.toBeTruthy()
    const metric = await basePrisma.metric.findUnique({ where: { code } })
    expect(metric?.formula).toBe(`{${realCodeA}}`)
  })
})
