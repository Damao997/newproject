import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
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
  useAvailablePeriods,
  useSubjectTree,
  useCommonSummaries,
  useCreateConsolidationAdjustment,
  type CommonSummaryItem,
} from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { formatMoney, cn } from '@/lib/utils'
import { ArrowLeftRight, Link2 } from 'lucide-react'
import { FeedbackAlert, SubjectPicker, SectionTitle, TitleHint } from './shared'

interface ConsolidationAdjustDialogProps {
  open: boolean
  onClose: () => void
}

/**
 * 汇总抵消调整对话框：选择两个单体公司 → 系统按汇总映射（company_aggregation_map）自动匹配
 * 共同所属的汇总主体（多选可取消）→ 在选中的汇总主体口径上按科目/单月叠加抵消金额，
 * 解决两个单体公司之间的内部交易在汇总层面的重复计算；单体报表完全不受影响。
 * 抵消金额为正=调增、负=调减；与重分类（修改单体事实行）不同，本操作不改动任何单体数据。金额单位：万元。
 */
export function ConsolidationAdjustDialog({ open, onClose }: ConsolidationAdjustDialogProps) {
  const [singleA, setSingleA] = useState('')
  const [singleB, setSingleB] = useState('')
  const [matchedSummaries, setMatchedSummaries] = useState<CommonSummaryItem[]>([])
  const [selectedSummaries, setSelectedSummaries] = useState<Set<string>>(new Set())
  const [accountCode, setAccountCode] = useState('')
  const [period, setPeriod] = useState('')
  const [amountInput, setAmountInput] = useState('')
  const [reason, setReason] = useState('')
  const [reasonTouched, setReasonTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const { confirm, element: confirmElement } = useConfirm()
  const { data: companies } = useCompanies()
  const { data: periodsData } = useAvailablePeriods()
  const availablePeriods = periodsData?.periods ?? []
  const entityCompanies = useMemo(() => (companies ?? []).filter((c) => c.type === 'entity'), [companies])
  const { displayNameMap } = useCompanyDisplayName()

  // 科目候选：经营科目树中 data 类叶子（calc/display 由公式计算，抵消会被覆盖；比率类不可调整）
  const { data: subjectTree } = useSubjectTree('operating')
  const subjectOptions = useMemo(
    () => (subjectTree ?? []).filter((s) => s.dataType === 'data' && s.valueType !== 'ratio'),
    [subjectTree],
  )

  const matchMutation = useCommonSummaries()
  const createMutation = useCreateConsolidationAdjustment()

  const resetMatch = () => {
    setMatchedSummaries([])
    setSelectedSummaries(new Set())
    setError(null)
    setDone(null)
  }

  const handleSwap = () => {
    const a = singleA
    setSingleA(singleB)
    setSingleB(a)
    resetMatch()
  }

  /** 匹配两个单体公司共同所属的汇总主体；无共同汇总主体时给出明确提示 */
  const handleMatch = async () => {
    if (!singleA || !singleB) {
      setError('请先选择两个单体公司')
      return
    }
    resetMatch()
    try {
      const res = await matchMutation.mutateAsync({ singleCompanyCodeA: singleA, singleCompanyCodeB: singleB })
      if (res.summaries.length === 0) {
        setError('两个单体公司没有共同的汇总主体，无法进行内部抵消（请检查汇总映射配置）。')
        return
      }
      setMatchedSummaries(res.summaries)
      setSelectedSummaries(new Set(res.summaries.map((s) => s.code)))
    } catch (err) {
      setError(err instanceof Error ? err.message : '匹配失败')
    }
  }

  const toggleSummary = (code: string) => {
    setSelectedSummaries((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
    setError(null)
    setDone(null)
  }

  const amountError = (() => {
    if (amountInput === '') return null
    const amt = Number(amountInput)
    return !Number.isFinite(amt) || amt === 0 ? '金额须为非 0 数值（正=调增、负=调减）' : null
  })()
  const reasonError = reasonTouched && !reason.trim() ? '请填写调整原因' : null

  const validateBeforeSubmit = (): string | null => {
    if (!singleA || !singleB) return '请选择两个单体公司'
    if (selectedSummaries.size === 0) return '请至少选择一个匹配到的汇总主体'
    if (!accountCode) return '请选择科目'
    if (!period) return '请选择调整期间（单月）'
    if (amountInput === '' || amountError) return amountError ?? '请输入调整金额'
    if (!reason.trim()) return '请填写调整原因'
    return null
  }

  const handleSubmit = async () => {
    const invalid = validateBeforeSubmit()
    if (invalid) {
      setError(invalid)
      return
    }
    const nameOf = (code: string) => matchedSummaries.find((s) => s.code === code)?.name ?? code
    const subjectName = subjectOptions.find((s) => s.code === accountCode)?.name ?? accountCode
    const amt = Number(amountInput)
    const summaryNames = [...selectedSummaries].map(nameOf).join('、')
    const ok = await confirm({
      title: '确认汇总抵消调整',
      description: `将把 ${summaryNames} 的 ${period} 科目「${subjectName}」叠加抵消金额 ${formatMoney(Math.abs(amt))}（${amt > 0 ? '调增' : '调减'}），共 ${selectedSummaries.size} 个汇总主体各建一条记录。此操作只影响汇总口径，单体报表不受影响，看板与指标将即时刷新。确认继续？`,
      danger: true,
      confirmText: '确认调整',
    })
    if (!ok) return
    setError(null)
    // 逐汇总主体创建（同科目/期间/金额/原因）；部分失败时已成功的记录保留，可在记录面板撤销
    const failed: string[] = []
    const succeeded: string[] = []
    for (const code of selectedSummaries) {
      try {
        await createMutation.mutateAsync({
          templateType: 'operating',
          summaryCompanyCode: code,
          accountCode,
          period,
          amount: amt,
          reason: reason.trim(),
        })
        succeeded.push(nameOf(code))
      } catch (err) {
        failed.push(`${nameOf(code)}（${err instanceof Error ? err.message : '失败'}）`)
      }
    }
    if (failed.length > 0) {
      setError(`部分汇总主体创建失败：${failed.join('；')}${succeeded.length > 0 ? `；已成功：${succeeded.join('、')}` : ''}`)
      return
    }
    setDone(`抵消调整已生效：${succeeded.join('、')} · ${subjectName} · ${period} · ${formatMoney(Math.abs(amt))}（${amt > 0 ? '调增' : '调减'}）。`)
    setPeriod('')
    setAmountInput('')
    setReason('')
    setAccountCode('')
    setMatchedSummaries([])
    setSelectedSummaries(new Set())
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-1.5">
            汇总抵消调整
            <TitleHint text="选择发生内部交易的两个单体公司，系统将按汇总映射自动匹配共同所属的汇总主体，在其口径上抵消重复计算的内部交易（如集团内现金流）；单体报表不受影响，可随时删除撤销。" />
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* ===== 第一步：选择单体公司 ===== */}
          <section className="space-y-2">
            <SectionTitle>1. 选择内部交易的两个单体公司</SectionTitle>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1">
                <Label htmlFor="ca-single-a">单体公司 A</Label>
                <Select value={singleA} onValueChange={(v) => { setSingleA(v); resetMatch() }}>
                  <SelectTrigger id="ca-single-a"><SelectValue placeholder="选择单体公司 A" /></SelectTrigger>
                  <SelectContent className="max-h-[280px]">
                    {entityCompanies.filter((c) => c.code !== singleB).map((c) => (
                      <SelectItem key={c.code} value={c.code}>{displayNameMap.get(c.code) ?? c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mx-auto h-9 w-9 shrink-0 text-muted-foreground sm:mx-0"
                aria-label="交换两个单体公司"
                title="交换两个单体公司"
                onClick={handleSwap}
                disabled={!singleA && !singleB}
              >
                <ArrowLeftRight className="h-4 w-4" />
              </Button>
              <div className="flex-1 space-y-1">
                <Label htmlFor="ca-single-b">单体公司 B</Label>
                <Select value={singleB} onValueChange={(v) => { setSingleB(v); resetMatch() }}>
                  <SelectTrigger id="ca-single-b"><SelectValue placeholder="选择单体公司 B" /></SelectTrigger>
                  <SelectContent className="max-h-[280px]">
                    {entityCompanies.filter((c) => c.code !== singleA).map((c) => (
                      <SelectItem key={c.code} value={c.code}>{displayNameMap.get(c.code) ?? c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={handleMatch} disabled={!singleA || !singleB || matchMutation.isPending} className="mt-1">
              <Link2 className="mr-1 h-4 w-4" />
              {matchMutation.isPending ? '匹配中...' : '匹配汇总主体'}
            </Button>
          </section>

          {/* ===== 第二步：匹配到的汇总主体（默认全选可取消） ===== */}
          {matchedSummaries.length > 0 && (
            <section className="space-y-2">
              <SectionTitle>2. 匹配到的汇总主体（作用于其汇总口径）</SectionTitle>
              <div className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
                {matchedSummaries.map((s) => (
                  <label key={s.code} className="flex cursor-pointer items-center gap-2 text-sm">
                    <Checkbox
                      size="sm"
                      className="shrink-0"
                      checked={selectedSummaries.has(s.code)}
                      onCheckedChange={() => toggleSummary(s.code)}
                    />
                    <span className="min-w-0 flex-1 truncate" title={s.code}>{s.name}</span>
                    {!s.isInternalElimination && (
                      <Badge variant="outline" className="shrink-0 text-micro text-muted-foreground">映射未标记内部抵消</Badge>
                    )}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">将按勾选的汇总主体分别创建抵消记录；两个单体无共同汇总主体时无法抵消。</p>
            </section>
          )}

          {/* ===== 第三步：抵消设置（科目/期间/金额） ===== */}
          <section className="space-y-2">
            <SectionTitle>3. 抵消设置（每个选中的汇总主体各建一条记录）</SectionTitle>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>调整期间（单月） <span className="text-destructive">*</span></Label>
                <MonthPicker className="w-full" value={period} onChange={(v) => { setPeriod(v); setError(null); setDone(null) }} availablePeriods={availablePeriods} placeholder="选择月份" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ca-amount">抵消金额（万元） <span className="text-destructive">*</span></Label>
                <Input
                  id="ca-amount"
                  type="number"
                  step="0.01"
                  placeholder="如 -100（负=调减、正=调增）"
                  value={amountInput}
                  aria-invalid={!!amountError}
                  className={cn(amountError && 'border-destructive focus-visible:ring-destructive')}
                  onChange={(e) => { setAmountInput(e.target.value); setError(null); setDone(null) }}
                />
                {amountError && <p className="text-xs text-destructive">{amountError}</p>}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">内部交易抵消通常为调减（负数）：汇总口径的现金流入/流出将被扣减该金额。</p>
            <div className="space-y-1">
              <Label>科目（data 类叶子，如现金流流入/流出） <span className="text-destructive">*</span></Label>
              <SubjectPicker
                options={subjectOptions}
                value={accountCode}
                onChange={(code) => { setAccountCode(code); setError(null); setDone(null) }}
                placeholder="选择要抵消的科目"
              />
              <p className="text-xs text-muted-foreground">计算类科目由公式计算、比率类科目不可调整，已从候选中排除。</p>
            </div>
          </section>

          {/* ===== 调整原因 ===== */}
          <section className="space-y-1">
            <Label htmlFor="ca-reason">调整原因 <span className="text-destructive">*</span></Label>
            <Textarea
              id="ca-reason"
              rows={2}
              placeholder="如：A 公司与 B 公司间内部资金划转，汇总口径抵消重复计入的经营活动现金流入/流出"
              value={reason}
              aria-invalid={!!reasonError}
              className={cn(reasonError && 'border-destructive focus-visible:ring-destructive')}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setReasonTouched(true)}
            />
            {reasonError && <p className="text-xs text-destructive">{reasonError}</p>}
          </section>

          {/* ===== 反馈 ===== */}
          <section className="space-y-2">
            {done && <FeedbackAlert kind="success">{done}</FeedbackAlert>}
            {error && <FeedbackAlert kind="error">{error}</FeedbackAlert>}
          </section>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose}>关闭</Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={createMutation.isPending || matchMutation.isPending}>
            {createMutation.isPending ? '提交中...' : '执行抵消调整'}
          </Button>
        </DialogFooter>
        {confirmElement}
      </DialogContent>
    </Dialog>
  )
}
