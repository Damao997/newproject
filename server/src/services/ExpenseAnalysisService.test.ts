import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { expenseCandidates, expenseMappingHealth, isValidMappingCode, nextExpenseMappingCode, buildLegacyMappingMigration } from './ExpenseAnalysisService'
import type { SubjectRow, MappingRow } from './ExpenseAnalysisService'
import { ExpenseAnalysisService } from './ExpenseAnalysisService'

/** 集成测试（真实 DB）上下文：沿用 DataService.test 惯例，无可用管理员时整组跳过 */
const ctx = { userId: 'test-user', traceId: 'test-trace' }
let dbReady = false

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    const admin = await basePrisma.user.findFirst({ select: { id: true } })
    if (admin) ctx.userId = admin.id
    dbReady = !!admin
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.$disconnect().catch(() => undefined)
})

/** 构造费用类别科目行（与科目树 壹品慧费用(PL05) > 运营费用(PL0501) 结构一致） */
function feeTree(): SubjectRow[] {
  return [
    // 壹品慧费用(05) > 运营费用 > [付现运营费用 / 非付现运营费用] + 财务费用（PL0502 平级）
    { code: 'PL05', name: '壹品慧费用', category: '壹品慧费用', level: 0, parentCode: null },
    { code: 'PL0501', name: '运营费用', category: '壹品慧费用', level: 1, parentCode: 'PL05' },
    { code: 'PL050101', name: '付现运营费用', category: '壹品慧费用', level: 2, parentCode: 'PL0501' },
    { code: 'PL05010101', name: '人力成本', category: '壹品慧费用', level: 3, parentCode: 'PL050101' },
    { code: 'PL05010102', name: '市场费用', category: '壹品慧费用', level: 3, parentCode: 'PL050101' },
    { code: 'PL050102', name: '非付现运营费用', category: '壹品慧费用', level: 2, parentCode: 'PL0501' },
    { code: 'PL05010201', name: '折旧摊销', category: '壹品慧费用', level: 3, parentCode: 'PL050102' },
    { code: 'PL0502', name: '财务费用', category: '壹品慧费用', level: 1, parentCode: 'PL05' },
  ]
}

describe('ExpenseAnalysisService 运营费用映射', () => {
  describe('isValidMappingCode 编码规范校验', () => {
    it('科目编码（PL_ 前缀数字，一对一映射）通过', () => {
      expect(isValidMappingCode('PL05010101')).toBe(true)
      expect(isValidMappingCode('PL05010118')).toBe(true)
    })
    it('EXP_ 前缀小写英文（归并/自定义映射）通过', () => {
      expect(isValidMappingCode('EXP_rd_expense')).toBe(true)
      expect(isValidMappingCode('EXP_a')).toBe(true)
      expect(isValidMappingCode('EXP_rd2')).toBe(true)
    })
    it('EXP_ 前缀数字序号（统一自动编码）通过', () => {
      expect(isValidMappingCode('EXP_001')).toBe(true)
      expect(isValidMappingCode('EXP_022')).toBe(true)
      expect(isValidMappingCode('EXP_1')).toBe(true)
    })
    it('自由文本/大小写/特殊字符拒绝', () => {
      expect(isValidMappingCode('cost001')).toBe(false)
      expect(isValidMappingCode('EXP_研发费用')).toBe(false)
      expect(isValidMappingCode('exp_rd')).toBe(false)
      expect(isValidMappingCode('EXP_RD')).toBe(false)
      expect(isValidMappingCode('EXP_-x')).toBe(false)
      expect(isValidMappingCode('')).toBe(false)
      expect(isValidMappingCode('PL_x')).toBe(false)
    })
  })

  describe('expenseCandidates 候选科目定位', () => {
    it('按运营费用直接子节点分组收集叶子，财务费用独立成组', () => {
      const groups = expenseCandidates(feeTree())
      expect(groups.map((g) => g.group)).toEqual(['付现运营费用', '非付现运营费用', '财务费用'])
      expect(groups[0].items.map((i) => i.name)).toEqual(['人力成本', '市场费用'])
      expect(groups[1].items).toEqual([{ code: 'PL05010201', name: '折旧摊销' }])
      expect(groups[2].items).toEqual([{ code: 'PL0502', name: '财务费用' }])
    })

    it('科目树缺失运营费用节点时返回空数组（不崩溃）', () => {
      expect(expenseCandidates([])).toEqual([])
      expect(expenseCandidates([{ code: 'A', name: '其他', category: '壹品慧收入', level: 0, parentCode: null }])).toEqual([])
    })

    it('非费用类别科目不影响候选定位（按 category 过滤）', () => {
      const subjects = [...feeTree(), { code: 'PL02', name: '壹品慧收入', category: '壹品慧收入', level: 0, parentCode: null }]
      expect(expenseCandidates(subjects).length).toBe(3)
    })
  })

  describe('expenseMappingHealth 映射健康判定', () => {
    const candidates = expenseCandidates(feeTree())

    it('matchedSubjects 仅含候选集内的科目名，顺序与映射一致', () => {
      const mappings: MappingRow[] = [
        { code: 'labor', name: '人力成本', subjectCodes: ['PL05010101', 'PL05010102'], sortOrder: 1, status: 'active' },
      ]
      const { matchedSubjects } = expenseMappingHealth(mappings, candidates)
      expect(matchedSubjects.get('labor')).toEqual(['人力成本', '市场费用'])
    })

    it('uncoveredSubjects = 候选未被任何 active 映射引用；失效编码列入 brokenCodes', () => {
      const mappings: MappingRow[] = [
        { code: 'labor', name: '人力成本', subjectCodes: ['PL05010101', 'GONE'], sortOrder: 1, status: 'active' },
      ]
      const { uncoveredSubjects, brokenCodes } = expenseMappingHealth(mappings, candidates)
      // 仅"人力成本"被引用，其余候选（市场费用/折旧摊销/财务费用）未配置
      expect(uncoveredSubjects).toEqual(['市场费用', '折旧摊销', '财务费用'])
      expect(brokenCodes).toEqual(['GONE'])
    })

    it('inactive 映射不视为已覆盖（候选仍提示未配置），但其失效编码仍上报', () => {
      const mappings: MappingRow[] = [
        { code: 'labor', name: '人力成本', subjectCodes: ['PL05010101', 'GONE'], sortOrder: 1, status: 'inactive' },
      ]
      const { uncoveredSubjects, brokenCodes, matchedSubjects } = expenseMappingHealth(mappings, candidates)
      expect(uncoveredSubjects).toContain('人力成本')
      expect(brokenCodes).toEqual(['GONE'])
      expect(matchedSubjects.get('labor')).toEqual(['人力成本'])
    })
  })

  describe('nextExpenseMappingCode 统一编码序号生成', () => {
    const row = (code: string, deletedAt: Date | null = null) => ({ code, deletedAt })

    it('空表返回 EXP_001', () => {
      expect(nextExpenseMappingCode([])).toBe('EXP_001')
    })

    it('取最大数字序号 +1（含零填充）', () => {
      const rows = [row('EXP_001'), row('EXP_002'), row('EXP_022')]
      expect(nextExpenseMappingCode(rows)).toBe('EXP_023')
    })

    it('墓碑行序号不复用（含已删除编码跳过）', () => {
      const rows = [row('EXP_001'), row('EXP_002'), row('EXP_003', new Date())]
      expect(nextExpenseMappingCode(rows)).toBe('EXP_004')
    })

    it('非数字 EXP_ 编码与科目编码不参与序号计算', () => {
      const rows = [row('EXP_rd_expense'), row('PL05010101'), row('EXP_001')]
      expect(nextExpenseMappingCode(rows)).toBe('EXP_002')
    })

    it('超 999 自然扩位', () => {
      expect(nextExpenseMappingCode([row('EXP_999')])).toBe('EXP_1000')
    })
  })

  describe('buildLegacyMappingMigration 旧格式迁移计划', () => {
    const row = (code: string, sortOrder: number, extra: Partial<Parameters<typeof buildLegacyMappingMigration>[0][number]> = {}) => ({
      id: `id-${code}`,
      code,
      name: `名称-${code}`,
      subjectCodes: [code],
      sortOrder,
      status: 'active' as const,
      deletedAt: null as Date | null,
      ...extra,
    })

    it('旧 PL 编码映射按 sortOrder 升序编号 EXP_001 起', () => {
      const plan = buildLegacyMappingMigration([row('PL05010102', 2), row('PL05010101', 1)])
      expect(plan.map((p) => p.targetCode)).toEqual(['EXP_001', 'EXP_002'])
      expect(plan[0].legacy.code).toBe('PL05010101')
      expect(plan[0].legacy.sortOrder).toBe(1)
    })

    it('归并/停用状态保留（subjectCodes 多科目、status inactive）', () => {
      const plan = buildLegacyMappingMigration([
        row('PL05010101', 1, { subjectCodes: ['PL05010101', 'PL05010102'], status: 'inactive' }),
      ])
      expect(plan).toHaveLength(1)
      expect(plan[0].legacy.subjectCodes).toEqual(['PL05010101', 'PL05010102'])
      expect(plan[0].legacy.status).toBe('inactive')
    })

    it('墓碑行 / EXP_ 自定义 / 非费用科目编码不参与迁移', () => {
      const plan = buildLegacyMappingMigration([
        row('PL05010101', 1, { deletedAt: new Date() }),
        row('EXP_rd_expense', 2),
        row('PL02', 3),
      ])
      expect(plan).toHaveLength(1)
      expect(plan[0].legacy.code).toBe('PL02')
    })

    it('无旧格式行返回空计划', () => {
      expect(buildLegacyMappingMigration([])).toEqual([])
      expect(buildLegacyMappingMigration([row('EXP_001', 1)])).toEqual([])
    })
  })

  describe('create 无 code 自动生成统一编码（真实 DB）', () => {
    it('不传 code 时自动生成 EXP_ 数字序号并创建成功', async () => {
      if (!dbReady) return
      let createdId = ''
      try {
        const created = await ExpenseAnalysisService.create(
          { name: '__TEST_AUTO_CODE__', subjectCodes: ['PL_TEST_SUBJECT'] },
          ctx,
        )
        createdId = created.id
        expect(created.code).toMatch(/^EXP_\d+$/)
        expect(created.name).toBe('__TEST_AUTO_CODE__')
        // 连续两次自动生成不重复
        const created2 = await ExpenseAnalysisService.create(
          { name: '__TEST_AUTO_CODE_2__', subjectCodes: ['PL_TEST_SUBJECT'] },
          ctx,
        )
        await basePrisma.expenseSubjectMapping.delete({ where: { id: created2.id } })
        expect(created2.code).not.toBe(created.code)
        expect(created2.code).toMatch(/^EXP_\d+$/)
      } finally {
        if (createdId) await basePrisma.expenseSubjectMapping.delete({ where: { id: createdId } }).catch(() => undefined)
      }
    })
  })
})
