import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { MonthPicker } from '@/components/ui/month-picker'
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
import {
  useCompanies,
  useSubjects,
  useAvailablePeriods,
  usePreviewAdjustSubject,
  useAdjustSubject,
} from '@/hooks/api-queries'
import { formatMoney, cn } from '@/lib/utils'
import { Equal, MinusCircle, PlusCircle } from 'lucide-react'
import { TEMPLATE_LABEL, FeedbackAlert, PreviewStats, SubjectPicker, SectionTitle, type PreviewStatItem } from './shared'

interface ReclassifySubjectDialogProps {
  open: boolean
  onClose: () => void
  /** 预填模板类型（来自指标页当前标签） */
  defaultTemplateType?: 'operating' | 'static'
  /** 预填公司（来自指标页当前主体） */
  defaultCompany?: string
}

interface PreviewData {
  affectedRows: number
  sourceTotal: number
  decreaseAmount: number
  increaseAmount: number
  netChange: number
}

/**
 * 同公司科目间调整对话框：调减侧/调增侧对称双栏布局，输入即实时显示净变动。
 * 调增侧整体可留空表示纯调减（如修正重复计算）；调增额可与调减额不相等，公司总额随净差变化，
 * 因此调整原因必填留痕。期间选择使用与数据浏览模块一致的 MonthPicker（全平台统一）。
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
  const [reasonTouched, setReasonTouched] = useState(false)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const { confirm, element: confirmElement } = useConfirm()
  const { data: companies } = useCompanies()
  const { data: availablePeriods } = useAvailablePeriods()
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

  // ---- 字段级校验与本地实时净变动 ----
  const periodError = periodFrom && periodTo && periodTo < periodFrom ? '期间止不能早于期间起' : null
  const decreaseError = (() => {
    if (decreaseInput === '') return null
    const dec = Number(decreaseInput)
    return !Number.isFinite(dec) || dec <= 0 ? '调减金额须大于 0' : null
  })()
  const increaseError = (() => {
    if (increaseInput === '') return null
    const inc = Number(increaseInput)
    if (!Number.isFinite(inc) || inc < 0) return '调增金额须大于等于 0'
    if (inc > 0 && !targetAccountCode) return '调增金额大于 0 时须选择目标科目'
    return null
  })()
  const reasonError = reasonTouched && !reason.trim() ? '请填写调整原因' : null

  const decValue = decreaseError || decreaseInput === '' ? 0 : Number(decreaseInput)
  const incValue = increaseError || increaseInput === '' ? 0 : Number(increaseInput)
  const localNet = Math.round((incValue - decValue) * 100) / 100
  const isPureDecrease = increaseInput === '' && !targetAccountCode

  const validateBeforePreview = (): string | null => {
    if (!companyCode) return '请选择公司'
    if (!sourceAccountCode) return '请选择源科目'
    if (decreaseInput === '' || decreaseError) return decreaseError ?? '请输入调减金额'
    if (increaseError) return increaseError
    if (targetAccountCode && targetAccountCode === sourceAccountCode) return '源科目与目标科目不能相同'
    if (periodError) return periodError
    return null
  }

  const handlePreview = async () => {
    reset()
    const invalid = validateBeforePreview()
    if (invalid) {
      setError(invalid)
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
      setReasonTouched(true)
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

  const previewItems: PreviewStatItem[] = preview
    ? [
        { label: '源科目匹配', value: `${preview.affectedRows} 条` },
        { label: '源科目合计', value: formatMoney(preview.sourceTotal) },
        { label: '调减金额', value: `-${formatMoney(preview.decreaseAmount)}`, tone: 'primary' },
        ...(preview.increaseAmount > 0 ? [{ label: '调增金额', value: `+${formatMoney(preview.increaseAmount)}`, tone: 'primary' as const }] : []),
        { label: '净变动', value: formatMoney(preview.netChange), tone: preview.netChange !== 0 ? 'warning' : 'default' },
      ]
    : []

  const submitDisabledReason = !preview
    ? '请先预览影响'
    : preview.affectedRows === 0
      ? '当前条件下无可调整数据'
      : !reason.trim()
        ? '请填写调整原因'
        : null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>科目间金额调整</DialogTitle>
          <DialogDescription>同一公司内源科目调减、目标科目调增，两者金额可不相等（如修正重复计算时只减不增）。</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* ===== 数据范围 ===== */}
          <section className="space-y-2">
            <SectionTitle>数据范围</SectionTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <div className="space-y-1">
                <Label>期间起（可选）</Label>
                <MonthPicker className={cn('w-full', periodError && 'border-destructive')} value={periodFrom} onChange={(v) => { setPeriodFrom(v); reset() }} availablePeriods={availablePeriods ?? []} placeholder="不限" />
              </div>
              <div className="space-y-1">
                <Label>期间止（可选）</Label>
                <MonthPicker className={cn('w-full', periodError && 'border-destructive')} value={periodTo} onChange={(v) => { setPeriodTo(v); reset() }} availablePeriods={availablePeriods ?? []} placeholder="不限" />
              </div>
            </div>
            {periodError && <p className="text-xs text-destructive">{periodError}</p>}
          </section>

          {/* ===== 调整设置：调减侧 / 调增侧 对称双栏 ===== */}
          <section className="space-y-2">
            <SectionTitle>调整设置</SectionTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {/* 调减侧 */}
              <div className="space-y-2 rounded-lg border border-red-200 bg-red-50/40 p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium text-red-700">
                  <MinusCircle className="h-4 w-4" />
                  调减侧（源科目）
                </p>
                <div className="space-y-1">
                  <Label>源科目 <span className="text-destructive">*</span></Label>
                  <SubjectPicker
                    options={subjectOptions}
                    value={sourceAccountCode}
                    onChange={(code) => { setSourceAccountCode(code); reset() }}
                    placeholder="选择要调减的科目"
                  />
                </div>
                <div className="space-y-1">
                  <Label>调减金额（元） <span className="text-destructive">*</span></Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="如 50000"
                    value={decreaseInput}
                    aria-invalid={!!decreaseError}
                    className={cn('bg-background', decreaseError && 'border-destructive focus-visible:ring-destructive')}
                    onChange={(e) => { setDecreaseInput(e.target.value); reset() }}
                  />
                  {decreaseError && <p className="text-xs text-destructive">{decreaseError}</p>}
                </div>
              </div>

              {/* 调增侧（可整体留空 = 纯调减） */}
              <div className={cn('space-y-2 rounded-lg border border-green-200 bg-green-50/40 p-3 transition-opacity', isPureDecrease && 'opacity-70')}>
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-green-700">
                    <PlusCircle className="h-4 w-4" />
                    调增侧（可选）
                  </p>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-primary transition-colors hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-40"
                    title="将调增金额设为与调减金额相等"
                    disabled={decreaseInput === '' || !!decreaseError}
                    onClick={() => { setIncreaseInput(decreaseInput); reset() }}
                  >
                    <Equal className="h-3 w-3" />
                    等额调整
                  </button>
                </div>
                <div className="space-y-1">
                  <Label>目标科目</Label>
                  <SubjectPicker
                    options={subjectOptions}
                    value={targetAccountCode}
                    onChange={(code) => { setTargetAccountCode(code); reset() }}
                    excludeCode={sourceAccountCode}
                    placeholder="留空即仅调减"
                  />
                </div>
                <div className="space-y-1">
                  <Label>调增金额（元）</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="留空即仅调减"
                    value={increaseInput}
                    aria-invalid={!!increaseError}
                    className={cn('bg-background', increaseError && 'border-destructive focus-visible:ring-destructive')}
                    onChange={(e) => { setIncreaseInput(e.target.value); reset() }}
                  />
                  {increaseError && <p className="text-xs text-destructive">{increaseError}</p>}
                </div>
              </div>
            </div>

            {/* 实时净变动提示（无需等预览） */}
            {decValue > 0 && (
              <div
                className={cn(
                  'rounded-md border p-2.5 text-sm',
                  localNet !== 0 ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-muted bg-muted/30 text-muted-foreground',
                )}
              >
                {localNet !== 0
                  ? <>本次调整将使公司总额净变动 <span className="font-num font-semibold">{formatMoney(localNet)}</span>{isPureDecrease && '（仅调减）'}。</>
                  : <>调减与调增等额，公司总额不变。</>}
              </div>
            )}
          </section>

          {/* ===== 调整原因 ===== */}
          <section className="space-y-1">
            <Label>调整原因 <span className="text-destructive">*</span></Label>
            <Textarea
              rows={2}
              placeholder="如：××科目 5 月数据重复计算，调减重复部分"
              value={reason}
              aria-invalid={!!reasonError}
              className={cn(reasonError && 'border-destructive focus-visible:ring-destructive')}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setReasonTouched(true)}
            />
            {reasonError && <p className="text-xs text-destructive">{reasonError}</p>}
          </section>

          {/* ===== 预览与执行 ===== */}
          <section className="space-y-2">
            <SectionTitle>预览与执行</SectionTitle>
            {!preview && !done && !error && (
              <p className="text-xs text-muted-foreground">设置完成后点击「预览影响」查看源科目匹配情况与金额变化。</p>
            )}
            {preview && (preview.affectedRows === 0
              ? <PreviewStats items={[]} empty />
              : <PreviewStats
                  items={previewItems}
                  warning={preview.netChange !== 0 ? <>本次调整将使公司总额净变动 <span className="font-num font-semibold">{formatMoney(preview.netChange)}</span>，请确认业务依据。</> : undefined}
                />)}
            {done && <FeedbackAlert kind="success">{done}</FeedbackAlert>}
            {error && <FeedbackAlert kind="error">{error}</FeedbackAlert>}
          </section>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <div className="flex flex-1 items-center">
            {submitDisabledReason && <span className="text-xs text-muted-foreground">{submitDisabledReason}</span>}
          </div>
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
