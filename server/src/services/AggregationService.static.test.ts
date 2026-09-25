import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { AggregationService, flattenValueTree } from './AggregationService'
import { STATIC_DIMS } from '../lib/metric-values'

/**
 * 静态四维派生端到端验证（真实 DB）。
 * 造唯一公司 + 独立 active 静态批次，插入 4 个月原始快照（marker=CURRENT_AMOUNT），
 * 断言 buildStaticTree 按选定期的快照月份派生本期/年初/同期/上年年初。afterAll 硬删除；无 DB 时跳过。
 */

let dbReady = false
const suffix = Date.now().toString(36)
const companyCode = `ENSTA${suffix}`.slice(0, 20)
const batchId = `batchsta_${suffix}`
let leafCode = ''
const P = '2099-05'

function utcDate(period: string): Date {
  const [y, m] = period.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 15))
}

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    const leaves = await basePrisma.accountSubject.findMany({
      where: { subjectType: 'static', isLeaf: true, status: 'active' },
      select: { code: true },
    })
    const dataMetric = await basePrisma.metric.findFirst({
      where: { code: { in: leaves.map((l) => l.code) }, dataType: 'data' },
      select: { code: true },
    })
    leafCode = dataMetric?.code ?? ''
    dbReady = !!leafCode
    if (!dbReady) return
    await basePrisma.importBatch.create({
      data: { id: batchId, fileName: 'static-test.xlsx', status: 'success', dataType: 'static', lifecycleStatus: 'active', fiscalYear: 'FY2099' },
    })
    const row = (period: string, value: number, fy: string) => ({
      batchId, companyCode, accountCode: leafCode, snapshotDate: utcDate(period),
      periodDimCode: STATIC_DIMS.CURRENT_AMOUNT, fiscalYear: fy, value,
    })
    // S=4: P='2099-05' → 年初='2099-03'（财年起始月前一月=上年期末）, 同期='2098-05', 上年年初='2098-03'
    await basePrisma.factStatic.createMany({
      data: [
        row('2099-05', 5000, 'FY2099'), // 本期
        row('2099-03', 4800, 'FY2098'), // 年初（FY2099 起始月 2099-04 的前一月期末）
        row('2098-05', 4500, 'FY2098'), // 同期
        row('2098-03', 4300, 'FY2098'), // 上年年初
      ],
    })
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.factStatic.deleteMany({ where: { batchId } }).catch(() => undefined)
  await basePrisma.importBatch.delete({ where: { id: batchId } }).catch(() => undefined)
})

describe('AggregationService 静态四维派生（真实 DB）', () => {
  it('按选定期快照月份派生本期/年初/同期/上年年初', async () => {
    if (!dbReady) return
    const tree = await AggregationService.buildStaticTree([companyCode], P)
    const leaf = flattenValueTree(tree).find((n) => n.code === leafCode)
    expect(leaf).toBeTruthy()
    expect(leaf!.values[STATIC_DIMS.CURRENT_AMOUNT]).toBe(5000) // 2099-05
    expect(leaf!.values[STATIC_DIMS.YEAR_START]).toBe(4800) // 2099-03（财年起始月前一月=上年期末）
    expect(leaf!.values[STATIC_DIMS.SAME_PERIOD_AMOUNT]).toBe(4500) // 2098-05
    expect(leaf!.values[STATIC_DIMS.LAST_YEAR_START]).toBe(4300) // 2098-03
  })
})

// ===== H8 回归：直填判定按「公司×科目×月份」粒度，跨公司合并 =====
const PARENT = `STAP${suffix}`.slice(0, 18)
const CHILD1 = `STC1${suffix}`.slice(0, 18)
const CHILD2 = `STC2${suffix}`.slice(0, 18)
const CO_A = `STAA${suffix}`.slice(0, 20)
const CO_B = `STAB${suffix}`.slice(0, 20)
const CO_C = `STAC${suffix}`.slice(0, 20)
const batchH8 = `batchsta_h8_${suffix}`
const YS = '2099-03' // 年初快照月

describe('buildStaticTree 直填公司粒度（真实 DB，H8 回归）', () => {
  beforeAll(async () => {
    if (!dbReady) return
    await basePrisma.accountSubject.createMany({
      data: [
        { code: PARENT, name: 'H8父级', subjectType: 'static', level: 0, parentCode: null, category: 'H8测试', direction: 'debit', isLeaf: false, orderNo: 9001 },
        { code: CHILD1, name: 'H8子1', subjectType: 'static', level: 1, parentCode: PARENT, category: 'H8测试', direction: 'debit', isLeaf: true, orderNo: 9002 },
        { code: CHILD2, name: 'H8子2', subjectType: 'static', level: 1, parentCode: PARENT, category: 'H8测试', direction: 'debit', isLeaf: true, orderNo: 9003 },
      ],
    })
    await basePrisma.importBatch.create({
      data: { id: batchH8, fileName: 'static-h8.xlsx', status: 'success', dataType: 'static', lifecycleStatus: 'active', fiscalYear: 'FY2099' },
    })
    const row = (co: string, acc: string, period: string, value: number) => ({
      batchId: batchH8, companyCode: co, accountCode: acc, snapshotDate: utcDate(period),
      periodDimCode: STATIC_DIMS.CURRENT_AMOUNT, fiscalYear: 'FY2099', value,
    })
    await basePrisma.factStatic.createMany({
      data: [
        // 甲：父级本期直填 100，子1 本期 80（直填与明细不一致是真实场景），子1 年初 30
        row(CO_A, PARENT, P, 100), row(CO_A, CHILD1, P, 80), row(CO_A, CHILD1, YS, 30),
        // 乙：父级缺行，子2 本期 50；子1 年初 20
        row(CO_B, CHILD2, P, 50), row(CO_B, CHILD1, YS, 20),
        // 丙：父级直填真实 0，子级 999（直填 0 必须生效）
        row(CO_C, PARENT, P, 0), row(CO_C, CHILD1, P, 999),
      ],
    })
  })

  afterAll(async () => {
    if (!dbReady) return
    await basePrisma.factStatic.deleteMany({ where: { batchId: batchH8 } }).catch(() => undefined)
    await basePrisma.importBatch.delete({ where: { id: batchH8 } }).catch(() => undefined)
    await basePrisma.accountSubject.deleteMany({ where: { code: { in: [PARENT, CHILD1, CHILD2] } } }).catch(() => undefined)
  })

  it('混合输入：甲直填 + 乙缺父级 → 合查为 150 而非 100', async () => {
    if (!dbReady) return
    const tree = await AggregationService.buildStaticTree([CO_A, CO_B], P)
    const parent = flattenValueTree(tree).find((n) => n.code === PARENT)
    expect(parent!.values[STATIC_DIMS.CURRENT_AMOUNT]).toBe(150) // 100 直填 + 50 子求和
    expect(parent!.values[STATIC_DIMS.YEAR_START]).toBe(50) // 两公司均无父级年初直填 → 子求和 30+20
  })

  it('跨期缺父级：本期直填生效、年初维度回退子求和（单公司）', async () => {
    if (!dbReady) return
    const tree = await AggregationService.buildStaticTree([CO_A], P)
    const parent = flattenValueTree(tree).find((n) => n.code === PARENT)
    expect(parent!.values[STATIC_DIMS.CURRENT_AMOUNT]).toBe(100)
    expect(parent!.values[STATIC_DIMS.YEAR_START]).toBe(30)
  })

  it('直填真实 0 生效（单公司直填 0 不被子级 999 覆盖）', async () => {
    if (!dbReady) return
    const tree = await AggregationService.buildStaticTree([CO_C], P)
    const parent = flattenValueTree(tree).find((n) => n.code === PARENT)
    expect(parent!.values[STATIC_DIMS.CURRENT_AMOUNT]).toBe(0)
  })
})
