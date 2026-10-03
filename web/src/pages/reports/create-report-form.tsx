import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { MonthPicker } from '@/components/ui/month-picker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogBody, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AppForm, FormInput, FormField, FormSection, FormError, useAppForm } from '@/components/forms/form'
import { useFormClose } from '@/components/forms/form-navigation'
import { usePermission } from '@/hooks/usePermission'
import { useCompanies, useAvailablePeriods, useReportTemplates, useCreateReport } from '@/hooks/api-queries'

const schema = z.object({
  title: z.string().trim().min(1, '请输入报告标题'),
  period: z.string().min(1, '请选择报告期间'),
  scopeType: z.enum(['company', 'summary']),
  scopeCode: z.string().min(1, '请选择报告主体'),
  templateCode: z.string(),
})
const defaults: z.infer<typeof schema> = { title: '', period: '', scopeType: 'company', scopeCode: '', templateCode: 'none' }

export function CreateReportDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (title: string) => void }) {
  const canCreate = usePermission().can('reports', 'create')
  const createReport = useCreateReport()
  const companies = useCompanies()
  const periods = useAvailablePeriods()
  const templates = useReportTemplates()
  const [error, setError] = useState<string | null>(null)
  const form = useAppForm(schema, { defaultValues: defaults })
  const { reset } = form
  const scopeType = form.watch('scopeType')
  const period = form.watch('period')
  const template = form.watch('templateCode')
  const options = useMemo(() => (companies.data ?? []).filter((company) => company.type === (scopeType === 'company' ? 'entity' : 'summary')), [companies.data, scopeType])
  const templateItems = templates.data?.items ?? []
  useEffect(() => { if (open) { reset(defaults); setError(null) } }, [open, reset])
  const pending = form.formState.isSubmitting || createReport.isPending
  const close = useFormClose({ dirty: form.formState.isDirty, busy: pending, onClose, enabled: open })
  const submit = async (values: z.infer<typeof schema>) => {
    if (!canCreate) return
    setError(null)
    try {
      await createReport.mutateAsync({ title: values.title.trim(), fiscalYear: values.period.slice(0, 4), period: values.period,
        companyScope: { type: values.scopeType, code: values.scopeCode }, templateCode: values.templateCode === 'none' ? undefined : values.templateCode })
      reset(values); onCreated(values.title.trim())
    } catch (cause) { setError(cause instanceof Error ? cause.message : '创建失败，请重试') }
  }
  return <><Dialog open={open} presentation="drawer" busy={pending} onOpenChange={(next) => { if (!next) close.requestClose() }}>
    <DialogContent><DialogHeader><DialogTitle>新建报告</DialogTitle></DialogHeader>
      <DialogBody><AppForm form={form} id="create-report-form" onSubmit={submit}>
        <FormError message={error || (companies.isError || periods.isError || templates.isError ? '选项加载失败，请关闭后重试' : null)} />
        <FormSection title="报告信息">
          <FormInput control={form.control} name="title" label="报告标题" required placeholder="如：2026 年 8 月经营分析报告" />
          <FormField control={form.control} name="period" label="报告期间" required hint={period ? `财年：${period.slice(0, 4)}` : undefined}>
            {(field) => <MonthPicker {...field} value={String(field.value)} onChange={field.onChange} availablePeriods={periods.data?.periods ?? []}
              allowedPeriods={periods.data?.periods ?? []} placeholder={periods.isLoading ? '正在加载期间' : '选择期间'} disabled={periods.isLoading} className="h-11 w-full" />}
          </FormField>
        </FormSection>
        <FormSection title="数据范围">
          <FormField control={form.control} name="scopeType" label="主体类型" required>{(field) =>
            <Select {...field} value={String(field.value)} onValueChange={(value) => { field.onChange(value); form.setValue('scopeCode', '', { shouldDirty: true, shouldValidate: form.formState.isSubmitted }) }}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="company">单体公司</SelectItem><SelectItem value="summary">汇总主体</SelectItem></SelectContent>
            </Select>}
          </FormField>
          <FormField control={form.control} name="scopeCode" label="报告主体" required>{(field) =>
            <Select {...field} value={String(field.value)} onValueChange={field.onChange} disabled={companies.isLoading}>
              <SelectTrigger className="h-11"><SelectValue placeholder={companies.isLoading ? '正在加载主体' : '选择主体'} /></SelectTrigger>
              <SelectContent>{options.length ? options.map((company) => <SelectItem key={company.code} value={company.code}><span>{company.name}<span className="ml-2 text-xs text-muted-foreground">{company.code}</span></span></SelectItem>)
                : <SelectItem value="__none" disabled>暂无可选主体</SelectItem>}</SelectContent>
            </Select>}
          </FormField>
        </FormSection>
        <FormSection title="模板">
          <FormField control={form.control} name="templateCode" label="报告模板" hint={templateItems.find((item) => item.code === template)?.description || '选填，可从空白报告开始'}>
            {(field) => <Select {...field} value={String(field.value)} onValueChange={field.onChange} disabled={templates.isLoading}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">空白报告</SelectItem>
                {templateItems.map((item) => <SelectItem key={item.code} value={item.code}>{item.name}（{item.sectionCount} 章{item.isSystem ? ' · 系统' : ''}）</SelectItem>)}</SelectContent>
            </Select>}
          </FormField>
        </FormSection>
      </AppForm></DialogBody>
      <DialogFooter><Button variant="outline" disabled={pending} onClick={close.requestClose}>取消</Button>
        <Button type="submit" form="create-report-form" disabled={!canCreate || pending || companies.isLoading || periods.isLoading || templates.isLoading} loading={pending}>创建报告</Button></DialogFooter>
    </DialogContent>
  </Dialog>{close.element}</>
}
