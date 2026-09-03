import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
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
  useReapplyAdjustSubject,
} from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { formatMoney, formatQuantity, cn } from '@/lib/utils'
import { Equal, MinusCircle, PlusCircle } from 'lucide-react'
import { FeedbackAlert, PreviewStats, SubjectPicker, SectionTitle, ReadonlyLogMeta, TitleHint, type ReclassifyLogMeta, type PreviewStatItem } from './shared'

interface BudgetAdjustDialogProps {
  open: boolean
  onClose: () => void
  /** 预填公司（来自指标页当前主体） */
  defaultCompany?: string
  /** 完整预填参数（来自失效/已撤销日志的「重新应用」或只读查看）：父级以 key 强制重挂载使其生效 */
  preset?: BudgetAdjustPreset
  /** 只读查看模式：预填 preset 展示原始操作参数，禁止修改与提交（不触发任何写接口） */
  readonly?: boolean
  /** 只读模式下展示的日志元信息（操作人/时间/状态） */
  meta?: ReclassifyLogMeta
  /** 只读模式下还原的当时执行结果统计（来自日志 detail，如调减/调增金额、净变动、新建行数） */
  result?: PreviewStatItem[]
  /** 重新应用模式：传入原日志 id，提交时更新原日志记录（恢复"正常"态），不新建记录 */
  reapplyLogId?: string
}

export interface BudgetAdjustPreset {
  companyCode: string
  adjustMode: AdjustMode
  sourceAccountCode?: string | null
  targetAccountCode?: string | null
  decreaseAmount?: number
  increaseAmount?: number
  /** 原始期间：全年 YYYY，或历史月度口径 YYYY-MM（展示时归一化为财年标签） */
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

/** 预算期间归一化为财年标签：全年 YYYY 直接映射；历史月度 YYYY-MM 按财年起始月换算 */
function fyLabelOf(period: string, fiscalStartMonth: number): string {
  if (/^\d{4}$/.test(period)) return `FY${period}`
  const [y, m] = period.split('-').map(Number)
  return `FY${m >= fiscalStartMonth ? y : y - 1}`
}

/**
 * 年度预算调整对话框：仅支持按财年（全年）整体调整年度预算数据，不再按月拆分。
 * 调整方式与科目调整一致（双向/仅调减/仅调增），期间固定为财年选择器（提交 period 传 YYYY，
 * 后端按 fiscalYear 整体匹配）；金额类科目单位为万元，数量类按整数调整。
 */
export function BudgetAdjustDialog({ open, onClose, defaultCompany, preset, readonly = false, meta, result, reapplyLogId }: BudgetAdjustDialogProps) {
  const [companyCode, setCompanyCode] = useState<string>(preset?.companyCode ?? defaultCompany ?? '')
  const [adjustMode, setAdjustMode] = useState<AdjustMode>(preset?.adjustMode ?? 'both')
  const [sourceAccountCode, setSourceAccountCode] = useState(preset?.sourceAccountCode ?? '')
  const [targetAccountCode, setTargetAccountCode] = useState(preset?.targetAccountCode ?? '')
  const [decreaseInput, setDecreaseInput] = useState(() => (preset?.decreaseAmount != null ? String(preset.decreaseAmount) : ''))
  const [increaseInput, setIncreaseInput] = useState(() => (preset?.increaseAmount != null ? String(preset.increaseAmount) : ''))
  const [fiscalYear, setFiscalYear] = useState('')
  const [reason, setReason] = useState(preset?.reason ?? '')
  const [reasonTouched, setReasonTouched] = useState(false)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const { confirm, element: confirmElement } = useConfirm()
  const { data: companies } = useCompanies()
  const { data: periodsData } = useAvailablePeriods()
  // 财年候选与全局 Header 财年选择器同源（FY 标签，降序）；起始月用于历史月度口径归一化
  const fiscalYears = periodsData?.fiscalYears ?? []
  const fiscalStartMonth = periodsData?.fiscalStartMonth ?? 1
  const entityCompanies = useMemo(() => (companies ?? []).filter((c) => c.type === 'entity'), [companies])
  // 下拉选项跟随「显示简称」开关；确认弹窗文案仍用全称，保证高危操作确认的严谨性
  const { displayNameMap } = useCompanyDisplayName()

  // 科目候选：经营科目（预算口径同经营科目树）；比率类（公式计算）与 calc/display 类不可直接调整
  const { data: subjectsData } = useSubjects({ type: 'operating', pageSize: 1000 })
  const subjectOptions = useMemo(
    () => (subjectsData?.items ?? []).filter((s) => s.valueType !== 'ratio' && s.dataType !== 'calc' && s.dataType !== 'display'),
    [subjectsData],
  )

  // 已选科目的值类型：驱动单位文案/整数校验/分型格式化；both 模式源目标必须同型（候选互斥过滤）
  const sourceVt = subjectOptions.find((s) => s.code === sourceAccountCode)?.valueType ?? null
  const targetVt = subjectOptions.find((s) => s.code === targetAccountCode)?.valueType ?? null
  const decSideQty = sourceVt === 'quantity'
  const incSideQty = (adjustMode === 'both' ? (sourceVt ?? targetVt) : targetVt) === 'quantity'
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

  // 预设期间归一化为财年标签（历史月度口径日志按财年起始月换算；key 重挂载 + 起始月异步加载双保险）
  useEffect(() => {
    if (preset?.period) setFiscalYear(fyLabelOf(preset.period, fiscalStartMonth))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.period, fiscalStartMonth])

  const previewMutation = usePreviewAdjustSubject()
  const adjustMutation = useAdjustSubject()
  const reapplyMutation = useReapplyAdjustSubject()

  const buildPayload = () => ({
    templateType: 'budget' as const,
    companyCode,
    adjustMode,
    sourceAccountCode: adjustMode !== 'increase' ? sourceAccountCode : undefined,
    targetAccountCode: adjustMode !== 'decrease' ? (targetAccountCode || undefined) : undefined,
    decreaseAmount: adjustMode !== 'increase' ? Number(decreaseInput) : undefined,
    increaseAmount: adjustMode !== 'decrease' && increaseInput !== '' ? Number(increaseInput) : undefined,
    // 全年粒度：财年标签去前缀（FY2026 → 2026），后端按 fiscalYear 整体匹配
    period: fiscalYear.replace('FY', ''),
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
  const activeQty = adjustMode === 'increase' ? incSideQty : decSideQty

  const validateBeforePreview = (): string | null => {
    if (!fiscalYear) return '请选择调整财年（全年）'
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
    const netText = preview.netChange !== 0 ? `，公司全年预算总额将净变动 ${fmt(preview.netChange, activeQty)}` : '，公司全年预算总额不变'
    const actionText = adjustMode === 'increase'
      ? `「${targetName}」调增 ${fmt(preview.increaseAmount, activeQty)}`
      : `「${sourceName}」调减 ${fmt(preview.decreaseAmount, activeQty)}${adjustMode === 'both' && targetName ? `，「${targetName}」调增 ${fmt(preview.increaseAmount, activeQty)}` : ''}`
    const reapplyNote = reapplyLogId ? '提交后将更新原调整记录状态为已生效（不新建记录）。' : ''
    const ok = await confirm({
      title: reapplyLogId ? '确认重新应用年度预算调整' : '确认年度预算调整',
      description: `将把「${companyName}」${fiscalYear} 年度预算中${actionText}${netText}。年度预算按全年整体调整，不拆分到月份。${reapplyNote}此操作将影响看板与指标，确认继续？`,
      danger: true,
      confirmText: reapplyLogId ? '确认重新应用' : '确认调整',
    })
    if (!ok) return
    setError(null)
    try {
      const res = reapplyLogId
        ? await reapplyMutation.mutateAsync({ id: reapplyLogId, data: buildPayload() })
        : await adjustMutation.mutateAsync(buildPayload())
      const doneParts = [
        res.decreaseAmount > 0 ? `调减 ${fmt(res.decreaseAmount, activeQty)}` : '',
        res.increaseAmount > 0 ? `调增 ${fmt(res.increaseAmount, activeQty)}` : '',
      ].filter(Boolean).join('，')
      setDone(`${reapplyLogId ? '重新应用完成' : '调整完成'}：${doneParts}，涉及 ${res.affectedRows} 条明细${res.createdRows > 0 ? `，新建 ${res.createdRows} 条` : ''}${reapplyLogId ? '，原记录已恢复为已生效状态。' : '。'}`)
      setPreview(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : reapplyLogId ? '重新应用失败' : '调整失败')
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
            {readonly ? '年度预算调整详情' : reapplyLogId ? '重新应用年度预算调整' : '年度预算调整'}
            <TitleHint text={readonly
              ? '原始操作参数只读展示'
              : reapplyLogId
                ? '在最新数据上重新执行原调整（参数可修改），提交后更新原记录状态为已生效，不新建记录。'
                : '仅支持按财年（全年）整体调整年度预算数据，不再按月拆分；金额类科目单位为万元，数量类按整数调整。'
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
                <Label htmlFor="ba-fiscal-year">调整财年（全年） <span className="text-destructive">*</span></Label>
                {readonly
                  ? <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">{fiscalYear || '-'}</div>
                  : (
                    <Select value={fiscalYear} onValueChange={(v) => { setFiscalYear(v); reset() }}>
                      <SelectTrigger id="ba-fiscal-year"><SelectValue placeholder="选择财年" /></SelectTrigger>
                      <SelectContent>
                        {fiscalYears.map((fy) => (
                          <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
              </div>
              <div className="space-y-1">
                <Label htmlFor="ba-company">公司</Label>
                {readonly
                  ? <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">{displayNameMap.get(companyCode) ?? companyCode}</div>
                  : (
                    <Select value={companyCode} onValueChange={(v) => { setCompanyCode(v); reset() }}>
                      <SelectTrigger id="ba-company"><SelectValue placeholder="选择公司" /></SelectTrigger>
                      <SelectContent className="max-h-[280px]">
                        {entityCompanies.map((c) => (
                          <SelectItem key={c.code} value={c.code}>{displayNameMap.get(c.code) ?? c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
              </div>
            </div>
          </section>

          {/* ===== 调整设置：调整方式 + 按方式展示调减侧/调增侧 ===== */}
          <section className="space-y-2">
            <SectionTitle>调整设置</SectionTitle>
            <div className="space-y-1">
              <Label htmlFor="ba-adjust-mode">调整方式</Label>
              {readonly
                ? <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">{ADJUST_MODE_LABEL[adjustMode] ?? adjustMode}</div>
                : (
                  <Select value={adjustMode} onValueChange={(v) => handleModeChange(v as AdjustMode)}>
                    <SelectTrigger id="ba-adjust-mode"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(ADJUST_MODE_LABEL) as AdjustMode[]).map((m) => (
                        <SelectItem key={m} value={m}>{ADJUST_MODE_LABEL[m]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
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
                  <Label htmlFor="ba-decrease">{decSideQty ? '调减数量（整数）' : '调减金额（万元）'} <span className="text-destructive">*</span></Label>
                  <Input
                    id="ba-decrease"
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
                  <Label htmlFor="ba-increase">{incSideQty ? '调增数量（整数）' : '调增金额（万元）'} <span className="text-destructive">*</span></Label>
                  <Input
                    id="ba-increase"
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
                  ? <>本次调整将使公司全年预算总额净变动 <span className="font-num font-semibold">{fmt(localNet, activeQty)}</span>{adjustMode === 'decrease' && '（仅调减）'}{adjustMode === 'increase' && '（仅调增）'}。</>
                  : <>调减与调增等额，公司全年预算总额不变。</>}
              </div>
            )}
          </section>

          {/* ===== 调整原因 ===== */}
          <section className="space-y-1">
            <Label htmlFor="ba-reason">调整原因 <span className="text-destructive">*</span></Label>
            {readonly
              ? <div className="min-h-9 rounded-md border bg-muted/40 px-3 py-2 text-sm">{reason || '-'}</div>
              : (
                <Textarea
                  id="ba-reason"
                  rows={2}
                  placeholder="如：××科目全年预算调整，按实际经营计划修订"
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
                    warning={preview.netChange !== 0 ? <>本次调整将使公司全年预算总额净变动 <span className="font-num font-semibold">{fmt(preview.netChange, previewQty)}</span>，请确认业务依据。</> : undefined}
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
                  previewMutation.isPending || !fiscalYear || !companyCode
                  || (adjustMode !== 'increase' && (!sourceAccountCode || !decreaseInput))
                  || (adjustMode !== 'decrease' && (!targetAccountCode || !increaseInput))
                }
              >
                {previewMutation.isPending ? '预览中...' : '预览影响'}
              </Button>
              <Button variant="destructive" onClick={handleSubmit} disabled={!preview || preview.affectedRows === 0 || !reason.trim() || adjustMutation.isPending || reapplyMutation.isPending}>
                {adjustMutation.isPending || reapplyMutation.isPending ? (reapplyLogId ? '重新应用中...' : '调整中...') : reapplyLogId ? '重新应用' : '执行调整'}
              </Button>
            </>
          )}
        </DialogFooter>
        {confirmElement}
      </DialogContent>
    </Dialog>
  )
}
