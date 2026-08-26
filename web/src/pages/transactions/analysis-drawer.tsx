import { useState } from 'react'
import { ChevronDown, ChevronUp, Save, Trash2, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SheetShell } from '@/components/ui/sheet-shell'
import { FlashMessage } from '@/components/ui/flash-message'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RichTextEditor } from '@/components/editor/rich-text-editor'
import { useCompanies, useTransactionAging } from '@/hooks/api-queries'
import { useAnalysisForm } from '@/hooks/use-analysis-form'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { cn, formatMoneyWan } from '@/lib/utils'
import type { AgingAnalysisRow } from '@/types'
import { AgingStackBar, agingRisk, AGING_GROUPS } from './shared'

/**
 * 往来单项分析抽屉：针对 公司 × 往来类型 × 期间 撰写/编辑/删除分析结论（subjectType='transaction'）。
 * 分析对象编码为 TXN_*（六大往来类型粒度），与经营/静态科目（OP_/ST_）编码空间隔离；
 * metricContext 快照该公司该类型的期末余额与 8 段账龄分布（来自 /transactions/aging）。
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

export function TransactionAnalysisDrawer({ open, target, onClose }: Props) {
  // 以 往来类型×期间×默认公司 为键重挂载表单：目标切换时所有 state 从零初始化，
  // 避免上一会话的公司/类型/正文残留（旧实现由 effect 异步重置 state，打开瞬间查询键仍命中旧缓存）。
  const targetKey = open && target ? `${target.transactionType ?? ''}|${target.period}|${target.defaultCompanyCode ?? ''}` : 'closed'
  if (!open || !target) return null
  return <TransactionDrawerBody key={targetKey} target={target} onClose={onClose} />
}

/** 抽屉表单主体：随 target 键重建；公司与往来类型初始值直接从 target 派生，抽屉内可再切换 */
function TransactionDrawerBody({ target, onClose }: { target: TransactionAnalysisTarget; onClose: () => void }) {
  const [companyCode, setCompanyCode] = useState(target.defaultCompanyCode ?? '')
  const [txnType, setTxnType] = useState(target.transactionType ?? '')
  // 账龄明细网格默认折叠：默认仅展示余额大数字 + 堆叠条 + 三段占比，展开后显示 4×2 明细网格
  const [agingExpanded, setAgingExpanded] = useState(false)

  const { data: companies } = useCompanies()
  const { getDisplayName, displayNameMap } = useCompanyDisplayName()
  const singleCompanies = (companies || []).filter((c) => c.entityType === 'single')

  const subjectCode = TXN_SUBJECT_CODE[txnType] ?? ''

  // 快照数据：该公司该类型的期末余额与 8 段账龄（groupBy=type 每公司一行）
  const { data: agingRows } = useTransactionAging(
    { companyCode: companyCode || undefined, transactionType: txnType || undefined, groupBy: 'type', period: target.period },
    { enabled: !!companyCode && !!txnType },
  )
  const snapshot = ((agingRows || []) as AgingAnalysisRow[]).find(
    (r) => r.companyCode === companyCode && r.transactionType === txnType,
  )

  const metricContext = snapshot
    ? { closingBalance: snapshot.closingBalance, aging: snapshot.aging, cutPeriod: target.period }
    : null

  // 表单状态机（既有查询回填/保存/删除）与指标抽屉共用；公司/类型切换触发重置
  const form = useAnalysisForm({
    fetchParams: { companyCode, subjectCode, period: target.period },
    fetchEnabled: !!companyCode && !!subjectCode,
    buildPayload: (title, content) => {
      if (!companyCode) throw new Error('请先选择公司')
      if (!txnType) throw new Error('请先选择往来类型')
      return {
        companyCode,
        subjectCode,
        subjectType: 'transaction',
        fiscalYear: target.period.slice(0, 4),
        period: target.period,
        title,
        content,
        metricContext,
      }
    },
    defaultTitle: () => {
      if (!companyCode || !txnType) return ''
      const companyLabel = displayNameMap.get(companyCode) ?? companyCode
      return `${companyLabel}${target.period}${txnType}分析`
    },
  })

  return (
    <>
      <SheetShell
        onClose={onClose}
        icon={<FileText className="mt-0.5 h-5 w-5 text-primary" />}
        title="往来单项分析"
        description={`${txnType || '请选择往来类型'} · ${target.period}`}
        footer={(
          <>
            <div>
              {form.existingId && (
                <Button variant="outline" size="sm" onClick={form.remove} disabled={form.busy} className="text-destructive">
                  <Trash2 className="mr-1 h-4 w-4" /> 删除
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onClose} disabled={form.busy}>取消</Button>
              <Button size="sm" onClick={form.save} disabled={form.busy || !companyCode || !txnType || !form.title.trim()}>
                <Save className="mr-1 h-4 w-4" /> 保存
              </Button>
            </div>
          </>
        )}
      >
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
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] text-muted-foreground">期末余额</span>
                    <span className="font-num text-lg font-bold text-foreground">
                      {formatMoneyWan(snapshot.closingBalance / 10000)}<span className="ml-0.5 text-xs font-normal text-muted-foreground">万</span>
                    </span>
                  </div>
                  <div className="mt-2">
                    <AgingStackBar aging={snapshot.aging} closingBalance={snapshot.closingBalance} />
                  </div>
                  {(() => {
                    const risk = agingRisk(snapshot.aging, snapshot.closingBalance)
                    const total = snapshot.closingBalance > 0 ? snapshot.closingBalance : 0
                    // 分段占比：与总览卡片口径一致（1年内 = 前 5 段、1-3年 = 5-7 段、3年+ = 末段）
                    const pct = (from: number, to: number) =>
                      total > 0 ? ((AGING_GROUPS.slice(from, to).reduce((s, b) => s + (snapshot.aging[b] ?? 0), 0) / total) * 100).toFixed(1) : '0.0'
                    return (
                      <>
                        <p className="mt-1.5 flex justify-between font-num text-[11px] text-muted-foreground">
                          <span>1年内 {pct(0, 5)}%</span>
                          <span>1-3年 {pct(5, 7)}%</span>
                          <span className={risk?.level === 'danger' ? 'text-destructive' : risk?.level === 'watch' ? 'text-warning-strong' : 'text-muted-foreground'}>
                            3年+ {pct(7, 8)}%
                          </span>
                        </p>
                        <button
                          type="button"
                          onClick={() => setAgingExpanded((v) => !v)}
                          className="mt-2 flex w-full items-center justify-center gap-1 rounded py-0.5 text-xs text-primary transition-colors hover:bg-muted"
                        >
                          {agingExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          {agingExpanded ? '收起账龄明细' : '展开账龄明细'}
                        </button>
                      </>
                    )
                  })()}
                  {agingExpanded && (
                    <div className="mt-2 grid grid-cols-4 gap-1.5 border-t border-border pt-2">
                      {AGING_GROUPS.map((g) => {
                        const v = snapshot.aging[g] ?? 0
                        const isDanger = g === '3年以上' && v > 0
                        return (
                          <div key={g} className={cn('rounded-md border px-1.5 py-1 text-center', isDanger ? 'border-destructive/30 bg-destructive/[0.06]' : 'border-border bg-background')}>
                            <p className="text-[10px] text-muted-foreground">{g}</p>
                            <p className={cn('font-num text-xs', isDanger ? 'font-medium text-destructive' : 'text-foreground')}>
                              {v !== 0 ? formatMoneyWan(v / 10000) : '-'}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  )}
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
              <Input id="txn-analysis-title" value={form.title} onChange={(e) => form.setTitle(e.target.value)} placeholder="如：华东公司应收账款分析" />
            </div>
            <div className="space-y-1.5">
              <Label>分析内容</Label>
              <RichTextEditor value={form.content} onChange={form.setContent} placeholder="撰写该往来类型的分析结论（余额构成、账龄结构、风险与催收建议等）…" polishEnabled />
            </div>
            {form.feedback && (
              <FlashMessage type={form.feedback.type === 'ok' ? 'success' : 'error'}>{form.feedback.msg}</FlashMessage>
            )}
          </div>
        </SheetShell>
        {form.confirmElement}
    </>
  )
}
