import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  usePreviewReclassifyCompany,
  useReclassifyCompany,
} from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { formatMoney, cn } from '@/lib/utils'
import { ArrowLeftRight } from 'lucide-react'
import { TEMPLATE_LABEL, FeedbackAlert, PreviewStats, SubjectMultiPicker, SectionTitle, ReadonlyLogMeta, type ReclassifyLogMeta, type PreviewStatItem } from './shared'

interface ReclassifyCompanyDialogProps {
  open: boolean
  onClose: () => void
  /** 预填模板类型（来自指标页当前标签） */
  defaultTemplateType?: 'operating' | 'static'
  /** 预填源公司（来自指标页当前主体） */
  defaultSourceCompany?: string
  /** 完整预填参数（来自失效/已撤销日志的「重新应用」或只读查看）：父级以 key 强制重挂载使其生效 */
  preset?: ReclassifyCompanyPreset
  /** 只读查看模式：预填 preset 展示原始操作参数，禁止修改与提交（不触发任何写接口） */
  readonly?: boolean
  /** 只读模式下展示的日志元信息（操作人/时间/状态） */
  meta?: ReclassifyLogMeta
}

export interface ReclassifyCompanyPreset {
  templateType: 'operating' | 'static' | 'budget'
  sourceCompanyCode: string
  targetCompanyCode: string
  transferMode: 'all' | 'ratio' | 'amount'
  ratio?: number
  amount?: number
  period: string
  accountCodes: string[]
}

interface PreviewData {
  affectedRows: number
  totalValue: number
  transferValue: number
  conflictRows: number
  createRows: number
}

/**
 * 跨公司重分类对话框：把源公司某模板类型（可按科目筛选）指定单月的生效数据转移到目标公司。
 * 布局分区：数据范围（模板/期间/科目）→ 转移设置（源/目标 + 方式）→ 预览与执行。
 * 支持三种转移方式：整体迁移（改挂行，冲突合并求和）、按比例/按金额部分转移
 * （源行调减保留，目标同口径行调增，无则新建）。提交前预览影响并二次确认。
 * 期间按单月必选（与后端口径一致）；本年累计由查询时按财年实时聚合，自动反映调整结果。
 */
export function ReclassifyCompanyDialog({ open, onClose, defaultTemplateType = 'operating', defaultSourceCompany, preset, readonly = false, meta }: ReclassifyCompanyDialogProps) {
  const [templateType, setTemplateType] = useState<string>(preset?.templateType ?? defaultTemplateType)
  const [sourceCompanyCode, setSourceCompanyCode] = useState<string>(preset?.sourceCompanyCode ?? defaultSourceCompany ?? '')
  const [targetCompanyCode, setTargetCompanyCode] = useState<string>(preset?.targetCompanyCode ?? '')
  const [transferMode, setTransferMode] = useState<'all' | 'ratio' | 'amount'>(preset?.transferMode ?? 'all')
  // 日志 ratio 为 0-1 小数，表单按百分比字符串展示
  const [ratioInput, setRatioInput] = useState(() => (preset?.ratio != null ? String(Math.round(preset.ratio * 10000) / 100) : ''))
  const [amountInput, setAmountInput] = useState(() => (preset?.amount != null ? String(preset.amount) : ''))
  const [period, setPeriod] = useState(preset?.period ?? '')
  const [selectedSubjects, setSelectedSubjects] = useState<Set<string>>(() => new Set(preset?.accountCodes ?? []))
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

  const previewMutation = usePreviewReclassifyCompany()
  const reclassifyMutation = useReclassifyCompany()

  const buildPayload = () => ({
    templateType,
    sourceCompanyCode,
    targetCompanyCode,
    accountCodes: selectedSubjects.size > 0 ? [...selectedSubjects] : undefined,
    period,
    transferMode,
    ratio: transferMode === 'ratio' ? Number(ratioInput) / 100 : undefined,
    amount: transferMode === 'amount' ? Number(amountInput) : undefined,
  })

  const reset = () => {
    setPreview(null)
    setError(null)
    setDone(null)
  }

  // ---- 字段级校验（输入非空且非法时红框 + 内联提示）----
  const ratioError = (() => {
    if (transferMode !== 'ratio' || ratioInput === '') return null
    const pct = Number(ratioInput)
    return !Number.isFinite(pct) || pct <= 0 || pct > 100 ? '比例须为 0-100 之间的数值' : null
  })()
  const amountError = (() => {
    if (transferMode !== 'amount' || amountInput === '') return null
    const amt = Number(amountInput)
    return !Number.isFinite(amt) || amt <= 0 ? '金额须大于 0' : null
  })()

  const validateBeforePreview = (): string | null => {
    if (!sourceCompanyCode || !targetCompanyCode) return '请选择源公司与目标公司'
    if (sourceCompanyCode === targetCompanyCode) return '源公司与目标公司不能相同'
    if (!period) return '请选择调整期间（单月）'
    if (transferMode === 'ratio' && (ratioInput === '' || ratioError)) return ratioError ?? '请输入转移比例'
    if (transferMode === 'amount' && (amountInput === '' || amountError)) return amountError ?? '请输入转移金额'
    return null
  }

  const handleSwap = () => {
    if (!sourceCompanyCode && !targetCompanyCode) return
    const src = sourceCompanyCode
    setSourceCompanyCode(targetCompanyCode)
    setTargetCompanyCode(src)
    reset()
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

  const toggleSubject = (code: string) => {
    setSelectedSubjects((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
    setPreview(null)
  }

  const handleSubmit = async () => {
    if (!preview || preview.affectedRows === 0) return
    const sourceName = entityCompanies.find((c) => c.code === sourceCompanyCode)?.name ?? sourceCompanyCode
    const targetName = entityCompanies.find((c) => c.code === targetCompanyCode)?.name ?? targetCompanyCode
    const description = transferMode === 'all'
      ? `将把「${sourceName}」的 ${preview.affectedRows} 条${TEMPLATE_LABEL[templateType]}明细（合计 ${formatMoney(preview.totalValue)}）改挂到「${targetName}」${preview.conflictRows > 0 ? `，其中 ${preview.conflictRows} 条将与目标公司现有数据合并求和` : ''}。此操作将影响看板与指标且不可撤销，确认继续？`
      : `将从「${sourceName}」的 ${preview.affectedRows} 条${TEMPLATE_LABEL[templateType]}明细（合计 ${formatMoney(preview.totalValue)}）中转移 ${formatMoney(preview.transferValue)} 到「${targetName}」，源公司保留剩余金额${preview.conflictRows > 0 ? `；${preview.conflictRows} 条将累加到目标公司现有数据` : ''}${preview.createRows > 0 ? `；将新建 ${preview.createRows} 条目标公司明细` : ''}。此操作将影响看板与指标且不可撤销，确认继续？`
    const ok = await confirm({
      title: '确认跨公司重分类',
      description,
      danger: true,
      confirmText: '确认重分类',
    })
    if (!ok) return
    setError(null)
    try {
      const res = await reclassifyMutation.mutateAsync(buildPayload())
      setDone(
        transferMode === 'all'
          ? `重分类完成：迁移 ${res.affectedRows} 条明细${res.mergedRows > 0 ? `，其中 ${res.mergedRows} 条已合并` : ''}。`
          : `重分类完成：转移金额 ${formatMoney(res.transferValue)}，涉及 ${res.affectedRows} 条明细${res.mergedRows > 0 ? `，${res.mergedRows} 条已累加` : ''}${res.createdRows > 0 ? `，新建 ${res.createdRows} 条` : ''}。`,
      )
      setPreview(null)
      setSelectedSubjects(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : '重分类失败')
    }
  }

  const previewItems: PreviewStatItem[] = preview
    ? transferMode === 'all'
      ? [
          { label: '迁移明细', value: `${preview.affectedRows} 条` },
          { label: '合计金额', value: formatMoney(preview.totalValue), tone: 'primary' },
          { label: '合并求和', value: `${preview.conflictRows} 条`, tone: preview.conflictRows > 0 ? 'warning' : 'default' },
        ]
      : [
          { label: '匹配明细', value: `${preview.affectedRows} 条` },
          { label: '源数据合计', value: formatMoney(preview.totalValue) },
          { label: '计划转移额', value: formatMoney(preview.transferValue), tone: 'primary' },
          { label: '累加到现有行', value: `${preview.conflictRows} 条` },
          { label: '新建明细行', value: `${preview.createRows} 条` },
        ]
    : []

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{readonly ? '跨公司重分类详情' : '跨公司数据重分类'}</DialogTitle>
          {readonly ? (
            <DialogDescription>原始操作参数只读展示{meta && <ReadonlyLogMeta meta={meta} />}</DialogDescription>
          ) : (
            <DialogDescription>将源公司已生效的数据转移到目标公司，看板与指标将即时刷新。</DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4">
          {/* ===== 数据范围 ===== */}
          <section className="space-y-2">
            <SectionTitle>数据范围</SectionTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>模板类型</Label>
                <Select value={templateType} disabled={readonly} onValueChange={(v) => { setTemplateType(v); reset(); setSelectedSubjects(new Set()) }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="operating">经营数据</SelectItem>
                    <SelectItem value="static">静态数据</SelectItem>
                    <SelectItem value="budget">年度预算</SelectItem>
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
                      {templateType === 'budget' && <p className="text-xs text-muted-foreground">预算数据按该月所属财年整体匹配。</p>}
                    </>
                  )}
              </div>
            </div>
            <div className="space-y-1">
              <Label>科目筛选（可选）</Label>
              {readonly
                ? (
                    selectedSubjects.size > 0
                      ? <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-muted/40 px-3 py-1.5 text-sm">
                          {subjectOptions.filter((s) => selectedSubjects.has(s.code)).map((s) => (
                            <span key={s.code} className="max-w-[160px] truncate rounded bg-background px-1.5 py-0.5 text-xs" title={s.code}>{s.name}</span>
                          ))}
                        </div>
                      : <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm text-muted-foreground">全部科目</div>
                  )
                : (
                  <>
                    <SubjectMultiPicker
                      options={subjectOptions}
                      selected={selectedSubjects}
                      onToggle={toggleSubject}
                      onClear={() => { setSelectedSubjects(new Set()); setPreview(null) }}
                      placeholder="全部科目"
                    />
                    <p className="text-xs text-muted-foreground">不选 = 源公司全部科目；多选 = 仅对所选科目的数据执行重分类。</p>
                  </>
                )}
            </div>
          </section>

          {/* ===== 转移设置 ===== */}
          <section className="space-y-2">
            <SectionTitle>转移设置</SectionTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1">
                <Label htmlFor="rc-source-company">源公司</Label>
                <Select value={sourceCompanyCode} disabled={readonly} onValueChange={(v) => { setSourceCompanyCode(v); reset() }}>
                  <SelectTrigger id="rc-source-company"><SelectValue placeholder="选择源公司" /></SelectTrigger>
                  <SelectContent className="max-h-[280px]">
                    {entityCompanies.map((c) => (
                      <SelectItem key={c.code} value={c.code}>{displayNameMap.get(c.code) ?? c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!readonly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mx-auto h-9 w-9 shrink-0 text-muted-foreground sm:mx-0"
                  aria-label="交换源公司与目标公司"
                  title="交换源公司与目标公司"
                  onClick={handleSwap}
                  disabled={!sourceCompanyCode && !targetCompanyCode}
                >
                  <ArrowLeftRight className="h-4 w-4" />
                </Button>
              )}
              <div className="flex-1 space-y-1">
                <Label htmlFor="rc-target-company">目标公司</Label>
                <Select value={targetCompanyCode} disabled={readonly} onValueChange={(v) => { setTargetCompanyCode(v); reset() }}>
                  <SelectTrigger id="rc-target-company"><SelectValue placeholder="选择目标公司" /></SelectTrigger>
                  <SelectContent className="max-h-[280px]">
                    {entityCompanies.filter((c) => c.code !== sourceCompanyCode).map((c) => (
                      <SelectItem key={c.code} value={c.code}>{displayNameMap.get(c.code) ?? c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="rc-transfer-mode">转移方式</Label>
                <Select value={transferMode} disabled={readonly} onValueChange={(v) => { setTransferMode(v as 'all' | 'ratio' | 'amount'); reset() }}>
                  <SelectTrigger id="rc-transfer-mode"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">整体迁移</SelectItem>
                    <SelectItem value="ratio">按比例部分转移</SelectItem>
                    <SelectItem value="amount">按金额部分转移</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {transferMode === 'ratio' && (
                <div className="space-y-1">
                  <Label htmlFor="rc-ratio">转移比例（%）</Label>
                  <Input
                    id="rc-ratio"
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    placeholder="如 30"
                    value={ratioInput}
                    disabled={readonly}
                    aria-invalid={!!ratioError}
                    className={cn(ratioError && 'border-destructive focus-visible:ring-destructive')}
                    onChange={(e) => { setRatioInput(e.target.value); reset() }}
                  />
                  {ratioError && <p className="text-xs text-destructive">{ratioError}</p>}
                </div>
              )}
              {transferMode === 'amount' && (
                <div className="space-y-1">
                  <Label htmlFor="rc-amount">转移金额（万元）</Label>
                  <Input
                    id="rc-amount"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="如 100"
                    value={amountInput}
                    disabled={readonly}
                    aria-invalid={!!amountError}
                    className={cn(amountError && 'border-destructive focus-visible:ring-destructive')}
                    onChange={(e) => { setAmountInput(e.target.value); reset() }}
                  />
                  {amountError && <p className="text-xs text-destructive">{amountError}</p>}
                </div>
              )}
            </div>
            {transferMode !== 'all' && (
              <p className="text-xs text-muted-foreground">
                部分转移：源公司明细调减并保留，目标公司同口径明细调增（无则新建），总额不变。
                {transferMode === 'amount' && '按金额模式将按各明细金额占比分摊。'}
              </p>
            )}
          </section>

          {/* ===== 预览与执行（只读模式隐藏） ===== */}
          {!readonly && (
            <section className="space-y-2">
              <SectionTitle>预览与执行</SectionTitle>
              {!preview && !done && !error && (
                <p className="text-xs text-muted-foreground">设置完成后点击「预览影响」查看将变更的数据范围与金额。</p>
              )}
              {preview && (preview.affectedRows === 0 ? <PreviewStats items={[]} empty /> : <PreviewStats items={previewItems} />)}
              {done && <FeedbackAlert kind="success">{done}</FeedbackAlert>}
              {error && <FeedbackAlert kind="error">{error}</FeedbackAlert>}
            </section>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>关闭</Button>
          {!readonly && (
            <>
              <Button variant="outline" onClick={handlePreview} disabled={previewMutation.isPending || !sourceCompanyCode || !targetCompanyCode || !period}>
                {previewMutation.isPending ? '预览中...' : '预览影响'}
              </Button>
              <Button variant="destructive" onClick={handleSubmit} disabled={!preview || preview.affectedRows === 0 || reclassifyMutation.isPending}>
                {reclassifyMutation.isPending ? '重分类中...' : '执行重分类'}
              </Button>
            </>
          )}
        </DialogFooter>
        {confirmElement}
      </DialogContent>
    </Dialog>
  )
}
