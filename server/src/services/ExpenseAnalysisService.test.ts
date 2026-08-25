import { describe, it, expect } from 'vitest'
import { expenseCandidates, expenseMappingHealth, isValidMappingCode } from './ExpenseAnalysisService'
import type { SubjectRow, MappingRow } from './ExpenseAnalysisService'

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
})
