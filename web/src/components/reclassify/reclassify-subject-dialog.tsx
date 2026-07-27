import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useCompanies, useSubjects, usePreviewAdjustSubject, useAdjustSubject } from '@/hooks/api-queries'
import { formatMoney, cn } from '@/lib/utils'
import { AlertTriangle, Search } from 'lucide-react'

interface ReclassifySubjectDialogProps {
  open: boolean
  onClose: () => void
  /** 预填模板类型（来自指标页当前标签） */
  defaultTemplateType?: 'operating' | 'static'
  /** 预填公司（来自指标页当前主体） */
  defaultCompany?: string
}

const TEMPLATE_LABEL: Record<string, string> = {
  operating: '经营数据',
  static: '静态数据',
  budget: '年度预算',
}

interface SubjectOption { code: string; name: string }

/** 科目搜索下拉：输入关键字过滤，单选 */
function SubjectPicker({ label, options, value, onChange, excludeCode, placeholder }: {
  label: string
  options: SubjectOption[]
  value: string
  onChange: (code: string) => void
  excludeCode?: string
  placeholder?: string
}) {
  const [keyword, setKeyword] = useState('')
  const [listOpen, setListOpen] = useState(false)
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    const items = options.filter((s) => s.code !== excludeCode)
    return kw ? items.filter((s) => s.name.toLowerCase().includes(kw) || s.code.toLowerCase().includes(kw)) : items
  }, [options, keyword, excludeCode])
  const selected = options.find((s) => s.code === value)

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <button
        type="button"
        className="flex h-9 w-full items-center justify-between rounded-md border bg-transparent px-3 py-1 text-left text-sm shadow-sm"
        onClick={() => setListOpen((v) => !v)}
      >
        {selected ? (
          <span className="truncate">
            <span className="font-mono text-xs text-muted-foreground">{selected.code}</span> {selected.name}
          </span>
        ) : (
          <span className="text-muted-foreground">{placeholder ?? '选择科目'}</span>
        )}
      </button>
      {listOpen && (
        <div className="space-y-2 rounded-md border p-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="搜索科目名称或编码..." value={keyword} onChange={(e) => setKeyword(e.target.value)} className="pl-8" />
          </div>
          <div className="max-h-[160px] space-y-1 overflow-y-auto">
            {filtered.map((s) => (
              <button
                key={s.code}
                type="button"
                className={cn('flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-muted', value === s.code && 'bg-muted')}
                onClick={() => { onChange(s.code); setListOpen(false) }}
              >
                <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
                <span>{s.name}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="py-2 text-center text-xs text-muted-foreground">无匹配科目</p>}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 同公司科目间调整对话框：把公司内源科目某期间的部分金额调减，
 * 可选调增到目标科目（调增额可与调减额不相等，公司总额随净差变化，需填写调整原因）。
 * 典型场景：修正某科目重复计算（只减不增）、科目口径迁移（等额调整）。
 */
export function ReclassifySubjectDialog({ open, onClose, defaultTemplateType = 'operating', defaultCompany }: ReclassifySubjectDialogProps) {
  const [templateType, setTemplateType] = useState<string>(defaultTemplateType)
  const [companyCode, setCompanyCode] = useState<string>(defaultCompany ?? '')
  const [sourceAccountCode, setSourceAccountCode] = useState('')
  const [targetAccountCode, setTargetAccountCode] = useState('')
  const [decreaseInput, setDecreaseInput] = useState('')
  const [increaseInput, setIncreaseInput] = useState('')
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<{ affectedRows: number; sourceTotal: number; decreaseAmount: number; increaseAmount: number; netChange: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const { confirm, element: confirmElement } = useConfirm()
  const { data: companies } = useCompanies()
  const entityCompanies = useMemo(() => (companies ?? []).filter((c) => c.type === 'entity'), [companies])

  // 科目候选：静态模板取静态科目，否则取经营科目
  const subjectType = templateType === 'static' ? 'static' : 'operating'
  const { data: subjectsData } = useSubjects({ type: subjectType, pageSize: 1000 })
  const subjectOptions = useMemo(() => subjectsData?.items ?? [], [subjectsData])

  const previewMutation = usePreviewAdjustSubject()
  const adjustMutation = useAdjustSubject()

  const buildPayload = () => ({
    templateType,
    companyCode,
    sourceAccountCode,
    targetAccountCode: targetAccountCode || undefined,
    decreaseAmount: Number(decreaseInput),
    increaseAmount: increaseInput !== '' ? Number(increaseInput) : undefined,
    periodFrom: periodFrom || undefined,
    periodTo: periodTo || undefined,
    reason: reason.trim(),
  })

  const reset = () => {
    setPreview(null)
    setError(null)
    setDone(null)
  }

  const validateInput = (): string | null => {
    if (!companyCode) return '请选择公司'
    if (!sourceAccountCode) return '请选择源科目'
    const dec = Number(decreaseInput)
    if (!decreaseInput || !Number.isFinite(dec) || dec <= 0) return '请输入大于 0 的调减金额'
    if (increaseInput !== '') {
      const inc = Number(increaseInput)
      if (!Number.isFinite(inc) || inc < 0) return '调增金额必须大于等于 0'
      if (inc > 0 && !targetAccountCode) return '调增金额大于 0 时必须选择目标科目'
    }
    if (targetAccountCode && targetAccountCode === sourceAccountCode) return '源科目与目标科目不能相同'
    return null
  }

  const handlePreview = async () => {
    setError(null)
    setDone(null)
    setPreview(null)
    const inputError = validateInput()
    if (inputError) {
      setError(inputError)
      return
    }
    try {
      const res = await previewMutation.mutateAsync(buildPayload())
      setPreview(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : '预览失败')
    }
  }

  const handleSubmit = async () => {
    if (!preview || preview.affectedRows === 0) return
    if (!reason.trim()) {
      setError('请填写调整原因')
      return
    }
    const companyName = entityCompanies.find((c) => c.code === companyCode)?.name ?? companyCode
    const sourceName = subjectOptions.find((s) => s.code === sourceAccountCode)?.name ?? sourceAccountCode
    const targetName = targetAccountCode ? (subjectOptions.find((s) => s.code === targetAccountCode)?.name ?? targetAccountCode) : ''
    const netText = preview.netChange !== 0 ? `，公司总额将净变动 ${formatMoney(preview.netChange)}` : '，公司总额不变'
    const ok = await confirm({
      title: '确认科目间调整',
      description: `将把「${companyName}」的${TEMPLATE_LABEL[templateType]}中「${sourceName}」调减 ${formatMoney(preview.decreaseAmount)}${targetName && preview.increaseAmount > 0 ? `，「${targetName}」调增 ${formatMoney(preview.increaseAmount)}` : ''}${netText}。此操作将影响看板与指标且不可撤销，确认继续？`,
      danger: true,
      confirmText: '确认调整',
    })
    if (!ok) return
    setError(null)
    try {
      const res = await adjustMutation.mutateAsync(buildPayload())
      setDone(`调整完成：调减 ${formatMoney(res.decreaseAmount)}${res.increaseAmount > 0 ? `，调增 ${formatMoney(res.increaseAmount)}` : ''}，涉及 ${res.affectedRows} 条明细${res.createdRows > 0 ? `，新建 ${res.createdRows} 条` : ''}。`)
      setPreview(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '调整失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>科目间金额调整</DialogTitle>
          <DialogDescription>同一公司内源科目调减、目标科目调增，两者金额可不相等（如修正重复计算时只减不增）。</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>模板类型</Label>
              <Select value={templateType} onValueChange={(v) => { setTemplateType(v); reset(); setSourceAccountCode(''); setTargetAccountCode('') }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="operating">经营数据</SelectItem>
                  <SelectItem value="static">静态数据</SelectItem>
                  <SelectItem value="budget">年度预算</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>公司</Label>
              <Select value={companyCode} onValueChange={(v) => { setCompanyCode(v); reset() }}>
                <SelectTrigger><SelectValue placeholder="选择公司" /></SelectTrigger>
                <SelectContent className="max-h-[280px]">
                  {entityCompanies.map((c) => (
                    <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <SubjectPicker
            label="源科目（调减）"
            options={subjectOptions}
            value={sourceAccountCode}
            onChange={(code) => { setSourceAccountCode(code); reset() }}
            placeholder="选择要调减的科目"
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>调减金额（元）</Label>
              <Input type="number" min={0} step="0.01" placeholder="如 50000" value={decreaseInput} onChange={(e) => { setDecreaseInput(e.target.value); reset() }} />
            </div>
            <div className="space-y-1">
              <Label>调增金额（元，可选）</Label>
              <Input type="number" min={0} step="0.01" placeholder="留空即仅调减" value={increaseInput} onChange={(e) => { setIncreaseInput(e.target.value); reset() }} />
            </div>
          </div>

          <SubjectPicker
            label="目标科目（调增，可选）"
            options={subjectOptions}
            value={targetAccountCode}
            onChange={(code) => { setTargetAccountCode(code); reset() }}
            excludeCode={sourceAccountCode}
            placeholder="留空即仅调减源科目"
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>期间起（可选）</Label>
              <Input type="month" value={periodFrom} onChange={(e) => { setPeriodFrom(e.target.value); reset() }} />
            </div>
            <div className="space-y-1">
              <Label>期间止（可选）</Label>
              <Input type="month" value={periodTo} onChange={(e) => { setPeriodTo(e.target.value); reset() }} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>调整原因（必填）</Label>
            <Textarea rows={2} placeholder="如：××科目 5 月数据重复计算，调减重复部分" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>

          {preview && (
            <div className={cn('rounded-lg border p-3 text-sm', preview.affectedRows === 0 ? 'border-muted bg-muted/30' : 'border-blue-200 bg-blue-50')}>
              {preview.affectedRows === 0 ? (
                <p className="text-muted-foreground">当前筛选条件下没有可调整的数据。</p>
              ) : (
                <div className="space-y-1">
                  <p className="text-blue-800">
                    源科目匹配 <span className="font-semibold">{preview.affectedRows}</span> 条明细（合计{' '}
                    <span className="font-mono font-semibold">{formatMoney(preview.sourceTotal)}</span>），将调减{' '}
                    <span className="font-mono font-semibold">{formatMoney(preview.decreaseAmount)}</span>
                    {preview.increaseAmount > 0 && (
                      <>，目标科目调增 <span className="font-mono font-semibold">{formatMoney(preview.increaseAmount)}</span></>
                    )}
                    。
                  </p>
                  {preview.netChange !== 0 && (
                    <p className="flex items-center gap-1 text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      本次调整将使公司总额净变动 {formatMoney(preview.netChange)}。
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {done && <p className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">{done}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>关闭</Button>
          <Button variant="outline" onClick={handlePreview} disabled={previewMutation.isPending || !companyCode || !sourceAccountCode || !decreaseInput}>
            {previewMutation.isPending ? '预览中...' : '预览影响'}
          </Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={!preview || preview.affectedRows === 0 || !reason.trim() || adjustMutation.isPending}>
            {adjustMutation.isPending ? '调整中...' : '执行调整'}
          </Button>
        </DialogFooter>
        {confirmElement}
      </DialogContent>
    </Dialog>
  )
}
