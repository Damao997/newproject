import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { useCompanies, useSubjects, usePreviewReclassifyCompany, useReclassifyCompany } from '@/hooks/api-queries'
import { formatMoney, cn } from '@/lib/utils'
import { AlertTriangle, Search } from 'lucide-react'

interface ReclassifyCompanyDialogProps {
  open: boolean
  onClose: () => void
  /** 预填模板类型（来自指标页当前标签） */
  defaultTemplateType?: 'operating' | 'static'
  /** 预填源公司（来自指标页当前主体） */
  defaultSourceCompany?: string
}

const TEMPLATE_LABEL: Record<string, string> = {
  operating: '经营数据',
  static: '静态数据',
  budget: '年度预算',
}

/**
 * 跨公司重分类对话框：把源公司某模板类型（可按科目/期间筛选）的生效数据转移到目标公司。
 * 支持三种转移方式：整体迁移（改挂行，冲突合并求和）、按比例/按金额部分转移
 * （源行调减保留，目标同口径行调增，无则新建）。提交前预览影响并二次确认。
 */
export function ReclassifyCompanyDialog({ open, onClose, defaultTemplateType = 'operating', defaultSourceCompany }: ReclassifyCompanyDialogProps) {
  const [templateType, setTemplateType] = useState<string>(defaultTemplateType)
  const [sourceCompanyCode, setSourceCompanyCode] = useState<string>(defaultSourceCompany ?? '')
  const [targetCompanyCode, setTargetCompanyCode] = useState<string>('')
  const [transferMode, setTransferMode] = useState<'all' | 'ratio' | 'amount'>('all')
  const [ratioInput, setRatioInput] = useState('')
  const [amountInput, setAmountInput] = useState('')
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')
  const [subjectFilterOpen, setSubjectFilterOpen] = useState(false)
  const [subjectKeyword, setSubjectKeyword] = useState('')
  const [selectedSubjects, setSelectedSubjects] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<{ affectedRows: number; totalValue: number; transferValue: number; conflictRows: number; createRows: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const { confirm, element: confirmElement } = useConfirm()
  const { data: companies } = useCompanies()
  const entityCompanies = useMemo(() => (companies ?? []).filter((c) => c.type === 'entity'), [companies])

  // 科目候选：静态模板取静态科目，否则取经营科目
  const subjectType = templateType === 'static' ? 'static' : 'operating'
  const { data: subjectsData } = useSubjects({ type: subjectType, pageSize: 1000 })
  const subjectOptions = useMemo(() => {
    const kw = subjectKeyword.trim().toLowerCase()
    const items = subjectsData?.items ?? []
    return kw ? items.filter((s) => s.name.toLowerCase().includes(kw) || s.code.toLowerCase().includes(kw)) : items
  }, [subjectsData, subjectKeyword])

  const previewMutation = usePreviewReclassifyCompany()
  const reclassifyMutation = useReclassifyCompany()

  const buildPayload = () => ({
    templateType,
    sourceCompanyCode,
    targetCompanyCode,
    accountCodes: selectedSubjects.size > 0 ? [...selectedSubjects] : undefined,
    periodFrom: periodFrom || undefined,
    periodTo: periodTo || undefined,
    transferMode,
    ratio: transferMode === 'ratio' ? Number(ratioInput) / 100 : undefined,
    amount: transferMode === 'amount' ? Number(amountInput) : undefined,
  })

  const reset = () => {
    setPreview(null)
    setError(null)
    setDone(null)
  }

  const validateTransferInput = (): string | null => {
    if (transferMode === 'ratio') {
      const pct = Number(ratioInput)
      if (!ratioInput || !Number.isFinite(pct) || pct <= 0 || pct > 100) return '请输入 0-100 之间的转移比例'
    }
    if (transferMode === 'amount') {
      const amt = Number(amountInput)
      if (!amountInput || !Number.isFinite(amt) || amt <= 0) return '请输入大于 0 的转移金额'
    }
    return null
  }

  const handlePreview = async () => {
    setError(null)
    setDone(null)
    setPreview(null)
    if (!sourceCompanyCode || !targetCompanyCode) {
      setError('请选择源公司与目标公司')
      return
    }
    if (sourceCompanyCode === targetCompanyCode) {
      setError('源公司与目标公司不能相同')
      return
    }
    const inputError = validateTransferInput()
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

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>跨公司数据重分类</DialogTitle>
          <DialogDescription>将源公司已生效的数据改挂到目标公司，看板与指标将即时刷新。</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>模板类型</Label>
            <Select value={templateType} onValueChange={(v) => { setTemplateType(v); reset(); setSelectedSubjects(new Set()) }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="operating">经营数据</SelectItem>
                <SelectItem value="static">静态数据</SelectItem>
                <SelectItem value="budget">年度预算</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>源公司</Label>
              <Select value={sourceCompanyCode} onValueChange={(v) => { setSourceCompanyCode(v); reset() }}>
                <SelectTrigger><SelectValue placeholder="选择源公司" /></SelectTrigger>
                <SelectContent className="max-h-[280px]">
                  {entityCompanies.map((c) => (
                    <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>目标公司</Label>
              <Select value={targetCompanyCode} onValueChange={(v) => { setTargetCompanyCode(v); reset() }}>
                <SelectTrigger><SelectValue placeholder="选择目标公司" /></SelectTrigger>
                <SelectContent className="max-h-[280px]">
                  {entityCompanies.filter((c) => c.code !== sourceCompanyCode).map((c) => (
                    <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>转移方式</Label>
              <Select value={transferMode} onValueChange={(v) => { setTransferMode(v as 'all' | 'ratio' | 'amount'); reset() }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">整体迁移</SelectItem>
                  <SelectItem value="ratio">按比例部分转移</SelectItem>
                  <SelectItem value="amount">按金额部分转移</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {transferMode === 'ratio' && (
              <div className="space-y-1">
                <Label>转移比例（%）</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  placeholder="如 30"
                  value={ratioInput}
                  onChange={(e) => { setRatioInput(e.target.value); reset() }}
                />
              </div>
            )}
            {transferMode === 'amount' && (
              <div className="space-y-1">
                <Label>转移金额（元）</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="如 100000"
                  value={amountInput}
                  onChange={(e) => { setAmountInput(e.target.value); reset() }}
                />
              </div>
            )}
          </div>
          {transferMode !== 'all' && (
            <p className="text-xs text-muted-foreground">部分转移：源公司明细调减并保留，目标公司同口径明细调增（无则新建），总额不变。{transferMode === 'amount' && '按金额模式将按各明细金额占比分摊。'}</p>
          )}

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
            <button
              type="button"
              className="text-sm text-primary hover:underline"
              onClick={() => setSubjectFilterOpen((v) => !v)}
            >
              {subjectFilterOpen ? '收起科目筛选' : '按科目筛选（可选）'}
              {selectedSubjects.size > 0 && `（已选 ${selectedSubjects.size} 个）`}
            </button>
            {subjectFilterOpen && (
              <div className="space-y-2 rounded-md border p-2">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="搜索科目名称或编码..." value={subjectKeyword} onChange={(e) => setSubjectKeyword(e.target.value)} className="pl-8" />
                </div>
                <div className="max-h-[180px] space-y-1 overflow-y-auto">
                  {subjectOptions.map((s) => (
                    <label key={s.code} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted">
                      <input type="checkbox" checked={selectedSubjects.has(s.code)} onChange={() => toggleSubject(s.code)} />
                      <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
                      <span>{s.name}</span>
                    </label>
                  ))}
                  {subjectOptions.length === 0 && <p className="py-2 text-center text-xs text-muted-foreground">无匹配科目</p>}
                </div>
              </div>
            )}
          </div>

          {preview && (
            <div className={cn('rounded-lg border p-3 text-sm', preview.affectedRows === 0 ? 'border-muted bg-muted/30' : 'border-blue-200 bg-blue-50')}>
              {preview.affectedRows === 0 ? (
                <p className="text-muted-foreground">当前筛选条件下没有可重分类的数据。</p>
              ) : (
                <div className="space-y-1">
                  {transferMode === 'all' ? (
                    <p className="text-blue-800">
                      将迁移 <span className="font-semibold">{preview.affectedRows}</span> 条明细，合计{' '}
                      <span className="font-mono font-semibold">{formatMoney(preview.totalValue)}</span>。
                    </p>
                  ) : (
                    <p className="text-blue-800">
                      将从 <span className="font-semibold">{preview.affectedRows}</span> 条明细（合计{' '}
                      <span className="font-mono font-semibold">{formatMoney(preview.totalValue)}</span>）中转移{' '}
                      <span className="font-mono font-semibold">{formatMoney(preview.transferValue)}</span>，源公司保留剩余金额。
                    </p>
                  )}
                  {preview.conflictRows > 0 && (
                    <p className="flex items-center gap-1 text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      其中 {preview.conflictRows} 条将与目标公司现有数据{transferMode === 'all' ? '合并求和' : '累加'}。
                    </p>
                  )}
                  {transferMode !== 'all' && preview.createRows > 0 && (
                    <p className="text-blue-700">将新建 {preview.createRows} 条目标公司明细。</p>
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
          <Button variant="outline" onClick={handlePreview} disabled={previewMutation.isPending || !sourceCompanyCode || !targetCompanyCode}>
            {previewMutation.isPending ? '预览中...' : '预览影响'}
          </Button>
          <Button variant="destructive" onClick={handleSubmit} disabled={!preview || preview.affectedRows === 0 || reclassifyMutation.isPending}>
            {reclassifyMutation.isPending ? '重分类中...' : '执行重分类'}
          </Button>
        </DialogFooter>
        {confirmElement}
      </DialogContent>
    </Dialog>
  )
}
