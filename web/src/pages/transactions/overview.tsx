import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PageContainer } from '@/components/layout/page-container'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { useExclusiveCompanyFilter } from '@/hooks/use-exclusive-company-filter'
import { useTransactionOverview, useTransactionPeriods, useCompanies, useAvailablePeriods } from '@/hooks/api-queries'
import { usePageStore } from '@/stores/pageStateStore'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { CompanyMultiSelect } from '@/components/filters/company-select'
import { cn, getChangeColor } from '@/lib/utils'
import { TransactionTrendCard } from './trend-card'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AgingStackBar, agingRisk, AGING_GROUPS, CREDIT_NATURE_TYPES, useDefaultCompanyCode, formatAmount, PartyTypeSelect } from './shared'

/**
 * 往来分析 · 总览：趋势图 + 六大往来分类卡片。
 * 默认浙江省公司汇总口径（ET0001）；单体公司与汇总主体互斥筛选。
 * 往来数据导入入口统一在数据管理页（/data/import），本页仅消费分析数据。
 */

export default function TransactionsOverviewPage() {
  const navigate = useNavigate()
  // 从看板应收账款卡深链进入时显示「返回首页」按钮（sessionStorage 标记，点击返回时清除；刷新后仍保留）
  const [fromDashboard] = useState(() => sessionStorage.getItem('dashboard.fromDashboard') === '1')
  const handleBackToDashboard = useCallback(() => {
    sessionStorage.removeItem('dashboard.fromDashboard')
    navigate('/')
  }, [navigate])
  // 吸顶测量：标题区 + 筛选卡高度实时测量，驱动筛选卡吸顶偏移
  const { headerRef, filterRef, headerHeight } = useStickyHeader()
  // 共享公司多选：同时驱动趋势图与汇总/分类卡片，空数组语义为「全部公司」；
  // 默认浙江省公司汇总（ET0001，后端按汇总映射展开为成员合并口径）；查询条件持久化到 pageStateStore
  const setTransactionsTab = usePageStore((s) => s.setTransactionsTab)
  const selectedCompanies = usePageStore((s) => s.transactions.overview.companies)
  const periodFilter = usePageStore((s) => s.transactions.overview.period)
  // 对象类型多选（默认外部+关联方，排除内部公司；与账龄页默认口径一致）
  const partyFilter = usePageStore((s) => s.transactions.overview.party)
  const setSelectedCompanies = useCallback((v: string[]) => setTransactionsTab('overview', { companies: v }), [setTransactionsTab])
  const setPeriodFilter = useCallback((v: string) => setTransactionsTab('overview', { period: v }), [setTransactionsTab])
  const setPartyFilter = useCallback((v: string[]) => setTransactionsTab('overview', { party: v }), [setTransactionsTab])

  // 看板深链：/transactions/overview?companies=A,B&period=YYYY-MM 挂载时写入 store 后清理 URL（与 inventory 深链同模式）；
  // 越权/失效值由上方候选校验与回退逻辑兜底；仅处理一次，避免刷新重复覆盖手动筛选
  const [searchParams, setSearchParams] = useSearchParams()
  const deepLinkApplied = useRef(false)
  useEffect(() => {
    if (deepLinkApplied.current) return
    const companiesParam = searchParams.get('companies')
    const periodParam = searchParams.get('period')
    if (!companiesParam && !periodParam) return
    deepLinkApplied.current = true
    // companies 可为空串（看板「全部主体」→ 往来「全部公司」语义）
    if (companiesParam !== null) {
      setSelectedCompanies(companiesParam.split(',').map((s) => s.trim()).filter(Boolean))
    }
    if (periodParam) setPeriodFilter(periodParam)
    // 仅删除已消费的深链参数，保留 URL 上其他 query（避免 setSearchParams({}) 误清）
    const next = new URLSearchParams(searchParams)
    next.delete('companies')
    next.delete('period')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSelectedCompanies, setPeriodFilter, setSearchParams])
  const { data: companies } = useCompanies()
  const defaultCode = useDefaultCompanyCode()
  // 主体互斥业务规则：单体公司与汇总主体不能同时筛选；逻辑与轻提示收敛于共享 hook
  const { handleCompaniesChange, noticeElement } = useExclusiveCompanyFilter({
    companies,
    getPrev: () => usePageStore.getState().transactions.overview.companies,
    setSelected: setSelectedCompanies,
  })
  // 持久化公司多选校验：编码已删除/越权时过滤，全部失效则回退默认主体（候选加载后生效，用户手动切换后不再覆盖）
  useEffect(() => {
    if (!companies || companies.length === 0) return
    const valid = new Set(companies.map((c) => c.code))
    const cur = usePageStore.getState().transactions.overview.companies
    if (cur.length === 0) return
    const filtered = cur.filter((c) => valid.has(c))
    if (filtered.length > 0) {
      if (filtered.length !== cur.length) setSelectedCompanies(filtered)
    } else if (defaultCode) {
      setSelectedCompanies([defaultCode])
    }
  }, [companies, defaultCode, setSelectedCompanies])
  // 期间筛选（仅作用于卡片）：空串表示跟随最新期间；已选期间不在候选（如财年切换）时回退跟随最新
  // 期间候选按全局选中财年过滤（财年起始月取后端返回值，与 dashboard/indicators/data/inventory 口径一致）
  const { data: periodsData } = useAvailablePeriods()
  const fiscalYear = usePeriodStore((s) => s.fiscalYear)
  const { data: rawPeriods } = useTransactionPeriods()
  const periods = useMemo(
    () => filterPeriodsByFiscalYear(rawPeriods ?? [], fiscalYear, periodsData?.fiscalStartMonth ?? 1),
    [rawPeriods, fiscalYear, periodsData?.fiscalStartMonth],
  )
  useEffect(() => {
    const cur = usePageStore.getState().transactions.overview.period
    if (cur !== '' && !periods.includes(cur)) setPeriodFilter('')
  }, [periods, setPeriodFilter])
  // 期末余额为时点数，默认取最新期间（列表倒序首项），不提供跨期累加
  const period = periodFilter || periods[0]
  const { data: overview, isLoading } = useTransactionOverview({ companyCodes: selectedCompanies, period, partyType: partyFilter })

  const list = overview ?? []
  // 账龄分段占比（按 AGING_GROUPS 下标区间求和，返回百分比字符串）
  const agingPct = (aging: Record<string, number>, total: number, from: number, to: number): string => {
    if (total <= 0) return '0.0'
    const sum = AGING_GROUPS.slice(from, to).reduce((s, b) => s + (aging[b] ?? 0), 0)
    return ((sum / total) * 100).toFixed(1)
  }

  return (
    <PageContainer title={(
        <span className="flex items-center gap-1">
          {fromDashboard && (
            <Button variant="ghost" size="icon" className="-ml-2 h-8 w-8" onClick={handleBackToDashboard} aria-label="返回首页">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          往来总览
        </span>
      )} stickyHeader headerRef={headerRef}>
      <div className="space-y-4">
        <div className="space-y-6">
          {/* 筛选卡：公司多选（图表与卡片共享，单体/汇总互斥）+ 期间单选 + 对象类型多选（后两者仅作用于卡片）；吸顶 */}
          <Card ref={filterRef} className="sticky z-10 rounded-card p-4" style={{ top: headerHeight }}>
          <div className="flex flex-wrap items-center gap-3">
            <CompanyMultiSelect value={selectedCompanies} onChange={handleCompaniesChange} selectAllType="entity" />
            <Select value={period ?? ''} onValueChange={setPeriodFilter}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="期间" />
              </SelectTrigger>
              <SelectContent>
                {(periods || []).map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <PartyTypeSelect value={partyFilter} onChange={setPartyFilter} />
          </div>
          {noticeElement}
          </Card>

          {isLoading || !period ? (
            // 有原始期间但当前财年过滤后为空：提示财年无数据而非永久"加载中"
            periods.length === 0 && (rawPeriods?.length ?? 0) > 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">当前财年暂无往来数据</div>
            ) : (
              <div className="py-12 text-center text-sm text-muted-foreground">加载中…</div>
            )
          ) : list.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">暂无往来数据</div>
          ) : (
            <>
              {/* 六大往来分类卡片：信息增强 + 账龄堆叠条 + 风险提示，点击钻取账龄分析 */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {list.map((item) => {
                  // 方向标记按会计性质：贷方性质（预收/应付/其他应付）= AP，其余 = AR
                  const isCredit = CREDIT_NATURE_TYPES.includes(item.transactionType)
                  const risk = agingRisk(item.aging, item.totalClosingBalance)
                  // 较期初变动率：期初为 0 时隐藏该项
                  const changePct =
                    item.totalOpeningBalance !== 0
                      ? ((item.totalClosingBalance - item.totalOpeningBalance) / Math.abs(item.totalOpeningBalance)) * 100
                      : null
                  return (
                    <Card
                      key={item.transactionType}
                      className={cn('border border-border', item.totalClosingBalance !== 0 && 'cursor-pointer transition-shadow duration-200 ease-brand hover:shadow-md')}
                      onClick={item.totalClosingBalance !== 0 ? () => {
                        // 同步总览筛选（公司多选 + 期间 + 类型 + 对象类型）到账龄页，清空明细残留筛选，记录返回标记后跳转
                        setTransactionsTab('aging', {
                          type: item.transactionType,
                          companies: selectedCompanies, // 数组直接 1:1 传递（空数组=全部公司，语义一致）
                          period,                       // 总览实际生效期间（选定期或最新期）
                          party: partyFilter,           // 同步对象类型口径（默认外部+关联方）
                          accounts: [],                 // 清空科目：类型切换后旧科目残留会造成视图与卡片不一致（与账龄页手动切类型的清空行为对齐）
                          keyword: '',                  // 清空对象搜索
                          groupBy: 'type',              // 重置分组：卡片为类型汇总视图
                        })
                        sessionStorage.setItem('transactions.aging.fromOverview', '1')
                        navigate('/transactions/aging')
                      } : undefined}
                    >
                      <CardContent className="p-4">
                        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <span className={cn('inline-block h-3.5 w-1 rounded-full', isCredit ? 'bg-destructive' : 'bg-info')} />
                          {item.transactionType}
                        </p>
                        {item.totalClosingBalance !== 0 ? (
                          <>
                            <p className="mt-2 font-num text-2xl font-bold text-foreground">{formatAmount(item.totalClosingBalance)}</p>
                            <div className="mt-2">
                              <AgingStackBar aging={item.aging} closingBalance={item.totalClosingBalance} />
                            </div>
                            <p className="mt-1.5 flex justify-between font-num text-[11px] text-muted-foreground">
                              <span>1年内 {agingPct(item.aging, item.totalClosingBalance, 0, 5)}%</span>
                              <span>1-3年 {agingPct(item.aging, item.totalClosingBalance, 5, 7)}%</span>
                              <span className={risk?.level === 'danger' ? 'text-destructive' : risk?.level === 'watch' ? 'text-warning-strong' : 'text-muted-foreground'}>
                                3年+ {agingPct(item.aging, item.totalClosingBalance, 7, 8)}%
                              </span>
                            </p>
                            <div className="mt-2 flex flex-wrap gap-3 border-t border-dashed border-border pt-2 text-[11px] text-muted-foreground">
                              {changePct !== null && (
                                <span className={cn('font-medium', getChangeColor(changePct))}>
                                  {changePct > 0 ? '↑' : changePct < 0 ? '↓' : ''} {Math.abs(changePct).toFixed(1)}% 较期初
                                </span>
                              )}
                            </div>
                            {risk && (
                              <p className={cn('mt-1.5 flex items-center gap-1.5 text-[11px]', risk.level === 'danger' ? 'text-destructive' : risk.level === 'watch' ? 'text-warning-strong' : 'text-success-strong')}>
                                <span className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', risk.level === 'danger' ? 'bg-destructive' : risk.level === 'watch' ? 'bg-warning' : 'bg-success')} />
                                {risk.text}
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="mt-2 text-sm text-muted-foreground">暂无余额</p>
                        )}
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </>
          )}

          {/* 往来变动趋势（与卡片共享公司筛选） */}
          <TransactionTrendCard companyCodes={selectedCompanies} />
        </div>
      </div>
    </PageContainer>
  )
}
