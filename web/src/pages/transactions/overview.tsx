import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { TRANSACTION_TABS } from '@/components/layout/module-tabs'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useTransactionOverview } from '@/hooks/api-queries'
import { usePageStore, type TransactionOverviewState } from '@/stores/pageStateStore'
import { usePeriodStore } from '@/stores/periodStore'
import { usePermission } from '@/hooks/usePermission'
import { TransactionImportDialog } from '@/pages/data/transaction-import-dialog'
import { TransactionTrendCard } from './trend-card'
import { TransactionAnalysisDrawer } from './analysis-drawer'
import { PartyTypeSelect, PartyTypeTag, AgingStackBar, agingRisk, AGING_GROUPS } from './shared'
import { cn, formatMoneyWan } from '@/lib/utils'
import { ArrowRight, FileText, RefreshCw, Upload } from 'lucide-react'
import type { TransactionOverviewItem } from '@/types'

/**
 * 往来总览：公司/期间跟随顶部 Header 全局筛选（periodStore：companyCodes null/[] = 全部公司，
 * period null = 未选择期间），页面内仅保留对象类型多选筛选；
 * 六大往来类型汇总（期末余额/笔数/账龄结构）+ 往来变动趋势卡。
 * 数据：GET /transactions/overview；对象类型等页面特有筛选持久化 pageStateStore.transactions.overview。
 */

const TRANSACTION_TYPES = ['应收账款', '其他应收款', '预收账款', '应付账款', '其他应付款', '预付账款']

const DIRECTION_LABELS: Record<string, string> = { AR: '应收方向', AP: '应付方向' }

function directionLabel(direction: string): string {
  return DIRECTION_LABELS[direction] ?? direction
}

export default function TransactionsOverviewPage() {
  // 页面特有筛选持久化（切路由/刷新后恢复）：对象类型多选
  const setTransactionsTab = usePageStore((s) => s.setTransactionsTab)
  const party = usePageStore((s) => s.transactions.overview.party)
  const setOverview = useCallback(
    (patch: Partial<TransactionOverviewState>) => setTransactionsTab('overview', patch),
    [setTransactionsTab],
  )

  // 全局筛选：公司/期间由顶部 Header 写入（companyCodes null/[] = 全部公司，period null = 未选择）
  const companies = usePeriodStore((s) => s.companyCodes)
  const period = usePeriodStore((s) => s.period)

  const { can } = usePermission()
  const canImport = can('transactions', 'import')

  const { data, isLoading, isError, error, refetch, isFetching } = useTransactionOverview({
    companyCodes: companies ?? [],
    period: period || undefined,
    partyType: party,
  })

  const [importOpen, setImportOpen] = useState(false)

  const rows = useMemo(() => {
    const list = data ?? []
    return [...list].sort((a, b) => TRANSACTION_TYPES.indexOf(a.transactionType) - TRANSACTION_TYPES.indexOf(b.transactionType))
  }, [data])

  const totalClosing = rows.reduce((s, r) => s + r.totalClosingBalance, 0)
  const totalRecords = rows.reduce((s, r) => s + r.recordCount, 0)
  // 长账龄（3年+）余额与类型数（跨六类型汇总）
  const longAging = rows.reduce((s, r) => s + (r.aging['3年以上'] ?? 0), 0)
  const riskyTypes = rows.filter((r) => (r.aging['3年以上'] ?? 0) > 0).length

  return (
    <PageContainer
      title="往来总览"
      description="应收 / 应付 / 预收 / 预付等往来余额汇总，多维度账龄结构一览"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', isFetching && 'animate-spin')} />
            刷新
          </Button>
          {canImport && (
            <Button size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="mr-1.5 h-3.5 w-3.5" />
              导入
            </Button>
          )}
        </div>
      }
    >
      <SubPageTabs items={TRANSACTION_TABS} />

      {/* 筛选卡（吸顶）：对象类型多选（公司/期间已上收顶部 Header 全局筛选） */}
      <Card className="sticky top-0 z-10 rounded-card border border-border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <PartyTypeSelect value={party} onChange={(v) => setOverview({ party: v })} />
          {period && (
            <span className="text-xs text-muted-foreground">当前期间：{period}</span>
          )}
        </div>
      </Card>

      {/* 汇总条：期末余额合计 / 笔数合计 / 3年+ 长账龄 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card className="rounded-card p-4">
          <p className="text-sm text-muted-foreground">期末余额合计</p>
          <p className="mt-1 font-num text-2xl font-semibold tabular-nums text-foreground">
            {isLoading ? <Skeleton className="h-8 w-28" /> : <>{formatMoneyWan(totalClosing / 10000)}<span className="ml-1 text-sm font-normal text-muted-foreground">万</span></>}
          </p>
        </Card>
        <Card className="rounded-card p-4">
          <p className="text-sm text-muted-foreground">记录笔数合计</p>
          <p className="mt-1 font-num text-2xl font-semibold tabular-nums text-foreground">
            {isLoading ? <Skeleton className="h-8 w-20" /> : totalRecords.toLocaleString('zh-CN')}
          </p>
        </Card>
        <Card className="rounded-card p-4">
          <p className="text-sm text-muted-foreground">3 年以上长账龄</p>
          <p className={cn('mt-1 font-num text-2xl font-semibold tabular-nums', longAging > 0 ? 'text-destructive' : 'text-foreground')}>
            {isLoading ? <Skeleton className="h-8 w-28" /> : <>{formatMoneyWan(longAging / 10000)}<span className="ml-1 text-sm font-normal text-muted-foreground">万 · {riskyTypes} 个类型</span></>}
          </p>
        </Card>
      </div>

      {/* 六大往来类型汇总卡 */}
      {isError ? (
        <Card className="rounded-card border border-border p-8">
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-destructive">{error instanceof Error ? error.message : '数据加载失败'}</p>
            <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              重试
            </Button>
          </div>
        </Card>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="rounded-card p-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-3 h-8 w-36" />
              <Skeleton className="mt-3 h-1.5 w-full" />
              <Skeleton className="mt-3 h-3 w-32" />
            </Card>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Card className="rounded-card border border-border p-8">
          <p className="text-center text-sm text-muted-foreground">
            当前筛选条件下暂无往来数据，请调整筛选或先在「导入覆盖」页导入并激活批次
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <TypeSummaryCard key={row.transactionType} row={row} period={period ?? ''} />
          ))}
        </div>
      )}

      {/* 往来变动趋势（独立筛选：类型/期间范围/CSV 导出，卡内持久化） */}
      <TransactionTrendCard companyCodes={companies ?? []} />

      {/* 去往账龄分析入口 */}
      <Card className="rounded-card border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            需要按 客商 / 科目 维度拆解账龄，或管理科目纳入范围？
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/transactions/aging">
                账龄分析
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/transactions/coverage">
                导入覆盖
                <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </Card>

      <TransactionImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </PageContainer>
  )
}

/** 单类型汇总卡：期末余额 + 笔数（内部/外部）+ 账龄堆叠条 + 风险提示 + 分析入口 */
function TypeSummaryCard({ row, period }: { row: TransactionOverviewItem; period: string }) {
  const companies = usePeriodStore((s) => s.companyCodes)
  const risk = agingRisk(row.aging, row.totalClosingBalance)
  // 分析抽屉按 公司×类型 粒度快照：恰好单选一家公司时预填
  const defaultCompanyCode = companies?.length === 1 ? companies[0] : undefined
  const [analysisOpen, setAnalysisOpen] = useState(false)

  return (
    <Card className="rounded-card border border-border p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">{row.transactionType}</h3>
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{directionLabel(row.direction)}</span>
          {row.internalCount > 0 && <PartyTypeTag partyType="internal" />}
          {row.externalCount > 0 && <PartyTypeTag partyType="external" />}
        </div>
      </div>
      <div className="mt-3 font-num text-2xl font-semibold leading-tight tabular-nums text-foreground">
        {formatMoneyWan(row.totalClosingBalance / 10000)}
        <span className="ml-1 text-sm font-normal text-muted-foreground">万</span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
        <span>记录 <span className="font-num tabular-nums text-foreground">{row.recordCount.toLocaleString('zh-CN')}</span> 笔</span>
        {row.internalCount > 0 && <span>内部 <span className="font-num tabular-nums text-foreground">{row.internalCount.toLocaleString('zh-CN')}</span></span>}
      </div>
      <div className="mt-3">
        <AgingStackBar aging={row.aging} closingBalance={row.totalClosingBalance} />
      </div>
      {risk ? (
        <p className={cn(
          'mt-2 text-xs',
          risk.level === 'danger' ? 'text-destructive' : risk.level === 'watch' ? 'text-warning-strong' : 'text-muted-foreground',
        )} title={AGING_GROUPS.join(' / ')}>
          {risk.text}
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">暂无余额数据</p>
      )}
      <div className="mt-3 flex items-center justify-between border-t border-dashed border-border pt-3">
        <span className="text-xs text-muted-foreground">{period ? `期间 ${period}` : ''}</span>
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-primary" onClick={() => setAnalysisOpen(true)}>
          <FileText className="mr-1 h-3 w-3" />
          单项分析
        </Button>
      </div>
      <TransactionAnalysisDrawer
        open={analysisOpen}
        target={analysisOpen ? { transactionType: row.transactionType, period, defaultCompanyCode } : null}
        onClose={() => setAnalysisOpen(false)}
      />
    </Card>
  )
}
