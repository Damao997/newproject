import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { PageContainer } from '@/components/layout/page-container'
import { useCompanies, useTransactionOverview, useTransactionDetails, useTransactionAging, useInternalSummary, useInternalMirrorCheck } from '@/hooks/api-queries'
import { cn } from '@/lib/utils'
import { ArrowLeftRight, TrendingUp, TrendingDown, Building2, AlertTriangle } from 'lucide-react'
import type { TransactionDetailItem, AgingAnalysisRow, InternalSummaryRow, InternalMirrorRow } from '@/types'

const TRANSACTION_TYPES = ['应收账款', '其他应收款', '预收账款', '应付账款', '其他应付款', '预付账款']
const AGING_BUCKETS = ['1个月', '2个月', '3个月', '4个月', '5个月', '6个月', '半年到1年', '1年到2年', '2年到3年', '3年以上']

function formatAmount(v: number): string {
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(2)}万`
  return v.toFixed(2)
}

// ===== 总览 Tab =====
function OverviewTab({ companyCode }: { companyCode?: string }) {
  const { data: overview, isLoading } = useTransactionOverview(companyCode)

  if (isLoading) return <div className="py-12 text-center text-sm text-muted-foreground">加载中...</div>
  if (!overview?.length) return <div className="py-12 text-center text-sm text-muted-foreground">暂无往来数据</div>

  const arItems = overview.filter((i) => i.direction === 'AR')
  const apItems = overview.filter((i) => i.direction === 'AP')
  const totalAR = arItems.reduce((s, i) => s + i.totalClosingBalance, 0)
  const totalAP = apItems.reduce((s, i) => s + i.totalClosingBalance, 0)

  return (
    <div className="space-y-6">
      {/* 汇总卡片 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <TrendingUp className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">应收类合计</p>
              <p className="text-xl font-bold">{formatAmount(totalAR)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 pt-6">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-red-100 dark:bg-red-900/30">
              <TrendingDown className="h-6 w-6 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">应付类合计</p>
              <p className="text-xl font-bold">{formatAmount(totalAP)}</p>
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
              <p className="text-xl font-bold">{formatAmount(totalAR - totalAP)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 六大往来分类卡片 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {overview.map((item) => (
          <Card key={item.transactionType}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>{item.transactionType}</span>
                <span className={cn('rounded px-1.5 py-0.5 text-xs', item.direction === 'AR' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300')}>
                  {item.direction}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{formatAmount(item.totalClosingBalance)}</p>
              <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
                <span>笔数: {item.recordCount}</span>
                <span>内部: {item.internalCount}</span>
                <span>外部: {item.externalCount}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

// ===== 明细 Tab =====
function DetailsTab({ companyCode }: { companyCode?: string }) {
  const [page, setPage] = useState(1)
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [keyword, setKeyword] = useState('')

  const { data, isLoading } = useTransactionDetails({
    page,
    pageSize: 20,
    companyCode,
    transactionType: typeFilter || undefined,
    counterpartyKeyword: keyword || undefined,
  })

  const items = (data?.items || []) as TransactionDetailItem[]
  const total = data?.total || 0
  const totalPages = data?.totalPages || 1

  return (
    <div className="space-y-4">
      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v === 'all' ? '' : v); setPage(1) }}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="往来类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            {TRANSACTION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          placeholder="搜索往来对象..."
          className="w-[200px]"
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); setPage(1) }}
        />
      </div>

      {/* 表格 */}
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
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-2 py-2 font-medium">往来类型</th>
                    <th className="px-2 py-2 font-medium">往来对象</th>
                    <th className="px-2 py-2 font-medium">科目</th>
                    <th className="px-2 py-2 font-medium">单据号</th>
                    <th className="px-2 py-2 text-right font-medium">期末余额</th>
                    <th className="px-2 py-2 text-right font-medium">账龄天数</th>
                    <th className="px-2 py-2 font-medium">内部标记</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.id} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="px-2 py-2">{row.transactionType}</td>
                      <td className="px-2 py-2">
                        <div>{row.counterpartyName || '-'}</div>
                        <div className="text-xs text-muted-foreground">{row.counterpartyCode}</div>
                      </td>
                      <td className="px-2 py-2 text-xs">{row.accountDesc || row.accountCode}</td>
                      <td className="px-2 py-2 text-xs">{row.documentNo || '-'}</td>
                      <td className="px-2 py-2 text-right font-mono">{row.closingBalance.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                      <td className="px-2 py-2 text-right">{row.agingDays ?? '-'}</td>
                      <td className="px-2 py-2">
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
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">共 {total} 条</span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
            <span className="flex items-center px-2 text-sm">{page} / {totalPages}</span>
            <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</Button>
          </div>
        </div>
      )}
    </div>
  )
}

// ===== 账龄分析 Tab =====
function AgingTab({ companyCode }: { companyCode?: string }) {
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [groupBy, setGroupBy] = useState<string>('type')

  const { data: agingData, isLoading } = useTransactionAging({
    companyCode,
    transactionType: typeFilter || undefined,
    groupBy,
  })

  const rows = (agingData || []) as AgingAnalysisRow[]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="往来类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            {TRANSACTION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={groupBy} onValueChange={setGroupBy}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="分组方式" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="type">按往来类型</SelectItem>
            <SelectItem value="counterparty">按往来对象</SelectItem>
            <SelectItem value="account">按科目</SelectItem>
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
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-2 py-2 font-medium">公司</th>
                    <th className="px-2 py-2 font-medium">往来类型</th>
                    {groupBy === 'counterparty' && <th className="px-2 py-2 font-medium">往来对象</th>}
                    {groupBy === 'account' && <th className="px-2 py-2 font-medium">科目</th>}
                    <th className="px-2 py-2 text-right font-medium">期末余额</th>
                    {AGING_BUCKETS.map((b) => (
                      <th key={b} className="px-2 py-2 text-right font-medium whitespace-nowrap">{b}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={idx} className="border-b last:border-0 hover:bg-muted/50">
                      <td className="px-2 py-2 text-xs">{row.companyName || row.companyCode}</td>
                      <td className="px-2 py-2">{row.transactionType}</td>
                      {groupBy === 'counterparty' && <td className="px-2 py-2 text-xs">{row.counterpartyName || row.counterpartyCode || '-'}</td>}
                      {groupBy === 'account' && <td className="px-2 py-2 text-xs">{row.accountDesc || row.accountCode || '-'}</td>}
                      <td className="px-2 py-2 text-right font-mono font-medium">{row.closingBalance.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                      {AGING_BUCKETS.map((b) => (
                        <td key={b} className={cn('px-2 py-2 text-right font-mono text-xs', (row.aging[b] || 0) !== 0 && 'text-foreground')}>
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
function InternalTab({ companyCode }: { companyCode?: string }) {
  const { data: summaryData, isLoading: summaryLoading } = useInternalSummary(companyCode)
  const { data: mirrorData, isLoading: mirrorLoading } = useInternalMirrorCheck(companyCode)

  const summary = (summaryData || []) as InternalSummaryRow[]
  const mirror = (mirrorData || []) as InternalMirrorRow[]

  return (
    <div className="space-y-6">
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
  const [companyFilter, setCompanyFilter] = useState('all')
  const { data: companies } = useCompanies()

  const companyCode = companyFilter === 'all' ? undefined : companyFilter

  return (
    <PageContainer
      title="往来分析"
      description="六大往来总览、客商明细、账龄分析、内部往来抵消"
    >
      <div className="space-y-4">
        {/* 公司筛选 */}
        <div className="flex items-center gap-3">
          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="选择公司" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部公司</SelectItem>
              {(companies || []).map((c) => (
                <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Tab 切换 */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="overview">总览</TabsTrigger>
            <TabsTrigger value="details">明细查询</TabsTrigger>
            <TabsTrigger value="aging">账龄分析</TabsTrigger>
            <TabsTrigger value="internal">内部往来</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab companyCode={companyCode} />
          </TabsContent>
          <TabsContent value="details">
            <DetailsTab companyCode={companyCode} />
          </TabsContent>
          <TabsContent value="aging">
            <AgingTab companyCode={companyCode} />
          </TabsContent>
          <TabsContent value="internal">
            <InternalTab companyCode={companyCode} />
          </TabsContent>
        </Tabs>
      </div>
    </PageContainer>
  )
}
