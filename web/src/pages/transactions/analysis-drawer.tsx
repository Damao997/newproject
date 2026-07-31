import { useEffect, useState } from 'react'
import { X, Save, Trash2, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RichTextEditor } from '@/components/editor/rich-text-editor'
import { useAnalyses, useCreateAnalysis, useUpdateAnalysis, useDeleteAnalysis, useCompanies, useTransactionAging } from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { formatMoneyWan } from '@/lib/utils'
import type { AgingAnalysisRow } from '@/types'

/**
 * 往来单项分析抽屉：针对 公司 × 往来类型 × 期间 撰写/编辑/删除分析结论（subjectType='transaction'）。
 * 分析对象编码为 TXN_*（六大往来类型粒度），与经营/静态科目（OP_/ST_）编码空间隔离；
 * metricContext 快照该公司该类型的期末余额与 5 段账龄分布（来自 /transactions/aging）。
 */

/** 六大往来类型 → 单项分析对象编码（与后端 TRANSACTION_SUBJECTS 保持一致） */
const TXN_SUBJECT_CODE: Record<string, string> = {
  应收账款: 'TXN_AR',
  其他应收款: 'TXN_AROT',
  预收账款: 'TXN_PER_AR',
  应付账款: 'TXN_AP',
  其他应付款: 'TXN_APOT',
  预付账款: 'TXN_PER_AP',
}

const AGING_GROUPS = ['1-3月', '4-6月', '半年以上', '1年至3年', '3年以上']
/** 往来类型选项（与 TXN_SUBJECT_CODE 键一致、固定展示顺序） */
const TXN_TYPE_OPTIONS = ['应收账款', '其他应收款', '预收账款', '应付账款', '其他应付款', '预付账款']

export interface TransactionAnalysisTarget {
  /** 预填往来类型；为空（如账龄"全部类型"）时由用户在抽屉内选择 */
  transactionType?: string
  period: string
  /** 筛选恰好单选一家公司时预填 */
  defaultCompanyCode?: string
}

interface Props {
  open: boolean
  target: TransactionAnalysisTarget | null
  onClose: () => void
}

function ContextChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-md border bg-muted/30 px-3 py-1.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="font-num text-[13px] text-foreground">{value}</span>
    </div>
  )
}

export function TransactionAnalysisDrawer({ open, target, onClose }: Props) {
  const [companyCode, setCompanyCode] = useState('')
  const [txnType, setTxnType] = useState('')
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [existingId, setExistingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)

  const { data: companies } = useCompanies()
  const { getDisplayName, displayNameMap } = useCompanyDisplayName()
  const singleCompanies = (companies || []).filter((c) => c.entityType === 'single')

  const subjectCode = TXN_SUBJECT_CODE[txnType] ?? ''

  // 打开时初始化公司与往来类型（从 target 预填）
  useEffect(() => {
    if (!open || !target) return
    setCompanyCode(target.defaultCompanyCode ?? '')
    setTxnType(target.transactionType ?? '')
    setFeedback(null)
  }, [open, target?.transactionType, target?.period, target?.defaultCompanyCode])

  // 读取该 公司×往来类型×期间 既有分析（幂等键与后端唯一键一致）
  const { data: existingData } = useAnalyses(
    open && target && companyCode && subjectCode
      ? { companyCode, subjectCode, period: target.period }
      : { companyCode: '__none__' },
  )
  const existing = existingData?.items?.[0]

  // 快照数据：该公司该类型的期末余额与 5 段账龄（groupBy=type 每公司一行）
  const { data: agingRows } = useTransactionAging(
    { companyCode: companyCode || undefined, transactionType: txnType || undefined, groupBy: 'type', period: target?.period },
    { enabled: open && !!companyCode && !!txnType },
  )
  const snapshot = ((agingRows || []) as AgingAnalysisRow[]).find(
    (r) => r.companyCode === companyCode && r.transactionType === txnType,
  )

  // 公司/类型/既有分析变化时回填表单
  useEffect(() => {
    if (!open || !target) return
    if (existing) {
      setExistingId(existing.id)
      setTitle(existing.title)
      setContent(existing.content)
    } else {
      setExistingId(null)
      const companyLabel = companyCode ? (displayNameMap.get(companyCode) ?? companyCode) : ''
      setTitle(companyCode && txnType ? `${companyLabel}${target.period}${txnType}分析` : '')
      setContent('')
    }
  }, [open, companyCode, txnType, existing?.id, target?.period])

  const createMutation = useCreateAnalysis()
  const updateMutation = useUpdateAnalysis()
  const deleteMutation = useDeleteAnalysis()
  const busy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending

  if (!open || !target) return null

  const metricContext = snapshot
    ? { closingBalance: snapshot.closingBalance, aging: snapshot.aging, cutPeriod: target.period }
    : null

  const handleSave = async () => {
    if (!companyCode) {
      setFeedback({ type: 'err', msg: '请先选择公司' })
      return
    }
    if (!txnType) {
      setFeedback({ type: 'err', msg: '请先选择往来类型' })
      return
    }
    setFeedback(null)
    try {
      if (existingId) {
        await updateMutation.mutateAsync({ id: existingId, data: { title, content, metricContext } })
        setFeedback({ type: 'ok', msg: '已保存修改' })
      } else {
        const created = await createMutation.mutateAsync({
          companyCode,
          subjectCode,
          subjectType: 'transaction',
          fiscalYear: target.period.slice(0, 4),
          period: target.period,
          title,
          content,
          metricContext,
        })
        setExistingId(created.id)
        setFeedback({ type: 'ok', msg: '已新增分析' })
      }
    } catch (e) {
      setFeedback({ type: 'err', msg: (e as Error).message || '保存失败' })
    }
  }

  const handleDelete = async () => {
    if (!existingId) return
    if (!window.confirm('确认删除该单项分析？删除后引用它的报告章节将标记为“原文已删除”。')) return
    setFeedback(null)
    try {
      await deleteMutation.mutateAsync(existingId)
      setExistingId(null)
      setContent('')
      setFeedback({ type: 'ok', msg: '已删除' })
    } catch (e) {
      setFeedback({ type: 'err', msg: (e as Error).message || '删除失败' })
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 animate-fade-in" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-xl flex-col border-l bg-background shadow-xl animate-in slide-in-from-right duration-200">
        {/* 头部 */}
        <div className="flex items-start justify-between border-b px-5 py-4">
          <div className="flex items-start gap-2">
            <FileText className="mt-0.5 h-5 w-5 text-primary" />
            <div>
              <h3 className="text-base font-semibold text-foreground">往来单项分析</h3>
              <p className="text-[13px] text-muted-foreground">
                {txnType || '请选择往来类型'} · {target.period}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 公司 + 往来类型选择 + 快照上下文 */}
        <div className="space-y-3 border-b px-5 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <Label className="shrink-0">分析公司</Label>
            <Select value={companyCode} onValueChange={setCompanyCode}>
              <SelectTrigger className="h-8 w-[220px]">
                <SelectValue placeholder="选择公司（必选）" />
              </SelectTrigger>
              <SelectContent>
                {singleCompanies.map((c) => (
                  <SelectItem key={c.code} value={c.code}>{getDisplayName(c.code, c.name)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Label className="shrink-0">往来类型</Label>
            <Select value={txnType} onValueChange={setTxnType}>
              <SelectTrigger className="h-8 w-[140px]">
                <SelectValue placeholder="选择类型（必选）" />
              </SelectTrigger>
              <SelectContent>
                {TXN_TYPE_OPTIONS.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {companyCode && txnType && (
            snapshot ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                <ContextChip label="期末余额(万)" value={formatMoneyWan(snapshot.closingBalance / 10000)} />
                {AGING_GROUPS.map((g) => (
                  <ContextChip key={g} label={`${g}(万)`} value={formatMoneyWan((snapshot.aging[g] ?? 0) / 10000)} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">该公司在 {target.period} 无{txnType}数据（仍可撰写分析）</p>
            )
          )}
        </div>

        {/* 表单 */}
        <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
          <div className="space-y-1.5">
            <Label htmlFor="txn-analysis-title">分析标题</Label>
            <Input id="txn-analysis-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如：华东公司应收账款分析" />
          </div>
          <div className="space-y-1.5">
            <Label>分析内容</Label>
            <RichTextEditor value={content} onChange={setContent} placeholder="撰写该往来类型的分析结论（余额构成、账龄结构、风险与催收建议等）…" polishEnabled />
          </div>
          {feedback && (
            <p className={feedback.type === 'ok' ? 'text-[13px] text-finance-green' : 'text-[13px] text-finance-red'}>{feedback.msg}</p>
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between border-t px-5 py-3">
          <div>
            {existingId && (
              <Button variant="outline" size="sm" onClick={handleDelete} disabled={busy} className="text-finance-red">
                <Trash2 className="mr-1 h-4 w-4" /> 删除
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onClose} disabled={busy}>取消</Button>
            <Button size="sm" onClick={handleSave} disabled={busy || !companyCode || !txnType || !title.trim()}>
              <Save className="mr-1 h-4 w-4" /> {existingId ? '保存修改' : '新增分析'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
