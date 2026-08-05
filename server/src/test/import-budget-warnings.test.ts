import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { computeBudgetWarnings } from '../services/ImportService'
import { seedDomain } from '../../prisma/seed-domain'

/**
 * 预算导入毛利口径告警（computeBudgetWarnings）集成测试（真实 DB）。
 * 覆盖：calc 毛利叶子缺行不告警、data 毛利叶子缺行告警、文件含行不告警、
 * data+formula 矛盾状态归口 typeFormulaMismatch（不误导为直导缺行）、
 * seed 幂等性（运行期转换的 metric.dataType 不被种子回写）。
 * 无 DB 时整组跳过；临时数据 afterAll 清理。
 */

let dbReady = false
const tempSubjectCodes: string[] = []
const tempMetricCodes: string[] = []
const suffix = Date.now().toString(36)

const LEAF_CALC = `OP_TP_GP_CALC_${suffix}`
const LEAF_DATA = `OP_TP_GP_DATA_${suffix}`
const LEAF_DATA_IN_FILE = `OP_TP_GP_DIF_${suffix}`
const LEAF_MISMATCH = `OP_TP_GP_MM_${suffix}`

async function createTempLeaf(code: string, name: string): Promise<void> {
  tempSubjectCodes.push(code)
  await basePrisma.accountSubject.create({
    data: { code, name, subjectType: 'operating', level: 3, parentCode: null, category: '毛利', direction: 'credit', isLeaf: true },
  })
}

async function createTempMetric(code: string, dataType: 'data' | 'calc', formula?: string): Promise<void> {
  tempMetricCodes.push(code)
  await basePrisma.metric.create({
    data: { code, name: code, category: '毛利', dataType, formula: formula ?? null, dependsOn: formula ? ['OP_02', 'OP_03'] : [] },
  })
}

const names = {
  calc: `测试毛利calc_${suffix}`,
  data: `测试毛利data_${suffix}`,
  dataInFile: `测试毛利dataInFile_${suffix}`,
  mismatch: `测试毛利mismatch_${suffix}`,
}

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    await createTempLeaf(LEAF_CALC, names.calc)
    await createTempLeaf(LEAF_DATA, names.data)
    await createTempLeaf(LEAF_DATA_IN_FILE, names.dataInFile)
    await createTempLeaf(LEAF_MISMATCH, names.mismatch)
    await createTempMetric(LEAF_CALC, 'calc', '{OP_02} - {OP_03}')
    await createTempMetric(LEAF_DATA, 'data')
    await createTempMetric(LEAF_DATA_IN_FILE, 'data')
    await createTempMetric(LEAF_MISMATCH, 'data', '{OP_02} - {OP_03}')
    dbReady = true
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.metric.deleteMany({ where: { code: { in: tempMetricCodes } } }).catch(() => undefined)
  await basePrisma.accountSubject.deleteMany({ where: { code: { in: tempSubjectCodes } } }).catch(() => undefined)
})

describe('computeBudgetWarnings 毛利口径告警', () => {
  it('calc 毛利叶子缺行不告警（公式层重算，无需直导）', async () => {
    if (!dbReady) return
    const w = await computeBudgetWarnings([LEAF_DATA]) // 文件仅含 data 叶子，不含 calc 叶子
    expect(w?.missingProfitLeaves ?? []).not.toContain(names.calc)
    expect(w?.typeFormulaMismatch ?? []).not.toContain(names.calc)
    expect(w?.recalcSubjects ?? []).not.toContain(names.calc)
  })

  it('data 无公式毛利叶子缺行 → missingProfitLeaves', async () => {
    if (!dbReady) return
    const w = await computeBudgetWarnings([LEAF_CALC])
    expect(w?.missingProfitLeaves ?? []).toContain(names.data)
  })

  it('data 无公式毛利叶子在文件中 → 不告警缺行', async () => {
    if (!dbReady) return
    const w = await computeBudgetWarnings([LEAF_DATA_IN_FILE])
    expect(w?.missingProfitLeaves ?? []).not.toContain(names.dataInFile)
  })

  it('data+formula 矛盾状态 → typeFormulaMismatch，且不误导为直导缺行', async () => {
    if (!dbReady) return
    const w = await computeBudgetWarnings([LEAF_DATA]) // 非空文件科目集合，避免空数组早退
    expect(w?.typeFormulaMismatch ?? []).toContain(names.mismatch)
    expect(w?.missingProfitLeaves ?? []).not.toContain(names.mismatch)
  })
})

describe('种子幂等性：不覆盖运行期类型转换', () => {
  it('seed 运行前后毛利叶子 metric.dataType 保持一致', async () => {
    if (!dbReady) return
    // 与科目树毛利子树的 9 个叶子（修复后为计算类）对应；断言不被种子回写
    const codes = ['OP_04010103', 'OP_04010104', 'OP_04010105', 'OP_04010106', 'OP_04010107', 'OP_04010108', 'OP_04010301', 'OP_04010302', 'OP_040104']
    const before = await basePrisma.metric.findMany({ where: { code: { in: codes } }, select: { code: true, dataType: true } })
    if (before.length === 0) return // 环境无该科目体系则跳过
    await seedDomain(basePrisma)
    const after = await basePrisma.metric.findMany({ where: { code: { in: codes } }, select: { code: true, dataType: true } })
    const afterByCode = new Map(after.map((m) => [m.code, m.dataType]))
    for (const b of before) {
      expect(afterByCode.get(b.code)).toBe(b.dataType)
    }
  })
})
