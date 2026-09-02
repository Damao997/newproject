import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertTriangle, ArrowRight, ChevronDown, ChevronUp, FileText, RefreshCw } from 'lucide-react'
import { useDashboardReceivables, useTransactionAging } from '@/hooks/api-queries'
import { usePageStore } from '@/stores/pageStateStore'
import { AGING_GROUPS, AgingStackBar } from '@/pages/transactions/shared'
import { cn, formatMoneyWan, formatWan } from '@/lib/utils'
import type { AgingAnalysisRow } from '@/types'

/** 客户视图默认展示条数（金额 Top 10），可展开查看完整列表 */
const CUSTOMER_TOP_N = 10

export interface CustomerBalanceRow {
  code: string
  name: string
  balance: number
}

/**
 * 客户应收余额聚合：账龄接口返回 公司×客商 粒度，按客商编码跨公司合并期末余额（编码缺失兜底名称），
 * 结果按余额倒序。独立导出便于单元测试覆盖合并/排序/兜底逻辑。
 */
export function aggregateCustomerRows(rows: AgingAnalysisRow[]): CustomerBalanceRow[] {
  const acc = new Map<string, CustomerBalanceRow>()
  for (const r of rows) {
    const code = r.counterpartyCode || r.counterpartyName || ''
    if (!code) continue
    const prev = acc.get(code)
    if (prev) prev.balance += r.closingBalance
    else acc.set(code, { code, name: r.counterpartyName || r.counterpartyCode || code, balance: r.closingBalance })
  }
  for (const row of acc.values()) row.balance = Math.round(row.balance * 100) / 100
  return [...acc.values()].sort((a, b) => b.balance - a.balance)
}

/** 分布行（主体/客户视图共用）：名称 + 进度条 + 金额 + 占比，视觉规范一致；
 *  scale 用于单位换算：主体视图余额已是万元（scale=1），客户视图账龄余额为元（scale=1/10000） */
function DistributionRow({ name, balance, total, max, scale = 1 }: {
  name: string
  balance: number
  total: number
  max: number
  scale?: number
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-[9em] shrink-0 truncate text-body text-foreground" title={name}>{name}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-chart-1 transition-all duration-300"
          style={{ width: `${max > 0 ? Math.max(2, (balance / max) * 100) : 0}%` }}
        />
      </div>
      <span className="w-[72px] shrink-0 text-right font-num text-body text-foreground">
        {formatMoneyWan(balance * scale)}
      </span>
      <span className="w-[52px] shrink-0 text-right font-num text-xs text-muted-foreground">
        {total > 0 ? `${((balance / total) * 100).toFixed(1)}%` : '–'}
      </span>
    </div>
  )
}

interface ReceivableAgingContentProps {
  /** 选定期（跟随看板当前期间） */
  period?: string
  /** 主体口径（跟随看板顶部筛选） */
  companyCode?: string
}

/** KPI 磁贴 */
function StatTile({ label, value, unit, foot, accent, valueClass }: {
  label: string
  value: string
  unit: string
  foot: string
  accent: string
  valueClass?: string
}) {
  return (
    <div
      className={cn(
        'relative flex flex-col gap-2 overflow-hidden rounded-card border border-border bg-card p-5 shadow-antd-1 transition-all duration-200 hover:shadow-antd-2',
        "before:absolute before:bottom-0 before:left-0 before:top-0 before:w-[3px] before:content-['']",
        accent,
      )}
    >
      <span className="text-body text-muted-foreground">{label}</span>
      <div className={cn('font-num text-2xl font-semibold leading-tight text-foreground', valueClass)}>
        {value}
        <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>
      </div>
      <span className="text-xs text-muted-foreground">{foot}</span>
    </div>
  )
}

/** 分布视图切换：company=按主体（dashboard/receivables） / customer=按客户（aging counterparty 聚合） */
type DistributionView = 'company' | 'customer'

/**
 * 应收账款账龄分析页（真实数据，跟随看板主体/期间筛选）：
 * - useDashboardReceivables：应收期末余额按主体分布（横向条），可与按客户分布（aging counterparty 聚合，外部客户+关联方）切换；
 * - useTransactionAging（transactionType=应收账款 / groupBy=company）：8 段账龄汇总（KPI 磁贴 + 分布条 + 主体明细表）；
 * - 单体筛选（company:X）时账龄查询限定该主体；汇总主体（summary:X）按成员公司展开过滤（后端 expandSummaries）；全部口径按数据权限内单体公司统计；
 * - 深链入口：前往往来账龄分析（/transactions/aging）。
 */
export function ReceivableAgingContent({ period, companyCode }: ReceivableAgingContentProps) {
  const dim = usePageStore((s) => s.dashboard.dim)
  const mode: 'single' | 'summary' = dim.startsWith('summary:') ? 'summary' : 'single'
  // 主体口径：单体公司与汇总主体均限定账龄查询范围（汇总主体由后端 normalizeCompanies → expandSummaries
  // 展开为成员单体过滤）；dim='all'/空 = 全部主体，不传参保持数据权限口径
  const scopeCode = dim.startsWith('company:') || dim.startsWith('summary:') ? companyCode : undefined

  // 分布卡视图状态：默认按主体；客户视图口径=外部客户+关联方（与往来账龄分析前端默认一致）
  const [view, setView] = useState<DistributionView>('company')
  const [expanded, setExpanded] = useState(false)
  const switchView = (v: string) => {
    setView(v as DistributionView)
    setExpanded(false)
  }

  const { data: receivableData, isLoading: receivableLoading, isError: receivableError } = useDashboardReceivables({
    period,
    mode,
    companyCode,
  })
  const { data: agingRows, isLoading: agingLoading, isError: agingError, refetch } = useTransactionAging(
    {
      ...(scopeCode ? { companyCode: scopeCode } : {}),
      transactionType: '应收账款',
      groupBy: 'company',
      ...(period ? { period } : {}),
    },
    { enabled: !!period },
  )
  // 客户分布：复用账龄接口 counterparty 分组（与主体查询并行发出，保证切换无卡顿）；
  // partyType 限定 external+related，剔除内部往来
  const { data: customerAgingRows, isLoading: customerLoading } = useTransactionAging(
    {
      ...(scopeCode ? { companyCode: scopeCode } : {}),
      transactionType: '应收账款',
      groupBy: 'counterparty',
      partyType: 'external,related',
      ...(period ? { period } : {}),
    },
    { enabled: !!period },
  )

  const receivableRows = useMemo(() => receivableData?.rows ?? [], [receivableData])
  const receivableTotal = useMemo(() => receivableRows.reduce((s, r) => s + r.balance, 0), [receivableRows])
  const maxBalance = useMemo(() => receivableRows.reduce((m, r) => Math.max(m, r.balance), 0), [receivableRows])

  // 客户分布聚合行（跨公司同客商合并）与派生量（余额为元，展示时折算万元）
  const customerRows = useMemo(() => aggregateCustomerRows(customerAgingRows ?? []), [customerAgingRows])
  const customerTotal = useMemo(() => customerRows.reduce((s, r) => s + r.balance, 0), [customerRows])
  const customerMax = useMemo(() => customerRows.reduce((m, r) => Math.max(m, r.balance), 0), [customerRows])
  const visibleCustomerRows = expanded ? customerRows : customerRows.slice(0, CUSTOMER_TOP_N)

  // 8 段账龄 Σ 口径（与往来账龄分析同分组：1个月 / 2个月 / 3个月 / 4-6月 / 半年以上 / 1-2年 / 2-3年 / 3年以上）
  const agingTotalByGroup = useMemo(() => {
    const acc = new Map<string, number>()
    for (const g of AGING_GROUPS) acc.set(g, 0)
    for (const r of agingRows ?? []) {
      for (const g of AGING_GROUPS) acc.set(g, (acc.get(g) ?? 0) + (r.aging[g] ?? 0))
    }
    return acc
  }, [agingRows])
  const within1y = AGING_GROUPS.slice(0, 5).reduce((s, g) => s + (agingTotalByGroup.get(g) ?? 0), 0)
  const over1y = AGING_GROUPS.slice(5).reduce((s, g) => s + (agingTotalByGroup.get(g) ?? 0), 0)
  const agingClosingTotal = useMemo(() => (agingRows ?? []).reduce((s, r) => s + r.closingBalance, 0), [agingRows])
  const agingMax = useMemo(() => Math.max(...AGING_GROUPS.map((g) => agingTotalByGroup.get(g) ?? 0), 0), [agingTotalByGroup])

  const isLoading = receivableLoading || agingLoading
  const isError = receivableError || agingError
  const isEmpty = !isLoading && !isError && receivableRows.length === 0 && (agingRows ?? []).length === 0

  if (isLoading) {
    return (
      <div className="animate-fade-in space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-[108px] rounded-card" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="skeleton h-[280px] rounded-card" />
          <div className="skeleton h-[280px] rounded-card" />
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </div>
        <p className="text-sm font-medium text-foreground">应收账款账龄数据加载失败</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          重试
        </Button>
      </div>
    )
  }

  return (
    <div className="animate-fade-in space-y-4">
      {/* 顶部工具条：口径摘要 + 往来账龄深链 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {period ? `期间 ${period} · ` : ''}应收期末余额按主体分布 · 8 段账龄结构（口径与往来账龄分析一致）
        </p>
        <Button asChild variant="outline" size="sm" className="h-8 gap-1">
          <Link to="/transactions/aging">
            <FileText className="h-3.5 w-3.5" />
            前往往来账龄分析
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      {isEmpty ? (
        <EmptyState
          title="暂无应收账款数据"
          description="导入往来数据后，将按主体展示应收期末余额分布与账龄结构"
        />
      ) : (
        <>
          {/* KPI 磁贴（真实 Σ 口径） */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="应收账款总额"
              value={formatMoneyWan(receivableTotal)}
              unit="万"
              foot={`按主体分布 ${receivableRows.length} 个主体`}
              accent="before:bg-info-500"
            />
            <StatTile
              label="一年以内账龄"
              value={formatWan(within1y)}
              unit="万"
              foot={agingClosingTotal > 0 ? `占比 ${((within1y / agingClosingTotal) * 100).toFixed(1)}%` : '账龄 1个月 ~ 半年以上'}
              accent="before:bg-success-500"
            />
            <StatTile
              label="一年以上账龄"
              value={formatWan(over1y)}
              unit="万"
              foot="1年至2年 / 2年至3年 / 3年以上 · 需催收"
              accent={over1y > 0 ? 'before:bg-orange-500' : 'before:bg-success-500'}
              valueClass={over1y > 0 ? 'text-orange-600' : undefined}
            />
            <StatTile
              label="账龄统计主体数"
              value={String((agingRows ?? []).length)}
              unit="家"
              foot={scopeCode ? (mode === 'summary' ? '汇总主体成员口径' : '单体口径') : '数据权限内单体公司'}
              accent="before:bg-blue-8"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* 应收分布卡：按主体 / 按客户 切换（segmented 同款控件，风格与角色管理页一致） */}
            <Card className="border border-border shadow-antd-1">
              <CardContent className="p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-base font-semibold text-foreground">
                    {view === 'company' ? '应收余额按主体分布' : '应收余额按客户分布'}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      单位：万元 · 期末余额{view === 'customer' ? ' · 外部客户+关联方' : ''}
                    </span>
                  </h3>
                  <Tabs value={view} onValueChange={switchView}>
                    <TabsList variant="segmented">
                      <TabsTrigger value="company">按主体</TabsTrigger>
                      <TabsTrigger value="customer">按客户</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
                {view === 'company' ? (
                  receivableRows.length === 0 ? (
                    <EmptyState compact className="py-10" title="当前口径暂无应收主体数据" />
                  ) : (
                    <div key="company" className="animate-fade-in space-y-2.5">
                      {receivableRows.map((r) => (
                        <DistributionRow key={r.code} name={r.name} balance={r.balance} total={receivableTotal} max={maxBalance} />
                      ))}
                    </div>
                  )
                ) : customerLoading ? (
                  <div className="animate-fade-in space-y-2.5 py-1">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="skeleton h-4 w-full rounded-full" />
                    ))}
                  </div>
                ) : customerRows.length === 0 ? (
                  <EmptyState compact className="py-10" title="当前口径暂无应收客户数据" />
                ) : (
                  <div key="customer" className="animate-fade-in">
                    <div className="space-y-2.5">
                      {visibleCustomerRows.map((r) => (
                        <DistributionRow key={r.code} name={r.name} balance={r.balance} total={customerTotal} max={customerMax} scale={1 / 10000} />
                      ))}
                    </div>
                    {customerRows.length > CUSTOMER_TOP_N && (
                      <div className="mt-3 flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          Top {CUSTOMER_TOP_N} 客户 · 共 {customerRows.length} 家
                        </span>
                        <Button variant="ghost" size="sm" className="h-7 gap-1 text-primary" onClick={() => setExpanded((e) => !e)}>
                          {expanded ? (
                            <>
                              收起
                              <ChevronUp className="h-3.5 w-3.5" />
                            </>
                          ) : (
                            <>
                              展开全部 {customerRows.length} 家
                              <ChevronDown className="h-3.5 w-3.5" />
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 8 段账龄结构（Σ aging 真实值） */}
            <Card className="border border-border shadow-antd-1">
              <CardContent className="p-5">
                <h3 className="mb-3 text-base font-semibold text-foreground">
                  账龄结构（8 段）
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    合计 {formatWan(agingClosingTotal)}万 · 应收账款口径
                  </span>
                </h3>
                {(agingRows ?? []).length === 0 ? (
                  <EmptyState compact className="py-10" title="当前口径暂无账龄数据" description="往来导入后按单体公司统计账龄" />
                ) : (
                  <>
                    <AgingStackBar
                      aging={Object.fromEntries(agingTotalByGroup)}
                      closingBalance={agingClosingTotal}
                      className="mb-4"
                    />
                    <div className="space-y-2">
                      {AGING_GROUPS.map((g) => {
                        const v = agingTotalByGroup.get(g) ?? 0
                        return (
                          <div key={g} className="flex items-center gap-3">
                            <span className="w-[4.5em] shrink-0 text-body text-foreground">{g}</span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                              <div
                                className={cn('h-full rounded-full', g === '3年以上' || g === '2年至3年' ? 'bg-destructive' : g === '1年至2年' || g === '半年以上' ? 'bg-orange-500' : 'bg-chart-1')}
                                style={{ width: `${agingMax > 0 ? Math.max(v > 0 ? 2 : 0, (v / agingMax) * 100) : 0}%` }}
                              />
                            </div>
                            <span className="w-[72px] shrink-0 text-right font-num text-body text-foreground">
                              {formatWan(v)}
                            </span>
                            <span className="w-[52px] shrink-0 text-right font-num text-xs text-muted-foreground">
                              {agingClosingTotal > 0 ? `${((v / agingClosingTotal) * 100).toFixed(1)}%` : '–'}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 主体账龄明细表（逐主体 8 段金额 + 分布条） */}
          <Card className="border border-border shadow-antd-1">
            <CardContent className="p-5">
              <h3 className="mb-3 text-base font-semibold text-foreground">
                主体账龄明细
                <span className="ml-2 text-xs font-normal text-muted-foreground">期末余额 / 8 段账龄 / 分布 · 单位：万元</span>
              </h3>
              {(agingRows ?? []).length === 0 ? (
                <EmptyState compact className="py-10" title="暂无明细数据" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="px-3 py-2 text-left text-body font-medium text-foreground">主体</th>
                        <th className="px-3 py-2 text-right text-body font-medium text-foreground">期末余额</th>
                        {AGING_GROUPS.map((g) => (
                          <th key={g} className="px-3 py-2 text-right text-body font-medium text-foreground">{g}</th>
                        ))}
                        <th className="px-3 py-2 text-left text-body font-medium text-foreground">分布</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...(agingRows ?? [])]
                        .sort((a, b) => b.closingBalance - a.closingBalance)
                        .map((r, i) => (
                          <tr key={r.companyCode} className={cn('border-b border-border/60', i % 2 === 1 && 'bg-muted/30')}>
                            <td className="max-w-[12em] truncate px-3 py-2 text-left text-body text-foreground" title={r.companyName ?? r.companyCode}>
                              {r.companyName ?? r.companyCode}
                            </td>
                            <td className="px-3 py-2 text-right font-num text-sm font-semibold text-foreground">
                              {formatWan(r.closingBalance)}
                            </td>
                            {AGING_GROUPS.map((g) => {
                              const v = r.aging[g] ?? 0
                              return (
                                <td key={g} className={cn('px-3 py-2 text-right font-num text-sm', v !== 0 ? 'text-foreground' : 'text-muted-foreground/60')}>
                                  {v !== 0 ? formatWan(v) : '–'}
                                </td>
                              )
                            })}
                            <td className="px-3 py-2">
                              <AgingStackBar aging={r.aging} closingBalance={r.closingBalance} />
                            </td>
                          </tr>
                        ))}
                      <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                        <td className="px-3 py-2 text-left text-body">合计</td>
                        <td className="px-3 py-2 text-right font-num text-sm">{formatWan(agingClosingTotal)}</td>
                        {AGING_GROUPS.map((g) => (
                          <td key={g} className="px-3 py-2 text-right font-num text-sm">
                            {formatWan(agingTotalByGroup.get(g) ?? 0)}
                          </td>
                        ))}
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
              {mode === 'summary' && (
                <p className="mt-3 text-xs text-muted-foreground">
                  汇总主体口径：账龄按汇总主体成员公司逐户统计；如需按成员/客商维度细分，请前往往来账龄分析筛选。
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
