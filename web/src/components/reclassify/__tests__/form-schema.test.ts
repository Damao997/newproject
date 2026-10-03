import { describe, expect, it } from 'vitest'
import { budgetFormSchema, companyFormSchema, subjectFormSchema } from '../form-schema'
const company = { selectedSubjects: [], period: '2026-09', amountInput: '', ratioInput: '', transferMode: 'all' as const, targetCompanyCode: 'EN330002', sourceCompanyCode: 'EN330001', templateType: 'operating' }
const adjustment = { companyCode: 'EN330001', adjustMode: 'both' as const, sourceAccountCode: 'A', targetAccountCode: 'B', decreaseInput: '3', increaseInput: '4', reason: '' }
const subject = subjectFormSchema((code) => code.startsWith('Q'))
describe('重分类条件字段与单位', () => {
  it('整批迁移无需金额，比例迁移要求非空且大于零不超过百分之百', () => {
    expect(companyFormSchema.safeParse(company).success).toBe(true)
    for (const ratioInput of ['', '0', '101', 'NaN']) {
      const result = companyFormSchema.safeParse({ ...company, transferMode: 'ratio', ratioInput })
      expect(result.success).toBe(false)
      if (!result.success) expect(result.error.issues.some((issue) => issue.path[0] === 'ratioInput')).toBe(true)
    }
    expect(companyFormSchema.safeParse({ ...company, transferMode: 'ratio', ratioInput: '25.5' }).success).toBe(true)
  })
  it('金额迁移区分留空与零，均不能作为正数调整', () => {
    for (const amountInput of ['', '0', '-1']) expect(companyFormSchema.safeParse({ ...company, transferMode: 'amount', amountInput }).success).toBe(false)
    expect(companyFormSchema.safeParse({ ...company, transferMode: 'amount', amountInput: '0.01' }).success).toBe(true)
  })
  it('公司相同定位目标字段', () => {
    const result = companyFormSchema.safeParse({ ...company, targetCompanyCode: company.sourceCompanyCode })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0].path).toEqual(['targetCompanyCode'])
  })
  it('单侧调整无需隐藏侧输入；双侧调整要求两边科目', () => {
    expect(subject.safeParse({ ...adjustment, adjustMode: 'increase', sourceAccountCode: '', decreaseInput: '', period: '2026-09', templateType: 'operating' }).success).toBe(true)
    expect(subject.safeParse({ ...adjustment, targetAccountCode: '', period: '2026-09', templateType: 'operating' }).success).toBe(false)
  })
  it('数量要求整数、金额支持小数，双侧不得混合单位', () => {
    const base = { ...adjustment, period: '2026-09', templateType: 'operating' }
    expect(subject.safeParse({ ...base, decreaseInput: '1.2' }).success).toBe(true)
    expect(subject.safeParse({ ...base, sourceAccountCode: 'Q1', targetAccountCode: 'Q2', decreaseInput: '1.2' }).success).toBe(false)
    expect(subject.safeParse({ ...base, sourceAccountCode: 'Q1', targetAccountCode: 'B' }).success).toBe(false)
  })
  it('预算校验要求财年，预览阶段仍允许未填原因', () => {
    const budget = budgetFormSchema(() => false)
    expect(budget.safeParse({ ...adjustment, fiscalYear: '' }).success).toBe(false)
    expect(budget.safeParse({ ...adjustment, fiscalYear: 'FY2026' }).success).toBe(true)
  })
})
