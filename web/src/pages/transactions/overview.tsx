import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PageContainer } from '@/components/layout/page-container'
import { useTransactionOverview, useTransactionPeriods, useCompanies, useAvailablePeriods } from '@/hooks/api-queries'
import { usePageStore } from '@/stores/pageStateStore'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { CompanyMultiSelect } from '@/components/filters/company-select'
import { usePermission } from '@/hooks/usePermission'
import { cn, getChangeColor } from '@/lib/utils'
import { ArrowLeftRight, TrendingUp, TrendingDown, Upload } from 'lucide-react'
import { TransactionImportDialog } from './import-dialog'
import { TransactionTrendCard } from './trend-card'
import { useNavigate } from 'react-router-dom'
import { AgingStackBar, agingRisk, AGING_GROUPS, CREDIT_NATURE_TYPES, useDefaultCompanyCode, formatAmount } from './shared'

/**
 * 往来分析 · 总览：趋势图 + 债权/债务/净往来 KPI + 六大往来分类卡片。
 * 默认浙江省公司汇总口径（ET0001）；单体公司与汇总主体互斥筛选。
 * 导入往来数据入口保留在本页（默认落地页）。
 */

export default function TransactionsOverviewPage() {
  const { can } = usePermission()
  const navigate = useNavigate()
  const [importOpen, setImportOpen] = useState(false)
  // 共享公司多选：同时驱动趋势图与汇总/分类卡片，空数组语义为「全部公司」；
  // 默认浙江省公司汇总（ET0001，后端按汇总映射展开为成员合并口径）；查询条件持久化到 pageStateStore
  const setTransactionsTab = usePageStore((s) => s.setTransactionsTab)
  const selectedCompanies = usePageStore((s) => s.transactions.overview.companies)
  const periodFilter = usePageStore((s) => s.transactions.overview.period)
  const setSelectedCompanies = useCallback((v: string[]) => setTransactionsTab('overview', { companies: v }), [setTransactionsTab])
  const setPeriodFilter = useCallback((v: string) => setTransactionsTab('overview', { period: v }), [setTransactionsTab])
  const { data: companies } = useCompanies()
  const defaultCode = useDefaultCompanyCode()
  // 主体互斥业务规则：单体公司与汇总主体不能同时筛选；新增勾选某一类时自动取消另一类并提示
  const handleCompaniesChange = useCallback((next: string[]) => {
    const prev = usePageStore.getState().transactions.overview.companies
    const typeOf = (code: string) => companies?.find((c) => c.code === code)?.type
    const added = next.filter((c) => !prev.includes(c))
    if (added.length > 0) {
      const addedType = typeOf(added[added.length - 1])
      if (addedType === 'entity' && next.some((c) => typeOf(c) === 'summary')) {
        window.alert('单体公司与汇总主体不能同时筛选，已自动取消已选汇总主体。')
        setSelectedCompanies(next.filter((c) => typeOf(c) !== 'summary'))
        return
      }
      if (addedType === 'summary' && next.some((c) => typeOf(c) === 'entity')) {
        window.alert('单体公司与汇总主体不能同时筛选，已自动取消已选单体公司。')
        setSelectedCompanies(next.filter((c) => typeOf(c) !== 'entity'))
        return
      }
    }
    setSelectedCompanies(next)
  }, [companies, setSelectedCompanies])
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
  const { data: overview, isLoading } = useTransactionOverview({ companyCodes: selectedCompanies, period })

  const list = overview ?? []
  // 净往来余额 = 债权合计(应收+其他应收+预付) - 债务合计(预收+应付+其他应付)，余额已按科目性质归一为正号
  const totalClaims = list.filter((i) => !CREDIT_NATURE_TYPES.includes(i.transactionType)).reduce((s, i) => s + i.totalClosingBalance, 0)
  const totalDebts = list.filter((i) => CREDIT_NATURE_TYPES.includes(i.transactionType)).reduce((s, i) => s + i.totalClosingBalance, 0)
  const netBalance = totalClaims - totalDebts
  // 账龄分段占比（按 AGING_GROUPS 下标区间求和，返回百分比字符串）
  const agingPct = (aging: Record<string, number>, total: number, from: number, to: number): string => {
    if (total <= 0) return '0.0'
    const sum = AGING_GROUPS.slice(from, to).reduce((s, b) => s + (aging[b] ?? 0), 0)
    return ((sum / total) * 100).toFixed(1)
  }

  return (
    <PageContainer title="总览">
      <div className="space-y-4">
        {can('transactions', 'import') && (
          <div className="flex items-center">
            <Button className="ml-auto" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="mr-1 h-4 w-4" />
              导入往来数据
            </Button>
          </div>
        )}

        <div className="space-y-6">
          {/* 筛选卡：公司多选（图表与卡片共享，单体/汇总互斥）+ 期间单选（仅作用于卡片） */}
          <Card className="rounded-card p-4">
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
            <span className="text-xs text-muted-foreground">单体公司与汇总主体不可同时筛选；期间仅作用于卡片，趋势图展示全期间序列</span>
          </div>
          </Card>

          {/* 往来变动趋势（与卡片共享公司筛选） */}
          <TransactionTrendCard companyCodes={selectedCompanies} />

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
              {/* 汇总卡片 */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Card>
                  <CardContent className="flex items-center gap-4 pt-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-info/10">
                      <TrendingUp className="h-6 w-6 text-info" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">债权合计（应收+其他应收+预付）</p>
                      <p className="text-xl font-bold">{formatAmount(totalClaims)}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="flex items-center gap-4 pt-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-destructive/10">
                      <TrendingDown className="h-6 w-6 text-destructive" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">债务合计（应付+其他应付+预收）</p>
                      <p className="text-xl font-bold">{formatAmount(totalDebts)}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="flex items-center gap-4 pt-6">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-success/10">
                      <ArrowLeftRight className="h-6 w-6 text-success" />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">净往来余额</p>
                      <p className="text-xl font-bold">{formatAmount(netBalance)}</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

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
                      className="cursor-pointer transition-shadow duration-200 ease-brand hover:shadow-md"
                      onClick={() => {
                        // 预选该类型并跳转账龄分析（pageStateStore 持久化，刷新后仍生效）
                        setTransactionsTab('aging', { type: item.transactionType })
                        navigate('/transactions/aging')
                      }}
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
                              <span>{item.recordCount} 笔</span>
                              <span>内 {item.internalCount} / 外 {item.externalCount}</span>
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
        </div>
      </div>

      <TransactionImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </PageContainer>
  )
}
