import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
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
import { useTransactionOverview, useTransactionDetails, useTransactionAging, useInternalSummary, useInternalMirrorCheck, useTransactionPeriods, useTransactionAccounts } from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { CompanySelect, CompanyMultiSelect } from '@/components/filters/company-select'
import { usePermission } from '@/hooks/usePermission'
import { cn, formatMoneyWan } from '@/lib/utils'
import { ArrowLeftRight, TrendingUp, TrendingDown, Building2, AlertTriangle, Upload, ChevronDown, FileText, Eye } from 'lucide-react'
import { TransactionImportDialog } from './import-dialog'
import { CollectionsTab } from './collections-tab'
import { TransactionTrendCard } from './trend-card'
import { CoverageTab } from './coverage-tab'
import { AccountFilterTab } from './account-filter-tab'
import { TransactionAnalysisDrawer, type TransactionAnalysisTarget } from './analysis-drawer'
import type { TransactionDetailItem, AgingAnalysisRow, InternalSummaryRow, InternalMirrorRow } from '@/types'

const TRANSACTION_TYPES = ['应收账款', '其他应收款', '预收账款', '应付账款', '其他应付款', '预付账款']
// 账龄分析展示分段（后端已由 10 段归集为 5 段）
const AGING_GROUPS = ['1-3月', '4-6月', '半年以上', '1年至3年', '3年以上']

/** 账龄表渲染行：数据行 / 公司小计行 / 总合计行 */
type AgingRenderRow =
  | { kind: 'data'; row: AgingAnalysisRow }
  | { kind: 'subtotal' | 'total'; label: string; closingBalance: number; aging: Record<string, number> }
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

// 各 Tab 共用的公司单选筛选器统一走共享组件（@/components/filters/company-select）

// 关联方三分类标签样式（内部公司/关联方/外部）
const PARTY_TYPE_META: Record<string, { label: string; className: string }> = {
  internal: { label: '内部公司', className: 'bg-chart-1/10 text-chart-1' },
  related: { label: '关联方', className: 'bg-chart-5/10 text-chart-5' },
  external: { label: '外部', className: 'bg-muted text-muted-foreground' },
}

function PartyTypeTag({ partyType }: { partyType?: string }) {
  const meta = PARTY_TYPE_META[partyType ?? 'external'] ?? PARTY_TYPE_META.external
  return <span className={cn('rounded px-1.5 py-0.5 text-xs', meta.className)}>{meta.label}</span>
}

// 关联方过滤下拉（全部 / 内部公司 / 关联方）
function PartyTypeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[130px]">
        <SelectValue placeholder="对象类型" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="external">外部</SelectItem>
        <SelectItem value="related">关联方</SelectItem>
        <SelectItem value="internal">内部公司</SelectItem>
        <SelectItem value="all">全部对象</SelectItem>
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
  const { data: periods } = useTransactionPeriods()
  // 期末余额为时点数，默认取最新期间（列表倒序首项），不提供跨期累加
  const period = periodFilter || periods?.[0]
  const { data: overview, isLoading } = useTransactionOverview({ companyCodes: selectedCompanies, period })

  const list = overview ?? []
  // 净往来余额 = 债权合计(应收+其他应收+预付) - 债务合计(预收+应付+其他应付)，余额已按科目性质归一为正号
  const totalClaims = list.filter((i) => !CREDIT_NATURE_TYPES.includes(i.transactionType)).reduce((s, i) => s + i.totalClosingBalance, 0)
  const totalDebts = list.filter((i) => CREDIT_NATURE_TYPES.includes(i.transactionType)).reduce((s, i) => s + i.totalClosingBalance, 0)
  const netBalance = totalClaims - totalDebts

  return (
    <div className="space-y-6">
      {/* 筛选行：公司多选（图表与卡片共享）+ 期间单选（仅作用于卡片） */}
      <div className="flex flex-wrap items-center gap-3">
        <CompanyMultiSelect value={selectedCompanies} onChange={setSelectedCompanies} />
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
                      <span className={cn('rounded px-1.5 py-0.5 text-xs', isCredit ? 'bg-destructive/10 text-destructive' : 'bg-info/10 text-info')}>
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
  const [partyFilter, setPartyFilter] = useState('external')
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
    partyType: partyFilter === 'all' ? undefined : (partyFilter as 'internal' | 'related' | 'external'),
    counterpartyKeyword: keyword || undefined,
  }, { enabled: periods !== undefined }) // 等期间列表加载后再查，避免首次跨期查询闪现

  const items = (data?.items || []) as TransactionDetailItem[]
  const total = data?.total || 0
  const totalsClosing = data?.totals?.closingBalance ?? 0

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
        <PartyTypeSelect value={partyFilter} onChange={(v) => { setPartyFilter(v); setPage(1) }} />
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
                  <tr className="border-b text-center text-black">
                    <th className="px-2 py-2 font-medium">公司</th>
                    <th className="px-2 py-2 font-medium">期间</th>
                    <th className="px-2 py-2 font-medium">往来类型</th>
                    <th className="px-2 py-2 font-medium">往来对象</th>
                    <th className="px-2 py-2 font-medium">科目</th>
                    <th className="px-2 py-2 font-medium">期末余额</th>
                    <th className="px-2 py-2 font-medium">关联标记</th>
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
                      <td className="px-2 py-2 text-right font-num">{row.closingBalance.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-2 py-2 text-center"><PartyTypeTag partyType={row.partyType} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 bg-muted/40 font-medium">
                    <td className="px-2 py-2 text-xs" colSpan={5}>合计（全部筛选数据，跨页）</td>
                    <td className="px-2 py-2 text-right font-num">{totalsClosing.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                    <td className="px-2 py-2" />
                  </tr>
                </tfoot>
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
  const { can } = usePermission()
  const navigate = useNavigate()
  const [analysisTarget, setAnalysisTarget] = useState<TransactionAnalysisTarget | null>(null)
  const [companyFilter, setCompanyFilter] = useState('all')
  // 空串表示跟随最新期间（默认选中最近一期有数据的期间）；期末余额为时点数，不提供跨期累加
  const [periodFilter, setPeriodFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [accountFilter, setAccountFilter] = useState<string[]>([])
  const [partyFilter, setPartyFilter] = useState('external')
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
    partyType: partyFilter === 'all' ? undefined : partyFilter,
  }, { enabled: !!period }) // 等期间确定后再查，避免跨期重复累加的首次查询

  const rows = (agingData || []) as AgingAnalysisRow[]

  // 按公司分组（公司升序、组内余额降序），逐组插小计行，表尾插合计行
  const renderRows = useMemo<AgingRenderRow[]>(() => {
    const addAging = (acc: Record<string, number>, r: AgingAnalysisRow) => {
      for (const b of AGING_GROUPS) acc[b] = (acc[b] || 0) + (r.aging[b] || 0)
    }
    const byCompany = new Map<string, AgingAnalysisRow[]>()
    for (const r of rows) {
      if (!byCompany.has(r.companyCode)) byCompany.set(r.companyCode, [])
      byCompany.get(r.companyCode)!.push(r)
    }
    const out: AgingRenderRow[] = []
    const grand: { closingBalance: number; aging: Record<string, number> } = { closingBalance: 0, aging: {} }
    for (const key of [...byCompany.keys()].sort()) {
      const group = byCompany.get(key)!.slice().sort((a, b) => b.closingBalance - a.closingBalance)
      const sub: { closingBalance: number; aging: Record<string, number> } = { closingBalance: 0, aging: {} }
      for (const r of group) {
        out.push({ kind: 'data', row: r })
        sub.closingBalance += r.closingBalance
        addAging(sub.aging, r)
      }
      out.push({ kind: 'subtotal', label: `${getDisplayName(group[0].companyCode, group[0].companyName)} 小计`, closingBalance: sub.closingBalance, aging: sub.aging })
      grand.closingBalance += sub.closingBalance
      for (const b of AGING_GROUPS) grand.aging[b] = (grand.aging[b] || 0) + (sub.aging[b] || 0)
    }
    if (out.length > 0) out.push({ kind: 'total', label: '合计', closingBalance: grand.closingBalance, aging: grand.aging })
    return out
  }, [rows, getDisplayName])

  // 小计/合计行标签列合并数：公司+往来类型(+往来对象/科目列)
  const labelColSpan = 2 + (effectiveGroupBy === 'counterparty' || effectiveGroupBy === 'account' ? 1 : 0)

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
        <PartyTypeSelect value={partyFilter} onChange={setPartyFilter} />
        <Select value={groupBy} onValueChange={setGroupBy}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="分组方式" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="type">按往来类型</SelectItem>
            <SelectItem value="counterparty">按往来对象</SelectItem>
          </SelectContent>
        </Select>
        {can('reports', 'create') && (
          <Button
            variant="outline"
            size="sm"
            className="ml-auto"
            disabled={!period}
            onClick={() => setAnalysisTarget({
              transactionType: typeFilter || '',
              period: period as string,
              defaultCompanyCode: companyFilter !== 'all' ? companyFilter : undefined,
            })}
          >
            <FileText className="mr-1 h-4 w-4" /> 撰写单项分析
          </Button>
        )}
        {can('reports', 'view') && (
          <Button
            variant="outline"
            size="sm"
            className={can('reports', 'create') ? undefined : 'ml-auto'}
            onClick={() => navigate('/reports?tab=analyses')}
          >
            <Eye className="mr-1 h-4 w-4" /> 查看分析
          </Button>
        )}
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
                  <tr className="border-b text-center text-black">
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
                  {renderRows.map((rr, idx) => {
                    if (rr.kind === 'data') {
                      const row = rr.row
                      return (
                        <tr key={idx} className="border-b last:border-0 hover:bg-muted/50">
                          <td className="max-w-[150px] truncate px-2 py-2 text-xs" title={row.companyName || row.companyCode}>{getDisplayName(row.companyCode, row.companyName)}</td>
                          <td className="px-2 py-2 text-xs whitespace-nowrap">{row.transactionType}</td>
                          {effectiveGroupBy === 'counterparty' && (
                            <td className="max-w-[200px] px-2 py-2 text-xs">
                              <div className="truncate" title={row.counterpartyName || row.counterpartyCode || '-'}>{row.counterpartyName || row.counterpartyCode || '-'}</div>
                              <PartyTypeTag partyType={row.partyType} />
                            </td>
                          )}
                          {effectiveGroupBy === 'account' && <td className="max-w-[200px] truncate px-2 py-2 text-xs" title={row.accountDesc || row.accountCode || '-'}>{row.accountDesc || row.accountCode || '-'}</td>}
                          <td className="px-2 py-2 text-right font-num font-medium whitespace-nowrap">{row.closingBalance.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                          {AGING_GROUPS.map((b) => (
                            <td key={b} className={cn('px-2 py-2 text-right font-num text-xs whitespace-nowrap', (row.aging[b] || 0) !== 0 && 'text-foreground')}>
                              {(row.aging[b] || 0) !== 0 ? row.aging[b].toLocaleString('zh-CN', { minimumFractionDigits: 2 }) : '-'}
                            </td>
                          ))}
                        </tr>
                      )
                    }
                    // 小计 / 合计行
                    const isTotal = rr.kind === 'total'
                    return (
                      <tr key={idx} className={cn('border-t font-semibold', isTotal ? 'border-t-2 bg-primary/5' : 'bg-muted/50')}>
                        <td className="px-2 py-2 text-xs" colSpan={labelColSpan}>{rr.label}</td>
                        <td className="px-2 py-2 text-right font-num whitespace-nowrap">{rr.closingBalance.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                        {AGING_GROUPS.map((b) => (
                          <td key={b} className="px-2 py-2 text-right font-num text-xs whitespace-nowrap">
                            {(rr.aging[b] || 0) !== 0 ? rr.aging[b].toLocaleString('zh-CN', { minimumFractionDigits: 2 }) : '-'}
                          </td>
                        ))}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 往来单项分析抽屉（入口在筛选行按钮） */}
      <TransactionAnalysisDrawer open={!!analysisTarget} target={analysisTarget} onClose={() => setAnalysisTarget(null)} />
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
                  <tr className="border-b text-center text-black">
                    <th className="px-2 py-2 font-medium">本方公司</th>
                    <th className="px-2 py-2 font-medium">内部对方公司</th>
                    <th className="px-2 py-2 font-medium">方向</th>
                    <th className="px-2 py-2 font-medium">往来类型</th>
                    <th className="px-2 py-2 font-medium">期末余额</th>
                    <th className="px-2 py-2 font-medium">笔数</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((row, idx) => (
                    <tr key={idx} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="px-2 py-2">{row.companyCode}</td>
                      <td className="px-2 py-2">{row.internalPeerCode}</td>
                      <td className="px-2 py-2">
                        <span className={cn('rounded px-1.5 py-0.5 text-xs', row.direction === 'AR' ? 'bg-info/10 text-info' : 'bg-destructive/10 text-destructive')}>
                          {row.direction}
                        </span>
                      </td>
                      <td className="px-2 py-2">{row.transactionType}</td>
                      <td className="px-2 py-2 text-right font-num">{row.closingBalance.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
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
                  <tr className="border-b text-center text-black">
                    <th className="px-2 py-2 font-medium">公司A</th>
                    <th className="px-2 py-2 font-medium">公司B</th>
                    <th className="px-2 py-2 font-medium">AR侧合计</th>
                    <th className="px-2 py-2 font-medium">AP侧合计</th>
                    <th className="px-2 py-2 font-medium">差额(未抵平)</th>
                  </tr>
                </thead>
                <tbody>
                  {mirror.map((row, idx) => (
                    <tr key={idx} className={cn('border-b last:border-0', Math.abs(row.difference) > 0.01 && 'bg-warning/[0.08]')}>
                      <td className="px-2 py-2">{row.companyA}</td>
                      <td className="px-2 py-2">{row.companyB}</td>
                      <td className="px-2 py-2 text-right font-num">{row.arAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-2 py-2 text-right font-num">{row.apAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                      <td className={cn('px-2 py-2 text-right font-num font-medium', Math.abs(row.difference) > 0.01 ? 'text-warning-strong' : 'text-success-strong')}>
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
            <TabsTrigger value="account-filter">科目过滤</TabsTrigger>
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
          <TabsContent value="account-filter">
            <AccountFilterTab />
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
