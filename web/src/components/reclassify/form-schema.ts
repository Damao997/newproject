import { z } from 'zod'
const nonempty = (message: string) => z.string().refine((value) => !!value.trim(), message)
export const companyFormSchema = z.object({
  selectedSubjects: z.array(z.string()), period: nonempty('请选择调整期间'),
  amountInput: z.string(), ratioInput: z.string(), transferMode: z.enum(['all', 'ratio', 'amount']),
  targetCompanyCode: nonempty('请选择目标公司'), sourceCompanyCode: nonempty('请选择源公司'), templateType: z.string(),
}).superRefine((value, context) => {
  if (value.sourceCompanyCode && value.sourceCompanyCode === value.targetCompanyCode) context.addIssue({ code: 'custom', path: ['targetCompanyCode'], message: '源公司与目标公司不能相同' })
  if (value.transferMode === 'ratio' && (!value.ratioInput.trim() || !Number.isFinite(Number(value.ratioInput)) || Number(value.ratioInput) <= 0 || Number(value.ratioInput) > 100)) context.addIssue({ code: 'custom', path: ['ratioInput'], message: '请输入大于 0 且不超过 100 的比例' })
  if (value.transferMode === 'amount' && (!value.amountInput.trim() || !Number.isFinite(Number(value.amountInput)) || Number(value.amountInput) <= 0)) context.addIssue({ code: 'custom', path: ['amountInput'], message: '请输入大于 0 的金额' })
})
const adjustmentFields = {
  reason: z.string(), increaseInput: z.string(), decreaseInput: z.string(),
  targetAccountCode: z.string(), sourceAccountCode: z.string(),
  adjustMode: z.enum(['both', 'decrease', 'increase']), companyCode: nonempty('请选择公司'),
}
type Adjustment = z.infer<z.ZodObject<typeof adjustmentFields>>
function validateAdjustment(quantity: (code: string) => boolean) {
  return (value: Adjustment, context: z.RefinementCtx) => {
    const side = (code: string, input: string, codeField: string, amountField: string, label: string) => {
      if (!code) context.addIssue({ code: 'custom', path: [codeField], message: '请选择' + label + '科目' })
      const number = Number(input)
      if (!input.trim() || !Number.isFinite(number) || number <= 0) context.addIssue({ code: 'custom', path: [amountField], message: '请输入大于 0 的' + label + '值' })
      else if (quantity(code) && !Number.isInteger(number)) context.addIssue({ code: 'custom', path: [amountField], message: '数量类科目须为整数' })
    }
    if (value.adjustMode !== 'increase') side(value.sourceAccountCode, value.decreaseInput, 'sourceAccountCode', 'decreaseInput', '调减')
    if (value.adjustMode !== 'decrease') side(value.targetAccountCode, value.increaseInput, 'targetAccountCode', 'increaseInput', '调增')
    if (value.adjustMode === 'both' && value.sourceAccountCode && value.sourceAccountCode === value.targetAccountCode) context.addIssue({ code: 'custom', path: ['targetAccountCode'], message: '源科目与目标科目不能相同' })
    if (value.adjustMode === 'both' && value.sourceAccountCode && value.targetAccountCode && quantity(value.sourceAccountCode) !== quantity(value.targetAccountCode)) context.addIssue({ code: 'custom', path: ['targetAccountCode'], message: '源科目与目标科目须使用相同单位' })
  }
}
export const subjectFormSchema = (quantity: (code: string) => boolean) => z.object({ ...adjustmentFields, period: nonempty('请选择调整期间'), templateType: z.string() }).superRefine(validateAdjustment(quantity))
export const budgetFormSchema = (quantity: (code: string) => boolean) => z.object({ ...adjustmentFields, fiscalYear: nonempty('请选择财年') }).superRefine(validateAdjustment(quantity))

export const consolidationFormSchema = z.object({
  templateType: z.enum(['operating', 'static', 'cashflow']), reason: nonempty('请填写调整原因'),
  amountInput: z.string().refine((value) => !!value.trim() && Number.isFinite(Number(value)) && Number(value) !== 0, '请输入非零的调整金额'),
  period: nonempty('请选择调整期间'), accountCode: nonempty('请选择科目'),
  selectedSummaries: z.array(z.string()).min(1, '请至少选择一个汇总主体'),
  singleA: nonempty('请选择单体公司 A'), singleB: nonempty('请选择单体公司 B'),
}).superRefine((value, context) => {
  if (value.singleA && value.singleA === value.singleB) context.addIssue({ code: 'custom', path: ['singleB'], message: '请选择不同的单体公司' })
})
