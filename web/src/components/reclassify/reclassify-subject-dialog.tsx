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
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { formatMoney, formatQuantity, cn } from '@/lib/utils'
import { Equal, MinusCircle, PlusCircle } from 'lucide-react'
import { TEMPLATE_LABEL, FeedbackAlert, PreviewStats, SubjectPicker, SectionTitle, ReadonlyLogMeta, TitleHint, type ReclassifyLogMeta, type PreviewStatItem } from './shared'

interface ReclassifySubjectDialogProps {
  open: boolean
  onClose: () => void
  /** 预填模板类型（来自指标页当前标签） */
  defaultTemplateType?: 'operating' | 'static'
  /** 预填公司（来自指标页当前主体） */
  defaultCompany?: string
  /** 完整预填参数（来自失效/已撤销日志的「重新应用」或只读查看）：父级以 key 强制重挂载使其生效 */
  preset?: ReclassifySubjectPreset
  /** 只读查看模式：预填 preset 展示原始操作参数，禁止修改与提交（不触发任何写接口） */
  readonly?: boolean
  /** 只读模式下展示的日志元信息（操作人/时间/状态） */
  meta?: ReclassifyLogMeta
  /** 只读模式下还原的当时执行结果统计（来自日志 detail，如调减/调增金额、净变动、新建行数） */
  result?: PreviewStatItem[]
}

export interface ReclassifySubjectPreset {
  templateType: 'operating' | 'static' | 'budget'
  companyCode: string
  adjustMode: AdjustMode
  sourceAccountCode?: string | null
  targetAccountCode?: string | null
  decreaseAmount?: number
  increaseAmount?: number
  period: string
  reason?: string
}

interface PreviewData {
  affectedRows: number
  sourceTotal: number
  targetTotal?: number
  decreaseAmount: number
  increaseAmount: number
  netChange: number
  valueType?: 'amount' | 'quantity' | 'ratio'
}

type AdjustMode = 'both' | 'decrease' | 'increase'

const ADJUST_MODE_LABEL: Record<AdjustMode, string> = {
  both: '双向调整（调减+调增）',
  decrease: '仅调减源科目',
  increase: '仅调增目标科目',
}

/**
 * 同公司科目间调整对话框：支持三种调整方式（双向/仅调减/仅调增），
 * 调减侧与调增侧按方式按需展示，输入即实时显示净变动。
 * 调增与调减金额可不相等，公司总额随净差变化，因此调整原因必填留痕。
 * 金额单位与事实数据一致（万元）。期间按单月必选（与后端口径一致）；
 * 本年累计由查询时按财年实时聚合，自动反映调整结果。
 */
export function ReclassifySubjectDialog({ open, onClose, defaultTemplateType = 'operating', defaultCompany, preset, readonly = false, meta, result }: ReclassifySubjectDialogProps) {
  const [templateType, setTemplateType] = useState<string>(preset?.templateType ?? defaultTemplateType)
  const [companyCode, setCompanyCode] = useState<string>(preset?.companyCode ?? defaultCompany ?? '')
  const [adjustMode, setAdjustMode] = useState<AdjustMode>(preset?.adjustMode ?? 'both')
  const [sourceAccountCode, setSourceAccountCode] = useState(preset?.sourceAccountCode ?? '')
  const [targetAccountCode, setTargetAccountCode] = useState(preset?.targetAccountCode ?? '')
  const [decreaseInput, setDecreaseInput] = useState(() => (preset?.decreaseAmount != null ? String(preset.decreaseAmount) : ''))
  const [increaseInput, setIncreaseInput] = useState(() => (preset?.increaseAmount != null ? String(preset.increaseAmount) : ''))
  const [period, setPeriod] = useState(preset?.period ?? '')
  const [reason, setReason] = useState(preset?.reason ?? '')
  const [reasonTouched, setReasonTouched] = useState(false)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const { confirm, element: confirmElement } = useConfirm()
  const { data: companies } = useCompanies()
  const { data: periodsData } = useAvailablePeriods()
  const availablePeriods = periodsData?.periods ?? []
  const entityCompanies = useMemo(() => (companies ?? []).filter((c) => c.type === 'entity'), [companies])
  // 下拉选项跟随「显示简称」开关；确认弹窗文案仍用全称，保证高危操作确认的严谨性
  const { displayNameMap } = useCompanyDisplayName()

  // 科目候选：静态模板取静态科目，否则取经营科目；比率类（公式计算）与 calc/display 类不可直接调整，从候选中排除
  const subjectType = templateType === 'static' ? 'static' : 'operating'
  const { data: subjectsData } = useSubjects({ type: subjectType, pageSize: 1000 })
  const subjectOptions = useMemo(
    () => (subjectsData?.items ?? []).filter((s) => s.valueType !== 'ratio' && s.dataType !== 'calc' && s.dataType !== 'display'),
    [subjectsData],
  )

  // 已选科目的值类型：驱动单位文案/整数校验/分型格式化；both 模式源目标必须同型（候选互斥过滤）
  const sourceVt = subjectOptions.find((s) => s.code === sourceAccountCode)?.valueType ?? null
  const targetVt = subjectOptions.find((s) => s.code === targetAccountCode)?.valueType ?? null
  const decSideQty = sourceVt === 'quantity'
  const incSideQty = (adjustMode === 'both' ? (sourceVt ?? targetVt) : targetVt) === 'quantity'
  // both 模式：已选一侧后，另一侧候选仅保留同值类型科目
  const sourceOptions = useMemo(
    () => (adjustMode === 'both' && targetVt ? subjectOptions.filter((s) => (s.valueType ?? 'amount') === targetVt) : subjectOptions),
    [subjectOptions, adjustMode, targetVt],
  )
  const targetOptions = useMemo(
    () => (adjustMode === 'both' && sourceVt ? subjectOptions.filter((s) => (s.valueType ?? 'amount') === sourceVt) : subjectOptions),
    [subjectOptions, adjustMode, sourceVt],
  )
  /** 分型格式化：数量整数（无“万”），金额万元 */
  const fmt = (v: number, qty: boolean) => (qty ? formatQuantity(v) : formatMoney(v))

  const previewMutation = usePreviewAdjustSubject()
  const adjustMutation = useAdjustSubject()

  const buildPayload = () => ({
    templateType,
    companyCode,
    adjustMode,
    sourceAccountCode: adjustMode !== 'increase' ? sourceAccountCode : undefined,
    targetAccountCode: adjustMode !== 'decrease' ? (targetAccountCode || undefined) : undefined,
    decreaseAmount: adjustMode !== 'increase' ? Number(decreaseInput) : undefined,
    increaseAmount: adjustMode !== 'decrease' && increaseInput !== '' ? Number(increaseInput) : undefined,
    period,
    reason: reason.trim(),
  })

  const reset = () => {
    setPreview(null)
    setError(null)
    setDone(null)
  }

  /** 切换调整方式：清空被隐藏侧的输入，避免残留值误提交 */
  const handleModeChange = (v: AdjustMode) => {
    setAdjustMode(v)
    reset()
    if (v === 'decrease') {
      setTargetAccountCode('')
      setIncreaseInput('')
    }
    if (v === 'increase') {
      setSourceAccountCode('')
      setDecreaseInput('')
    }
  }

  // ---- 字段级校验与本地实时净变动（数量类科目要求正整数）----
  const decreaseError = (() => {
    if (adjustMode === 'increase' || decreaseInput === '') return null
    const dec = Number(decreaseInput)
    if (!Number.isFinite(dec) || dec <= 0) return '调减金额须大于 0'
    if (decSideQty && !Number.isInteger(dec)) return '数量类科目须为整数'
    return null
  })()
  const increaseError = (() => {
    if (adjustMode === 'decrease' || increaseInput === '') return null
    const inc = Number(increaseInput)
    if (!Number.isFinite(inc) || inc <= 0) return '调增金额须大于 0'
    if (incSideQty && !Number.isInteger(inc)) return '数量类科目须为整数'
    return null
  })()
  const reasonError = reasonTouched && !reason.trim() ? '请填写调整原因' : null

  const decValue = adjustMode === 'increase' || decreaseError || decreaseInput === '' ? 0 : Number(decreaseInput)
  const incValue = adjustMode === 'decrease' || increaseError || increaseInput === '' ? 0 : Number(increaseInput)
  const localNet = Math.round((incValue - decValue) * 100) / 100
  // 当前调整口径是否为数量类（increase 模式看目标侧，其余看源侧），驱动全局分型格式化
  const activeQty = adjustMode === 'increase' ? incSideQty : decSideQty

  const validateBeforePreview = (): string | null => {
    if (!companyCode) return '请选择公司'
    if (adjustMode !== 'increase') {
      if (!sourceAccountCode) return '请选择源科目'
      if (decreaseInput === '' || decreaseError) return decreaseError ?? '请输入调减金额'
    }
    if (adjustMode !== 'decrease') {
      if (!targetAccountCode) return '请选择目标科目'
      if (increaseInput === '' || increaseError) return increaseError ?? '请输入调增金额'
    }
    if (adjustMode === 'both' && targetAccountCode === sourceAccountCode) return '源科目与目标科目不能相同'
    if (!period) return '请选择调整期间（单月）'
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
    const netText = preview.netChange !== 0 ? `，公司总额将净变动 ${fmt(preview.netChange, activeQty)}` : '，公司总额不变'
    const actionText = adjustMode === 'increase'
      ? `「${targetName}」调增 ${fmt(preview.increaseAmount, activeQty)}`
      : `「${sourceName}」调减 ${fmt(preview.decreaseAmount, activeQty)}${adjustMode === 'both' && targetName ? `，「${targetName}」调增 ${fmt(preview.increaseAmount, activeQty)}` : ''}`
    const ok = await confirm({
      title: '确认科目间调整',
      description: `将把「${companyName}」的${TEMPLATE_LABEL[templateType]}中${actionText}${netText}。此操作将影响看板与指标且不可撤销，确认继续？`,
      danger: true,
      confirmText: '确认调整',
    })
    if (!ok) return
    setError(null)
    try {
      const res = await adjustMutation.mutateAsync(buildPayload())
      const doneParts = [
        res.decreaseAmount > 0 ? `调减 ${fmt(res.decreaseAmount, activeQty)}` : '',
        res.increaseAmount > 0 ? `调增 ${fmt(res.increaseAmount, activeQty)}` : '',
      ].filter(Boolean).join('，')
      setDone(`调整完成：${doneParts}，涉及 ${res.affectedRows} 条明细${res.createdRows > 0 ? `，新建 ${res.createdRows} 条` : ''}。`)
      setPreview(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '调整失败')
    }
  }

  const previewQty = preview?.valueType ? preview.valueType === 'quantity' : activeQty
  // 统计卡标签按口径分型（金额/数量）
  const amtLabel = previewQty ? '数量' : '金额'
  const previewItems: PreviewStatItem[] = preview
    ? adjustMode === 'increase'
      ? [
          { label: '目标科目匹配', value: `${preview.affectedRows} 条` },
          { label: '目标科目现有合计', value: fmt(preview.targetTotal ?? 0, previewQty) },
          { label: `调增${amtLabel}`, value: `+${fmt(preview.increaseAmount, previewQty)}`, tone: 'primary' },
          { label: '净变动', value: fmt(preview.netChange, previewQty), tone: preview.netChange !== 0 ? 'warning' : 'default' },
        ]
      : [
          { label: '源科目匹配', value: `${preview.affectedRows} 条` },
          { label: '源科目合计', value: fmt(preview.sourceTotal, previewQty) },
          { label: `调减${amtLabel}`, value: `-${fmt(preview.decreaseAmount, previewQty)}`, tone: 'primary' },
          ...(preview.increaseAmount > 0 ? [{ label: `调增${amtLabel}`, value: `+${fmt(preview.increaseAmount, previewQty)}`, tone: 'primary' as const }] : []),
          { label: '净变动', value: fmt(preview.netChange, previewQty), tone: preview.netChange !== 0 ? 'warning' : 'default' },
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
          <DialogTitle className="flex items-center gap-1.5">
            {readonly ? '科目调整详情' : '科目间金额调整'}
            <TitleHint text={readonly
              ? '原始操作参数只读展示'
              : '同一公司内按选定方式调整科目金额：可双向调整（调减+调增）、仅调减（如修正重复计算）或仅调增（如补录遗漏）；金额类科目单位为万元，数量类按整数调整。'
            } />
          </DialogTitle>
          {readonly && meta && <ReadonlyLogMeta meta={meta} />}
        </DialogHeader>

        <div className="space-y-4">
          {/* ===== 数据范围 ===== */}
          <section className="space-y-2">
            <SectionTitle>数据范围</SectionTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="rs-template-type">模板类型</Label>
                {readonly
                  ? <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">{TEMPLATE_LABEL[templateType] ?? templateType}</div>
                  : (
                    <Select value={templateType} onValueChange={(v) => { setTemplateType(v); reset(); setSourceAccountCode(''); setTargetAccountCode('') }}>
                      <SelectTrigger id="rs-template-type"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="operating">经营数据</SelectItem>
                        <SelectItem value="static">静态数据</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="rs-company">公司</Label>
                <Select value={companyCode} disabled={readonly} onValueChange={(v) => { setCompanyCode(v); reset() }}>
                  <SelectTrigger id="rs-company"><SelectValue placeholder="选择公司" /></SelectTrigger>
                  <SelectContent className="max-h-[280px]">
                    {entityCompanies.map((c) => (
                      <SelectItem key={c.code} value={c.code}>{displayNameMap.get(c.code) ?? c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>调整期间（单月） <span className="text-destructive">*</span></Label>
                {readonly
                  ? <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">{period || '-'}</div>
                  : (
                    <>
                      <MonthPicker className="w-full" value={period} onChange={(v) => { setPeriod(v); reset() }} availablePeriods={availablePeriods} placeholder="选择月份" />
                    </>
                  )}
              </div>
            </div>
          </section>

          {/* ===== 调整设置：调整方式 + 按方式展示调减侧/调增侧 ===== */}
          <section className="space-y-2">
            <SectionTitle>调整设置</SectionTitle>
            <div className="space-y-1">
              <Label htmlFor="rs-adjust-mode">调整方式</Label>
              <Select value={adjustMode} disabled={readonly} onValueChange={(v) => handleModeChange(v as AdjustMode)}>
                <SelectTrigger id="rs-adjust-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ADJUST_MODE_LABEL) as AdjustMode[]).map((m) => (
                    <SelectItem key={m} value={m}>{ADJUST_MODE_LABEL[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className={cn('grid grid-cols-1 gap-3', adjustMode === 'both' && 'sm:grid-cols-2')}>
              {/* 调减侧（decrease/both） */}
              {adjustMode !== 'increase' && (
              <div className="space-y-2 rounded-lg border border-destructive/25 bg-destructive/[0.06] p-3">
                <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
                  <MinusCircle className="h-4 w-4" />
                  调减侧（源科目）
                </p>
                <div className="space-y-1">
                  <Label>源科目 <span className="text-destructive">*</span></Label>
                  {readonly
                    ? (sourceAccountCode
                        ? <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm">
                            <span className="font-mono text-xs text-muted-foreground">{sourceAccountCode}</span>
                            <span className="truncate">{subjectOptions.find((s) => s.code === sourceAccountCode)?.name ?? sourceAccountCode}</span>
                          </div>
                        : <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">-</div>)
                    : (
                      <SubjectPicker
                        options={sourceOptions}
                        value={sourceAccountCode}
                        onChange={(code) => { setSourceAccountCode(code); reset() }}
                        excludeCode={targetAccountCode}
                        placeholder="选择要调减的科目"
                      />
                    )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="rs-decrease">{decSideQty ? '调减数量（整数）' : '调减金额（万元）'} <span className="text-destructive">*</span></Label>
                  <Input
                    id="rs-decrease"
                    type="number"
                    min={0}
                    step={decSideQty ? 1 : '0.01'}
                    placeholder={decSideQty ? '如 10' : '如 50'}
                    value={decreaseInput}
                    disabled={readonly}
                    aria-invalid={!!decreaseError}
                    className={cn('bg-background', decreaseError && 'border-destructive focus-visible:ring-destructive')}
                    onChange={(e) => { setDecreaseInput(e.target.value); reset() }}
                  />
                  {decreaseError && <p className="text-xs text-destructive">{decreaseError}</p>}
                </div>
              </div>
              )}

              {/* 调增侧（increase/both） */}
              {adjustMode !== 'decrease' && (
              <div className="space-y-2 rounded-lg border border-success/25 bg-success/10 p-3">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-success-strong">
                    <PlusCircle className="h-4 w-4" />
                    调增侧（目标科目）
                  </p>
                  {!readonly && adjustMode === 'both' && (
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
                  )}
                </div>
                <div className="space-y-1">
                  <Label>目标科目 <span className="text-destructive">*</span></Label>
                  {readonly
                    ? (targetAccountCode
                        ? <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/40 px-3 text-sm">
                            <span className="font-mono text-xs text-muted-foreground">{targetAccountCode}</span>
                            <span className="truncate">{subjectOptions.find((s) => s.code === targetAccountCode)?.name ?? targetAccountCode}</span>
                          </div>
                        : <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">-</div>)
                    : (
                      <SubjectPicker
                        options={targetOptions}
                        value={targetAccountCode}
                        onChange={(code) => { setTargetAccountCode(code); reset() }}
                        excludeCode={sourceAccountCode}
                        placeholder="选择要调增的科目"
                      />
                    )}
                </div>
                <div className="space-y-1">
                  <Label htmlFor="rs-increase">{incSideQty ? '调增数量（整数）' : '调增金额（万元）'} <span className="text-destructive">*</span></Label>
                  <Input
                    id="rs-increase"
                    type="number"
                    min={0}
                    step={incSideQty ? 1 : '0.01'}
                    placeholder={incSideQty ? '如 10' : '如 50'}
                    value={increaseInput}
                    disabled={readonly}
                    aria-invalid={!!increaseError}
                    className={cn('bg-background', increaseError && 'border-destructive focus-visible:ring-destructive')}
                    onChange={(e) => { setIncreaseInput(e.target.value); reset() }}
                  />
                  {increaseError && <p className="text-xs text-destructive">{increaseError}</p>}
                </div>
              </div>
              )}
            </div>

            {/* 实时净变动提示（无需等预览；只读模式隐藏） */}
            {!readonly && (decValue > 0 || incValue > 0) && (
              <div
                className={cn(
                  'rounded-md border p-2.5 text-sm',
                  localNet !== 0 ? 'border-warning/30 bg-warning/[0.08] text-warning-strong' : 'border-muted bg-muted/30 text-muted-foreground',
                )}
              >
                {localNet !== 0
                  ? <>本次调整将使公司总额净变动 <span className="font-num font-semibold">{fmt(localNet, activeQty)}</span>{adjustMode === 'decrease' && '（仅调减）'}{adjustMode === 'increase' && '（仅调增）'}。</>
                  : <>调减与调增等额，公司总额不变。</>}
              </div>
            )}
          </section>

          {/* ===== 调整原因 ===== */}
          <section className="space-y-1">
            <Label htmlFor="rs-reason">调整原因 <span className="text-destructive">*</span></Label>
            {readonly
              ? <div className="min-h-9 rounded-md border bg-muted/40 px-3 py-2 text-sm">{reason || '-'}</div>
              : (
                <Textarea
                  id="rs-reason"
                  rows={2}
                  placeholder="如：××科目 5 月数据重复计算，调减重复部分"
                  value={reason}
                  aria-invalid={!!reasonError}
                  className={cn(reasonError && 'border-destructive focus-visible:ring-destructive')}
                  onChange={(e) => setReason(e.target.value)}
                  onBlur={() => setReasonTouched(true)}
                />
              )}
            {reasonError && <p className="text-xs text-destructive">{reasonError}</p>}
          </section>

          {/* ===== 执行结果（只读模式：还原当时的执行结果统计） ===== */}
          {readonly && result && result.length > 0 && (
            <section className="space-y-2">
              <SectionTitle>执行结果</SectionTitle>
              <PreviewStats items={result} />
            </section>
          )}

          {/* ===== 预览与执行（只读模式隐藏） ===== */}
          {!readonly && (
            <section className="space-y-2">
              <SectionTitle>预览与执行</SectionTitle>
              {!preview && !done && !error && (
                <p className="text-xs text-muted-foreground">设置完成后点击「预览影响」查看源科目匹配情况与金额变化。</p>
              )}
              {preview && (preview.affectedRows === 0
                ? <PreviewStats items={[]} empty />
                : <PreviewStats
                    items={previewItems}
                    warning={preview.netChange !== 0 ? <>本次调整将使公司总额净变动 <span className="font-num font-semibold">{fmt(preview.netChange, previewQty)}</span>，请确认业务依据。</> : undefined}
                  />)}
              {done && <FeedbackAlert kind="success">{done}</FeedbackAlert>}
              {error && <FeedbackAlert kind="error">{error}</FeedbackAlert>}
            </section>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <div className="flex flex-1 items-center">
            {!readonly && submitDisabledReason && <span className="text-xs text-muted-foreground">{submitDisabledReason}</span>}
          </div>
          <Button variant="outline" onClick={onClose}>关闭</Button>
          {!readonly && (
            <>
              <Button
                variant="outline"
                onClick={handlePreview}
                disabled={
                  previewMutation.isPending || !companyCode || !period
                  || (adjustMode !== 'increase' && (!sourceAccountCode || !decreaseInput))
                  || (adjustMode !== 'decrease' && (!targetAccountCode || !increaseInput))
                }
              >
                {previewMutation.isPending ? '预览中...' : '预览影响'}
              </Button>
              <Button variant="destructive" onClick={handleSubmit} disabled={!preview || preview.affectedRows === 0 || !reason.trim() || adjustMutation.isPending}>
                {adjustMutation.isPending ? '调整中...' : '执行调整'}
              </Button>
            </>
          )}
        </DialogFooter>
        {confirmElement}
      </DialogContent>
    </Dialog>
  )
}
