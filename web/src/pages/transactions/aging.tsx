import { useCallback, useMemo, useState } from 'react'
import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { TRANSACTION_TABS } from '@/components/layout/module-tabs'
import { FilterBar } from '@/components/layout/filter-bar'
import { FILTER_WIDTH } from '@/components/layout/filter-width'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { api } from '@/lib/api'
import { downloadBlob } from '@/lib/export'
import { cn, formatWan } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { useTransactionAging } from '@/hooks/api-queries'
import { usePageStore, type TransactionAgingState } from '@/stores/pageStateStore'
import { usePeriodStore } from '@/stores/periodStore'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { TransactionAnalysisDrawer } from './analysis-drawer'
import { PartyTypeSelect, PartyTypeTag, AccountMultiSelect, AgingStackBar, AGING_GROUPS, TRANSACTION_TYPES } from './shared'
import { AlertTriangle, Download, FileText, RefreshCw, Search } from 'lucide-react'
import type { AgingAnalysisRow } from '@/types'

/**
 * 往来账龄分析：公司/期间跟随顶部 Header 全局筛选（periodStore），页面内保留往来类型 +
 * 科目多选 + 对象类型多选 + 客商关键词 + 分组方式（type/counterparty/account）下的
 * 账龄分桶（8 段）矩阵；「仅显示小计」持久化到 pageStateStore（展开/收起明细行）；
 * Excel 导出带进度（transactions:export）；行级「单项分析」挂载往来分析抽屉。数据：GET /transactions/aging。
 */

const GROUP_BY_OPTIONS = [
  { value: 'type', label: '按往来类型' },
  { value: 'counterparty', label: '按往来客商' },
  { value: 'account', label: '按会计科目' },
] as const

function fmtAmount(v: number): string {
  return v.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

export default function TransactionsAgingPage() {
  // 页面特有筛选持久化（切路由/刷新后恢复）：含 groupBy 与 subtotalOnly（明细展开状态）
  const setTransactionsTab = usePageStore((s) => s.setTransactionsTab)
  const typeFilter = usePageStore((s) => s.transactions.aging.type)
  const accounts = usePageStore((s) => s.transactions.aging.accounts)
  const party = usePageStore((s) => s.transactions.aging.party)
  const groupBy = usePageStore((s) => s.transactions.aging.groupBy)
  const subtotalOnly = usePageStore((s) => s.transactions.aging.subtotalOnly)
  const keyword = usePageStore((s) => s.transactions.aging.keyword)
  const setAging = useCallback(
    (patch: Partial<TransactionAgingState>) => setTransactionsTab('aging', patch),
    [setTransactionsTab],
  )

  // 全局筛选：公司/期间由顶部 Header 写入（companyCodes null/[] = 全部公司，period null = 未选择）
  const companies = usePeriodStore((s) => s.companyCodes)
  const period = usePeriodStore((s) => s.period)

  const { can } = usePermission()
  const canExport = can('transactions', 'export')

  // 查询参数（与导出共用同一口径）
  const agingParams = useMemo(
    () => ({
      companyCode: companies && companies.length > 0 ? companies.join(',') : undefined,
      transactionType: typeFilter || undefined,
      groupBy,
      period: period || undefined,
      accountCodes: accounts.length > 0 ? accounts.join(',') : undefined,
      partyType: party.length > 0 ? party.join(',') : undefined,
      counterpartyKeyword: keyword.trim() || undefined,
    }),
    [companies, typeFilter, groupBy, period, accounts, party, keyword],
  )

  const { data, isLoading, isError, error, refetch, isFetching } = useTransactionAging(agingParams)
  const rows = data ?? []

  // ===== Excel 导出（带下载进度；与查询同口径 + subtotalOnly） =====
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportError, setExportError] = useState('')

  const handleExport = async () => {
    setExporting(true)
    setExportProgress(0)
    setExportError('')
    try {
      const blob = await api.exportTransactionAging({ ...agingParams, subtotalOnly }, (p) => setExportProgress(p))
      await downloadBlob(blob, `账龄分析_${period || '全部期间'}.xlsx`)
    } catch (e) {
      setExportError(e instanceof Error ? e.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

  // ===== 前端分组：组键与组名随 groupBy 变化，组内按余额降序，组间按小计降序 =====
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; rows: AgingAnalysisRow[]; closing: number }>()
    for (const r of rows) {
      const key =
        groupBy === 'type'
          ? r.transactionType
          : groupBy === 'counterparty'
            ? `${r.counterpartyCode ?? '-'}|${r.counterpartyName ?? ''}`
            : `${r.accountCode ?? '-'}|${r.accountDesc ?? ''}`
      const name =
        groupBy === 'type'
          ? r.transactionType
          : groupBy === 'counterparty'
            ? r.counterpartyName || r.counterpartyCode || '未知客商'
            : r.accountDesc || r.accountCode || '未知科目'
      if (!map.has(key)) map.set(key, { name, rows: [], closing: 0 })
      const g = map.get(key)!
      g.rows.push(r)
      g.closing += r.closingBalance
    }
    for (const g of map.values()) g.rows.sort((a, b) => b.closingBalance - a.closingBalance)
    return [...map.values()].sort((a, b) => b.closing - a.closing)
  }, [rows, groupBy])

  const totalClosing = rows.reduce((s, r) => s + r.closingBalance, 0)
  const agingTotal = (pred: (b: string) => boolean) =>
    rows.reduce((s, r) => s + AGING_GROUPS.filter(pred).reduce((ss, b) => ss + (r.aging[b] ?? 0), 0), 0)
  const within1y = agingTotal((b) => AGING_GROUPS.indexOf(b) < 5)
  const y1to3 = agingTotal((b) => AGING_GROUPS.indexOf(b) >= 5 && AGING_GROUPS.indexOf(b) < 7)
  const over3y = agingTotal((b) => b === '3年以上')

  // 分析抽屉目标：行级触发，预填该行类型与公司
  const [analysisTarget, setAnalysisTarget] = useState<{ transactionType: string; companyCode: string } | null>(null)

  return (
    <PageContainer
      title="账龄分析"
      description="按 8 段账龄拆解往来余额，支持类型 / 客商 / 科目分组与 Excel 导出"
      stickyHeader
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', isFetching && 'animate-spin')} />
            刷新
          </Button>
          {canExport && (
            <Button size="sm" disabled={exporting} onClick={handleExport}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              {exporting ? `导出中 ${exportProgress}%` : '导出 Excel'}
            </Button>
          )}
        </div>
      }
    >
      <SubPageTabs items={TRANSACTION_TABS} />

      {/* 筛选卡（吸顶）：页面特有筛选（公司/期间已上收顶部 Header 全局筛选） */}
      <Card className="rounded-card border border-border p-4">
        <FilterBar>
          <Select value={typeFilter || 'all'} onValueChange={(v) => setAging({ type: v === 'all' ? '' : v, accounts: [] })}>
            <SelectTrigger className="h-9 w-[130px]">
              <SelectValue placeholder="往来类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              {TRANSACTION_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{t}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <AccountMultiSelect value={accounts} onChange={(v) => setAging({ accounts: v })} transactionType={typeFilter || undefined} />
          <PartyTypeSelect value={party} onChange={(v) => setAging({ party: v })} />
          <Select value={groupBy} onValueChange={(v) => setAging({ groupBy: v })}>
            <SelectTrigger className="h-9 w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUP_BY_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="搜索客商..."
              className={cn('h-9 pl-8', FILTER_WIDTH.medium)}
              value={keyword}
              onChange={(e) => setAging({ keyword: e.target.value })}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground">
            <Checkbox checked={subtotalOnly} onCheckedChange={(v) => setAging({ subtotalOnly: v === true })} />
            仅显示小计
          </label>
        </FilterBar>
        {(exportError || exporting) && (
          <div className="mt-2">
            {exportError ? (
              <p className="flex items-center gap-1 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                {exportError}
              </p>
            ) : (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${exportProgress}%` }} />
              </div>
            )}
          </div>
        )}
      </Card>

      {/* 汇总条：总余额 + 三段账龄占比 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Card className="rounded-card p-4">
          <p className="text-sm text-muted-foreground">期末余额合计</p>
          <p className="mt-1 font-num text-2xl font-semibold tabular-nums text-foreground">
            {isLoading ? <Skeleton className="h-8 w-28" /> : <>{formatWan(totalClosing)}<span className="ml-1 text-sm font-normal text-muted-foreground">万</span></>}
          </p>
        </Card>
        {[
          { label: '1 年内', value: within1y, cls: 'text-foreground' },
          { label: '1-3 年', value: y1to3, cls: 'text-warning-strong' },
          { label: '3 年以上', value: over3y, cls: totalClosing > 0 && over3y > 0 ? 'text-destructive' : 'text-foreground' },
        ].map((s) => (
          <Card key={s.label} className="rounded-card p-4">
            <p className="text-sm text-muted-foreground">{s.label}</p>
            <p className={cn('mt-1 font-num text-2xl font-semibold tabular-nums', s.cls)}>
              {isLoading ? <Skeleton className="h-8 w-24" /> : <>{formatWan(s.value)}<span className="ml-1 text-sm font-normal text-muted-foreground">万{totalClosing > 0 ? ` · ${((s.value / totalClosing) * 100).toFixed(1)}%` : ''}</span></>}
            </p>
          </Card>
        ))}
      </div>

      {/* 分组账龄矩阵 */}
      <Card className="rounded-card border border-border overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
          <h3 className="text-base font-semibold tracking-tight">
            账龄明细（{GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label}）
          </h3>
          <span className="text-xs text-muted-foreground">
            {groups.length} 组 · {rows.length} 行{period ? ` · 期间 ${period}` : ''}
          </span>
        </div>
        <div className="overflow-x-auto">
          {isError ? (
            <div className="flex flex-col items-center gap-3 py-10">
              <p className="text-sm text-destructive">{error instanceof Error ? error.message : '数据加载失败'}</p>
              <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                重试
              </Button>
            </div>
          ) : isLoading ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              当前筛选条件下暂无账龄数据，请调整筛选或先导入并激活批次
            </p>
          ) : (
            <table className="w-full text-sm tabular-nums" style={{ minWidth: 1180 }}>
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-3 py-2 text-left font-medium">公司</th>
                  <th className="px-3 py-2 text-left font-medium">往来类型</th>
                  <th className="px-3 py-2 text-left font-medium">{groupBy === 'account' ? '会计科目' : groupBy === 'counterparty' ? '往来客商' : '明细维度'}</th>
                  <th className="px-3 py-2 text-center font-medium">对象</th>
                  <th className="px-3 py-2 text-right font-medium">期末余额</th>
                  {AGING_GROUPS.map((g) => (
                    <th key={g} className="px-2 py-2 text-right font-medium whitespace-nowrap">{g}</th>
                  ))}
                  <th className="px-3 py-2 text-center font-medium">分析</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g, gi) => (
                  <AgingGroupBlock
                    key={`${g.name}-${gi}`}
                    group={g}
                    groupBy={groupBy}
                    subtotalOnly={subtotalOnly}
                    onAnalyze={(row) => setAnalysisTarget({ transactionType: row.transactionType, companyCode: row.companyCode })}
                  />
                ))}
                {/* 合计行 */}
                <tr className="border-t-2 bg-muted/40 font-medium">
                  <td className="px-3 py-2" colSpan={4}>合计 · {groups.length} 组</td>
                  <td className="px-3 py-2 text-right font-num">{fmtAmount(totalClosing)}</td>
                  {AGING_GROUPS.map((g) => (
                    <td key={g} className="px-2 py-2 text-right font-num">
                      {rows.reduce((s, r) => s + (r.aging[g] ?? 0), 0) !== 0
                        ? fmtAmount(rows.reduce((s, r) => s + (r.aging[g] ?? 0), 0))
                        : '-'}
                    </td>
                  ))}
                  <td className="px-3 py-2" />
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <TransactionAnalysisDrawer
        open={analysisTarget !== null}
        target={analysisTarget
          ? { transactionType: analysisTarget.transactionType, period: period ?? '', defaultCompanyCode: analysisTarget.companyCode }
          : null}
        onClose={() => setAnalysisTarget(null)}
      />
    </PageContainer>
  )
}

/** 组块：组头（小计 + 堆叠条）+ 明细行（subtotalOnly 时隐藏，组头保留） */
function AgingGroupBlock({ group, groupBy, subtotalOnly, onAnalyze }: {
  group: { name: string; rows: AgingAnalysisRow[]; closing: number }
  groupBy: string
  subtotalOnly: boolean
  onAnalyze: (row: AgingAnalysisRow) => void
}) {
  const { getDisplayName } = useCompanyDisplayName()
  return (
    <>
      {/* 组头（小计） */}
      <tr className="border-b bg-muted/30">
        <td className="px-3 py-2 font-medium" colSpan={4}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-foreground">{group.name}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
              {subtotalOnly ? `${group.rows.length} 行` : '含明细'}
            </span>
          </div>
        </td>
        <td className="px-3 py-2 text-right font-num font-semibold">{fmtAmount(group.closing)}</td>
        {AGING_GROUPS.map((b) => (
          <td key={b} className="px-2 py-2 text-right font-num text-muted-foreground">
            {group.rows.reduce((s, r) => s + (r.aging[b] ?? 0), 0) !== 0
              ? fmtAmount(group.rows.reduce((s, r) => s + (r.aging[b] ?? 0), 0))
              : '-'}
          </td>
        ))}
        <td className="px-3 py-2" />
      </tr>
      {/* 明细行 */}
      {!subtotalOnly && group.rows.map((r, i) => {
        const rowKey = `${r.companyCode}|${r.transactionType}|${r.counterpartyCode ?? ''}|${r.accountCode ?? ''}|${i}`
        return (
          <tr key={rowKey} className="group border-b last:border-b-0 hover:bg-muted/40">
            <td className="px-3 py-2" title={r.companyCode}>{getDisplayName(r.companyCode, r.companyName ?? undefined)}</td>
            <td className="px-3 py-2">{r.transactionType}</td>
            <td className="px-3 py-2">
              {groupBy === 'account'
                ? (r.accountDesc || r.accountCode || '-')
                : groupBy === 'counterparty'
                  ? (r.counterpartyName || r.counterpartyCode || '-')
                  : (r.counterpartyName || r.counterpartyCode || r.accountDesc || r.accountCode || '-')}
            </td>
            <td className="px-3 py-2 text-center">
              {r.partyType ? <PartyTypeTag partyType={r.partyType} /> : <span className="text-xs text-muted-foreground">-</span>}
            </td>
            <td className="px-3 py-2 text-right font-num font-medium">{fmtAmount(r.closingBalance)}</td>
            {AGING_GROUPS.map((b) => {
              const v = r.aging[b] ?? 0
              return (
                <td key={b} className={cn('px-2 py-2 text-right', v !== 0 && b === '3年以上' && 'font-medium text-destructive')}>
                  {v !== 0 ? fmtAmount(v) : '-'}
                </td>
              )
            })}
            <td className="px-3 py-2 text-center">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-primary"
                onClick={() => onAnalyze(r)}
              >
                <FileText className="mr-1 h-3 w-3" />
                分析
              </Button>
            </td>
          </tr>
        )
      })}
      {/* 组头附堆叠条（明细隐藏时直观展示账龄结构） */}
      {subtotalOnly && (
        <tr className="border-b">
          <td colSpan={4 + 1 + AGING_GROUPS.length + 1} className="px-3 pb-2">
            <AgingStackBar
              aging={group.rows.reduce<Record<string, number>>((acc, r) => {
                for (const b of AGING_GROUPS) acc[b] = (acc[b] ?? 0) + (r.aging[b] ?? 0)
                return acc
              }, {})}
              closingBalance={group.closing}
            />
          </td>
        </tr>
      )}
    </>
  )
}
