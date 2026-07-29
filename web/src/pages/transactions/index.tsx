import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { PageContainer } from '@/components/layout/page-container'
import { Pagination } from '@/components/data-table/pagination'
import { PAGINATION } from '@/lib/constants'
import { useCompanies, useTransactionOverview, useTransactionDetails, useTransactionAging, useInternalSummary, useInternalMirrorCheck, useTransactionPeriods, useTransactionAccounts } from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { usePermission } from '@/hooks/usePermission'
import { cn, formatMoneyWan } from '@/lib/utils'
import { ArrowLeftRight, TrendingUp, TrendingDown, Building2, AlertTriangle, Upload, ChevronDown } from 'lucide-react'
import { TransactionImportDialog } from './import-dialog'
import { CollectionsTab } from './collections-tab'
import { TransactionTrendCard } from './trend-card'
import { CoverageTab } from './coverage-tab'
import type { TransactionDetailItem, AgingAnalysisRow, InternalSummaryRow, InternalMirrorRow } from '@/types'

const TRANSACTION_TYPES = ['应收账款', '其他应收款', '预收账款', '应付账款', '其他应付款', '预付账款']
// 账龄分析展示分段（后端已由 10 段归集为 5 段）
const AGING_GROUPS = ['1-3月', '4-6月', '半年以上', '1年至3年', '3年以上']
// 贷方性质类型（债务）：余额已在导入时按科目性质归一为正号，净额 = 债权 - 债务
const CREDIT_NATURE_TYPES = ['预收账款', '应付账款', '其他应付款']

/** 金额展示：按「万」计 + 千分位，「万」字缩小为小号后缀 */
function formatAmount(v: number): ReactNode {
  return (
    <>
      {formatMoneyWan(v / 10000)}
      <span className="ml-0.5 text-[0.55em] font-normal text-muted-foreground">万</span>
    </>
  )
}

// 各 Tab 共用的公司单选筛选器（筛选器下沉到 Tab 内部，各自独立控制）
function CompanySelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: companies } = useCompanies()
  const { displayNameMap } = useCompanyDisplayName()
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[200px]">
        <SelectValue placeholder="选择公司" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">全部公司</SelectItem>
        {(companies || []).map((c) => (
          <SelectItem key={c.code} value={c.code}>{displayNameMap.get(c.code) ?? c.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// 明细/账龄共用的科目多选筛选器（空数组语义为「全部科目」）
// 选项 = 科目主数据全集 + 实际数据合并：有数据科目在前，科目体系中已定义但当前无数据的置底灰显；
// 可选项随 transactionType 联动收窄，未选类型时为六大往来全部科目
function AccountMultiSelect({ value, onChange, transactionType }: { value: string[]; onChange: (v: string[]) => void; transactionType?: string }) {
  const { data: accounts } = useTransactionAccounts(transactionType)
  const label = useMemo(() => {
    if (value.length === 0) return '全部科目'
    const first = (accounts || []).find((a) => a.accountCode === value[0])
    const firstName = first?.accountDesc || value[0]
    return value.length === 1 ? firstName : `${firstName} 等 ${value.length} 个`
  }, [value, accounts])

  // 后端已按 hasData 排序，取首个无数据项位置插入分组分隔
  const firstNoDataCode = (accounts || []).find((a) => !a.hasData)?.accountCode

  const toggle = (code: string, checked: boolean) => {
    onChange(checked ? [...value, code] : value.filter((c) => c !== code))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-9 w-[200px] justify-between px-3 font-normal">
          <span className="truncate">{label}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-[320px] w-[260px] overflow-y-auto">
        <DropdownMenuItem
          className="text-xs text-muted-foreground"
          onSelect={(e) => { e.preventDefault(); onChange([]) }}
        >
          清空（全部科目）
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {(accounts || []).map((a) => (
          <Fragment key={a.accountCode}>
            {a.accountCode === firstNoDataCode && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="py-1 text-xs font-normal text-muted-foreground">以下科目当前无数据</DropdownMenuLabel>
              </>
            )}
            <DropdownMenuCheckboxItem
              checked={value.includes(a.accountCode)}
              onCheckedChange={(checked) => toggle(a.accountCode, checked === true)}
              onSelect={(e) => e.preventDefault()}
              className={cn(!a.hasData && 'text-muted-foreground')}
            >
              <span className="truncate">
                {a.accountDesc || a.accountCode}
                <span className="ml-1 text-xs text-muted-foreground">{a.accountCode}</span>
                {!a.hasData && <span className="ml-1 text-xs text-muted-foreground">· 无数据</span>}
              </span>
            </DropdownMenuCheckboxItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ===== 总览 Tab =====
function OverviewTab() {
  // 共享公司多选：同时驱动趋势图与汇总/分类卡片，空数组语义为「全部公司」
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>([])
  // 期间筛选（仅作用于卡片）：空串表示跟随最新期间
  const [periodFilter, setPeriodFilter] = useState('')
  const { data: companies } = useCompanies()
  const { data: periods } = useTransactionPeriods()
  // 期末余额为时点数，默认取最新期间（列表倒序首项），不提供跨期累加
  const period = periodFilter || periods?.[0]
  const { data: overview, isLoading } = useTransactionOverview({ companyCodes: selectedCompanies, period })

  const { displayNameMap } = useCompanyDisplayName()
  const companyLabel = useMemo(() => {
    if (selectedCompanies.length === 0) return '全部公司'
    const firstName = displayNameMap.get(selectedCompanies[0]) ?? selectedCompanies[0]
    return selectedCompanies.length === 1 ? firstName : `${firstName} 等 ${selectedCompanies.length} 家`
  }, [selectedCompanies, displayNameMap])

  const toggleCompany = (code: string, checked: boolean) => {
    setSelectedCompanies((prev) => (checked ? [...prev, code] : prev.filter((c) => c !== code)))
  }

  const list = overview ?? []
  // 净往来余额 = 债权合计(应收+其他应收+预付) - 债务合计(预收+应付+其他应付)，余额已按科目性质归一为正号
  const totalClaims = list.filter((i) => !CREDIT_NATURE_TYPES.includes(i.transactionType)).reduce((s, i) => s + i.totalClosingBalance, 0)
  const totalDebts = list.filter((i) => CREDIT_NATURE_TYPES.includes(i.transactionType)).reduce((s, i) => s + i.totalClosingBalance, 0)
  const netBalance = totalClaims - totalDebts

  return (
    <div className="space-y-6">
      {/* 筛选行：公司多选（图表与卡片共享）+ 期间单选（仅作用于卡片） */}
      <div className="flex flex-wrap items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-9 w-[220px] justify-between px-3 font-normal">
              <span className="truncate">{companyLabel}</span>
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="max-h-[320px] w-[240px] overflow-y-auto">
            <DropdownMenuItem
              className="text-xs text-muted-foreground"
              onSelect={(e) => { e.preventDefault(); setSelectedCompanies((companies || []).map((c) => c.code)) }}
            >
              全选
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-xs text-muted-foreground"
              onSelect={(e) => { e.preventDefault(); setSelectedCompanies([]) }}
            >
              清空（全部公司）
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {(companies || []).map((company) => (
              <DropdownMenuCheckboxItem
                key={company.code}
                checked={selectedCompanies.includes(company.code)}
                onCheckedChange={(checked) => toggleCompany(company.code, checked === true)}
                onSelect={(e) => e.preventDefault()}
              >
                {displayNameMap.get(company.code) ?? company.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
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
        <span className="text-xs text-muted-foreground">期间仅作用于卡片，趋势图展示全期间序列</span>
      </div>

      {/* 往来变动趋势（与卡片共享公司筛选） */}
      <TransactionTrendCard companyCodes={selectedCompanies} />

      {isLoading || !period ? (
        <div className="py-12 text-center text-sm text-muted-foreground">加载中...</div>
      ) : list.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">暂无往来数据</div>
      ) : (
        <>
          {/* 汇总卡片 */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="flex items-center gap-4 pt-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                  <TrendingUp className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">债权合计（应收+其他应收+预付）</p>
                  <p className="text-xl font-bold">{formatAmount(totalClaims)}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 pt-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30">
                  <TrendingDown className="h-6 w-6 text-red-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">债务合计（应付+其他应付+预收）</p>
                  <p className="text-xl font-bold">{formatAmount(totalDebts)}</p>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="flex items-center gap-4 pt-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                  <ArrowLeftRight className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">净往来余额</p>
                  <p className="text-xl font-bold">{formatAmount(netBalance)}</p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* 六大往来分类卡片 */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {list.map((item) => {
              // 方向标记按会计性质：贷方性质（预收/应付/其他应付）= AP，其余（应收/其他应收/预付）= AR
              const isCredit = CREDIT_NATURE_TYPES.includes(item.transactionType)
              return (
                <Card key={item.transactionType}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-sm">
                      <span>{item.transactionType}</span>
                      <span className={cn('rounded px-1.5 py-0.5 text-xs', isCredit ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300')}>
                        {isCredit ? 'AP' : 'AR'}
                      </span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">{formatAmount(item.totalClosingBalance)}</p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ===== 明细 Tab =====
function DetailsTab() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PAGINATION.DEFAULT_PAGE_SIZE)
  const [companyFilter, setCompanyFilter] = useState('all')
  // 空串表示跟随最新期间（默认选中最近一期有数据的期间）；'all' 为全部期间
  const [periodFilter, setPeriodFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [accountFilter, setAccountFilter] = useState<string[]>([])
  const [keyword, setKeyword] = useState('')
  const { data: periods } = useTransactionPeriods()
  const { getDisplayName } = useCompanyDisplayName()
  const effectivePeriod = periodFilter || periods?.[0] || ''

  const { data, isLoading } = useTransactionDetails({
    page,
    pageSize,
    companyCode: companyFilter === 'all' ? undefined : companyFilter,
    period: periodFilter === 'all' ? undefined : effectivePeriod || undefined,
    transactionType: typeFilter || undefined,
    accountCodes: accountFilter.length ? accountFilter.join(',') : undefined,
    counterpartyKeyword: keyword || undefined,
  }, { enabled: periods !== undefined }) // 等期间列表加载后再查，避免首次跨期查询闪现

  const items = (data?.items || []) as TransactionDetailItem[]
  const total = data?.total || 0

  return (
    <div className="space-y-4">
      {/* 筛选栏：公司 / 期间（默认最新）/ 类型 / 科目多选 / 客商关键词（零余额行已固定隐藏，按金额倒序） */}
      <div className="flex flex-wrap items-center gap-3">
        <CompanySelect value={companyFilter} onChange={(v) => { setCompanyFilter(v); setPage(1) }} />
        <Select value={periodFilter || effectivePeriod} onValueChange={(v) => { setPeriodFilter(v); setPage(1) }}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="期间" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部期间</SelectItem>
            {(periods || []).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v === 'all' ? '' : v); setAccountFilter([]); setPage(1) }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="往来类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            {TRANSACTION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <AccountMultiSelect value={accountFilter} onChange={(v) => { setAccountFilter(v); setPage(1) }} transactionType={typeFilter || undefined} />
        <Input
          placeholder="搜索往来对象..."
          className="w-[200px]"
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); setPage(1) }}
        />
      </div>

      {/* 表格（已精简：去除单据号/账龄天数列） */}
      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">暂无数据</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-center text-muted-foreground">
                    <th className="px-2 py-2 font-medium">公司</th>
                    <th className="px-2 py-2 font-medium">期间</th>
                    <th className="px-2 py-2 font-medium">往来类型</th>
                    <th className="px-2 py-2 font-medium">往来对象</th>
                    <th className="px-2 py-2 font-medium">科目</th>
                    <th className="px-2 py-2 font-medium">期末余额</th>
                    <th className="px-2 py-2 font-medium">内部标记</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="px-2 py-2 text-xs" title={row.companyName || row.companyCode}>{getDisplayName(row.companyCode, row.companyName)}</td>
                      <td className="px-2 py-2 text-center font-num text-xs">{row.cutoffDate?.slice(0, 7) || '-'}</td>
                      <td className="px-2 py-2">{row.transactionType}</td>
                      <td className="px-2 py-2">
                        <div>{row.counterpartyName || '-'}</div>
                        <div className="text-xs text-muted-foreground">{row.counterpartyCode}</div>
                      </td>
                      <td className="px-2 py-2 text-xs">{row.accountDesc || row.accountCode}</td>
                      <td className="px-2 py-2 text-right font-mono">{row.closingBalance.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-2 py-2 text-center">
                        {row.isInternal ? (
                          <span className={cn('rounded px-1.5 py-0.5 text-xs', row.internalType === '内部抵消' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300')}>
                            {row.internalType}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">外部</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 分页 */}
      {total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          summary={`共 ${total} 条`}
        />
      )}
    </div>
  )
}

// ===== 账龄分析 Tab =====
function AgingTab() {
  const [companyFilter, setCompanyFilter] = useState('all')
  // 空串表示跟随最新期间（默认选中最近一期有数据的期间）；期末余额为时点数，不提供跨期累加
  const [periodFilter, setPeriodFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [accountFilter, setAccountFilter] = useState<string[]>([])
  const [groupBy, setGroupBy] = useState<string>('type')
  const { data: periods } = useTransactionPeriods()
  const { getDisplayName } = useCompanyDisplayName()
  const period = periodFilter || periods?.[0]
  // 科目维度统一由「科目筛选」承载：选中具体科目时自动按科目展开（显示科目列），
  // 未选时按分组方式（往来类型/往来对象）汇总，避免与分组下拉中的「按科目」重复
  const effectiveGroupBy = accountFilter.length > 0 ? 'account' : groupBy

  const { data: agingData, isLoading } = useTransactionAging({
    companyCode: companyFilter === 'all' ? undefined : companyFilter,
    transactionType: typeFilter || undefined,
    groupBy: effectiveGroupBy,
    period,
    accountCodes: accountFilter.length ? accountFilter.join(',') : undefined,
  }, { enabled: !!period }) // 等期间确定后再查，避免跨期重复累加的首次查询

  const rows = (agingData || []) as AgingAnalysisRow[]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <CompanySelect value={companyFilter} onChange={setCompanyFilter} />
        <Select value={period ?? ''} onValueChange={setPeriodFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="期间" />
          </SelectTrigger>
          <SelectContent>
            {(periods || []).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v === 'all' ? '' : v); setAccountFilter([]) }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="往来类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            {TRANSACTION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <AccountMultiSelect value={accountFilter} onChange={setAccountFilter} transactionType={typeFilter || undefined} />
        <Select value={groupBy} onValueChange={setGroupBy}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="分组方式" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="type">按往来类型</SelectItem>
            <SelectItem value="counterparty">按往来对象</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="pt-4">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
          ) : rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">暂无数据</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" style={{ minWidth: 960 }}>
                <thead>
                  <tr className="border-b text-center text-muted-foreground">
                    <th className="w-[150px] px-2 py-2 font-medium">公司</th>
                    <th className="w-[90px] px-2 py-2 font-medium">往来类型</th>
                    {effectiveGroupBy === 'counterparty' && <th className="min-w-[140px] px-2 py-2 font-medium">往来对象</th>}
                    {effectiveGroupBy === 'account' && <th className="min-w-[140px] px-2 py-2 font-medium">科目</th>}
                    <th className="w-[92px] px-2 py-2 font-medium whitespace-nowrap">期末余额</th>
                    {AGING_GROUPS.map((b) => (
                      <th key={b} className="w-[92px] px-2 py-2 font-medium whitespace-nowrap">{b}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={idx} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="max-w-[150px] truncate px-2 py-2 text-xs" title={row.companyName || row.companyCode}>{getDisplayName(row.companyCode, row.companyName)}</td>
                      <td className="px-2 py-2 text-xs whitespace-nowrap">{row.transactionType}</td>
                      {effectiveGroupBy === 'counterparty' && <td className="max-w-[200px] truncate px-2 py-2 text-xs" title={row.counterpartyName || row.counterpartyCode || '-'}>{row.counterpartyName || row.counterpartyCode || '-'}</td>}
                      {effectiveGroupBy === 'account' && <td className="max-w-[200px] truncate px-2 py-2 text-xs" title={row.accountDesc || row.accountCode || '-'}>{row.accountDesc || row.accountCode || '-'}</td>}
                      <td className="px-2 py-2 text-right font-mono font-medium whitespace-nowrap">{row.closingBalance.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                      {AGING_GROUPS.map((b) => (
                        <td key={b} className={cn('px-2 py-2 text-right font-mono text-xs whitespace-nowrap', (row.aging[b] || 0) !== 0 && 'text-foreground')}>
                          {(row.aging[b] || 0) !== 0 ? row.aging[b].toLocaleString('zh-CN', { minimumFractionDigits: 2 }) : '-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ===== 内部往来 Tab =====
function InternalTab() {
  const [companyFilter, setCompanyFilter] = useState('all')
  const companyCode = companyFilter === 'all' ? undefined : companyFilter
  const { data: summaryData, isLoading: summaryLoading } = useInternalSummary(companyCode)
  const { data: mirrorData, isLoading: mirrorLoading } = useInternalMirrorCheck(companyCode)

  const summary = (summaryData || []) as InternalSummaryRow[]
  const mirror = (mirrorData || []) as InternalMirrorRow[]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <CompanySelect value={companyFilter} onChange={setCompanyFilter} />
      </div>

      {/* 内部往来汇总 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4" />
            内部往来汇总
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summaryLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
          ) : summary.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">暂无内部往来数据</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-2 py-2 font-medium">本方公司</th>
                    <th className="px-2 py-2 font-medium">内部对方公司</th>
                    <th className="px-2 py-2 font-medium">方向</th>
                    <th className="px-2 py-2 font-medium">往来类型</th>
                    <th className="px-2 py-2 text-right font-medium">期末余额</th>
                    <th className="px-2 py-2 text-right font-medium">笔数</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((row, idx) => (
                    <tr key={idx} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="px-2 py-2">{row.companyCode}</td>
                      <td className="px-2 py-2">{row.internalPeerCode}</td>
                      <td className="px-2 py-2">
                        <span className={cn('rounded px-1.5 py-0.5 text-xs', row.direction === 'AR' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300')}>
                          {row.direction}
                        </span>
                      </td>
                      <td className="px-2 py-2">{row.transactionType}</td>
                      <td className="px-2 py-2 text-right font-mono">{row.closingBalance.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-2 py-2 text-right">{row.recordCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 镜像校验 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4" />
            双边镜像校验
          </CardTitle>
        </CardHeader>
        <CardContent>
          {mirrorLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
          ) : mirror.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">暂无镜像校验数据</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-2 py-2 font-medium">公司A</th>
                    <th className="px-2 py-2 font-medium">公司B</th>
                    <th className="px-2 py-2 text-right font-medium">AR侧合计</th>
                    <th className="px-2 py-2 text-right font-medium">AP侧合计</th>
                    <th className="px-2 py-2 text-right font-medium">差额(未抵平)</th>
                  </tr>
                </thead>
                <tbody>
                  {mirror.map((row, idx) => (
                    <tr key={idx} className={cn('border-b last:border-0', Math.abs(row.difference) > 0.01 && 'bg-orange-50 dark:bg-orange-950/20')}>
                      <td className="px-2 py-2">{row.companyA}</td>
                      <td className="px-2 py-2">{row.companyB}</td>
                      <td className="px-2 py-2 text-right font-mono">{row.arAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-2 py-2 text-right font-mono">{row.apAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                      <td className={cn('px-2 py-2 text-right font-mono font-medium', Math.abs(row.difference) > 0.01 ? 'text-orange-600' : 'text-green-600')}>
                        {row.difference.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ===== 主页面 =====
export default function TransactionsPage() {
  const [activeTab, setActiveTab] = useState('overview')
  const [importOpen, setImportOpen] = useState(false)
  const { can } = usePermission()

  return (
    <PageContainer
      title="往来分析"
      description="六大往来总览、客商明细、账龄分析、内部往来抵消与催收管理"
    >
      <div className="space-y-4">
        {/* 页面头部仅保留导入入口；筛选器已下沉至各 Tab 内部独立控制 */}
        {can('transactions', 'import') && (
          <div className="flex items-center">
            <Button className="ml-auto" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="mr-1 h-4 w-4" />
              导入往来数据
            </Button>
          </div>
        )}

        {/* Tab 切换 */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">总览</TabsTrigger>
            <TabsTrigger value="details">明细查询</TabsTrigger>
            <TabsTrigger value="aging">账龄分析</TabsTrigger>
            <TabsTrigger value="internal">内部往来</TabsTrigger>
            <TabsTrigger value="coverage">导入覆盖</TabsTrigger>
            <TabsTrigger value="collections">催收管理</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab />
          </TabsContent>
          <TabsContent value="details">
            <DetailsTab />
          </TabsContent>
          <TabsContent value="aging">
            <AgingTab />
          </TabsContent>
          <TabsContent value="internal">
            <InternalTab />
          </TabsContent>
          <TabsContent value="coverage">
            <CoverageTab />
          </TabsContent>
          <TabsContent value="collections">
            <CollectionsTab />
          </TabsContent>
        </Tabs>
      </div>

      <TransactionImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </PageContainer>
  )
}
