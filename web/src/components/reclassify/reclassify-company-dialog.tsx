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
 * 跨公司重分类对话框：把源公司某模板类型（可按科目/期间筛选）的生效数据改挂到目标公司。
 * 目标公司已存在同口径数据时合并求和。提交前预览影响并二次确认。
 */
export function ReclassifyCompanyDialog({ open, onClose, defaultTemplateType = 'operating', defaultSourceCompany }: ReclassifyCompanyDialogProps) {
  const [templateType, setTemplateType] = useState<string>(defaultTemplateType)
  const [sourceCompanyCode, setSourceCompanyCode] = useState<string>(defaultSourceCompany ?? '')
  const [targetCompanyCode, setTargetCompanyCode] = useState<string>('')
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')
  const [subjectFilterOpen, setSubjectFilterOpen] = useState(false)
  const [subjectKeyword, setSubjectKeyword] = useState('')
  const [selectedSubjects, setSelectedSubjects] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<{ affectedRows: number; totalValue: number; conflictRows: number } | null>(null)
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
  })

  const reset = () => {
    setPreview(null)
    setError(null)
    setDone(null)
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
    const ok = await confirm({
      title: '确认跨公司重分类',
      description: `将把「${sourceName}」的 ${preview.affectedRows} 条${TEMPLATE_LABEL[templateType]}明细（合计 ${formatMoney(preview.totalValue)}）改挂到「${targetName}」${preview.conflictRows > 0 ? `，其中 ${preview.conflictRows} 条将与目标公司现有数据合并求和` : ''}。此操作将影响看板与指标且不可撤销，确认继续？`,
      danger: true,
      confirmText: '确认重分类',
    })
    if (!ok) return
    setError(null)
    try {
      const res = await reclassifyMutation.mutateAsync(buildPayload())
      setDone(`重分类完成：迁移 ${res.affectedRows} 条明细${res.mergedRows > 0 ? `，其中 ${res.mergedRows} 条已合并` : ''}。`)
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
                  <p className="text-blue-800">
                    将迁移 <span className="font-semibold">{preview.affectedRows}</span> 条明细，合计{' '}
                    <span className="font-mono font-semibold">{formatMoney(preview.totalValue)}</span>。
                  </p>
                  {preview.conflictRows > 0 && (
                    <p className="flex items-center gap-1 text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      其中 {preview.conflictRows} 条将与目标公司现有数据合并求和。
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
