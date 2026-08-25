import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { TipLabel } from '@/components/ui/tip-label'
import { RateBar } from '@/components/ui/rate-bar'
import { Skeleton } from '@/components/ui/skeleton'
import { useKeyMetrics } from '@/hooks/api-queries'
import { formatMoneyWan, cn } from '@/lib/utils'
import type { KeyMetricsGroup } from '@/types'
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react'

interface KeyMetricsTableProps {
  /** 选定期（跟随看板当前期间） */
  period?: string
  /** 主体口径（跟随看板顶部筛选，单体/汇总主体编码） */
  companyCode?: string
}

/** 红涨绿跌（A 股/国内财报习惯），0/空灰；缺失（null/undefined，如接口演进前的缓存数据）显示「—」 */
function TrendValue({ value }: { value: number }) {
  if (value == null) return <span className="font-num text-muted-foreground">—</span>
  const cls = value > 0 ? 'text-finance-red' : value < 0 ? 'text-finance-green' : 'text-muted-foreground'
  return <span className={cn('font-num', cls)}>{formatMoneyWan(value)}</span>
}

/** 比率型百分比（同比/环比/累计同比，值为小数比率）：两位小数展示，红涨绿跌；缺失显示「—」 */
function RateValue({ value }: { value: number }) {
  if (value == null) return <span className="font-num text-muted-foreground">—</span>
  const cls = value > 0 ? 'text-finance-red' : value < 0 ? 'text-finance-green' : 'text-muted-foreground'
  return <span className={cn('font-num', cls)}>{(value * 100).toFixed(2)}%</span>
}

function Money({ value }: { value: number | null }) {
  return <span className="font-num text-foreground">{value == null ? '—' : formatMoneyWan(value)}</span>
}

// 表头对齐《统一表格设计标准》：13px/500 黑字居中（数值列表头同样居中）；TD 保持右对齐 font-num
const TH_CLS = 'px-3 py-2 text-center text-[13px] font-medium text-foreground'
const TD_CLS = 'px-3 py-2 text-right font-num text-sm text-foreground'

/** 单行 14 列数值区（月度组 8 + 年度组 6）：同比/环比/累计同比及变动金额红涨绿跌 */
function ValueCells({ g }: { g: KeyMetricsGroup }) {
  return (
    <>
      <td className={TD_CLS}><Money value={g.monthBudget} /></td>
      <td className={TD_CLS}>{formatMoneyWan(g.monthActual)}</td>
      <td className={cn(TD_CLS, 'text-muted-foreground')}>{formatMoneyWan(g.monthSame)}</td>
      <td className={TD_CLS}><TrendValue value={g.monthChange} /></td>
      <td className={TD_CLS}><RateValue value={g.monthYoy} /></td>
      <td className={TD_CLS}><TrendValue value={g.monthMomChange} /></td>
      <td className={TD_CLS}><RateValue value={g.monthMom} /></td>
      <td className={TD_CLS}><RateBar rate={g.monthRate} /></td>
      <td className={TD_CLS}><Money value={g.annualBudget} /></td>
      <td className={TD_CLS}>{formatMoneyWan(g.ytdActual)}</td>
      <td className={cn(TD_CLS, 'text-muted-foreground')}>{formatMoneyWan(g.ytdSame)}</td>
      <td className={TD_CLS}><TrendValue value={g.ytdChange} /></td>
      <td className={TD_CLS}><RateValue value={g.ytdYoy} /></td>
      <td className={TD_CLS}><RateBar rate={g.annualRate} /></td>
    </>
  )
}

/**
 * 壹品慧关键指标表：损益板块（收入/毛利合计 + 产品明细、运营费用、财务费用、净利润）+ 现金流板块
 * （自由现金流/经营性/投资性/筹资性现金净流量）的 13 列口径表。
 * - 收入/毛利行可展开产品明细（按产品配置维度），行尾主题色「展开/收起」文字切换明细；渠道维度本期无数据源，展示空态提示；
 * - 运营费用行点击「明细」跳转经营分析·运营费用子页；
 * - 同比/环比/累计同比及其变动金额红涨绿跌；金额千分位、百分比两位小数；预算/完成率无数据为「—」。
 */
export function KeyMetricsTable({ period, companyCode }: KeyMetricsTableProps) {
  const { data, isLoading, isError, isFetching, refetch } = useKeyMetrics({ period, companyCode })
  const [dimension, setDimension] = useState<'product' | 'channel'>('product')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ income: false, profit: false })
  const navigate = useNavigate()

  const rows = data?.rows ?? []
  const incomeRow = rows.find((r) => r.key === 'income')
  const profitRow = rows.find((r) => r.key === 'profit')
  const otherRows = rows.filter((r) => !['income', 'profit'].includes(r.key))
  const isEmpty = !isLoading && !isError && rows.length === 0

  const toggle = (key: string) => setExpanded((s) => ({ ...s, [key]: !s[key] }))

  const renderExpandable = (row: { key: string; label: string; category: string; products: { name: string; income: KeyMetricsGroup; profit: KeyMetricsGroup }[]; values: KeyMetricsGroup }, groupOf: (p: { name: string; income: KeyMetricsGroup; profit: KeyMetricsGroup }) => KeyMetricsGroup) => {
    const open = !!expanded[row.key]
    return (
      <>
        <tr className="hover:bg-muted/30">
          {/* 主行（未展开）指标名恒单行：固定 w-[10em] 与明细行一致，按钮 whitespace-nowrap 防换行 */}
          <td className={cn(TD_CLS, 'text-left font-medium', 'w-[10em]')}>
            <button type="button" onClick={() => toggle(row.key)} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-primary" title={open ? '收起明细' : '展开明细'}>
              {row.label}
              <span className="text-xs text-chart-1">{open ? '收起' : '展开'}</span>
            </button>
          </td>
          <ValueCells g={row.values} />
        </tr>
        {open && (
          dimension === 'product' ? (
            row.products.length > 0 ? (
              row.products.map((p) => {
                // 截断判定：空格不计入字符数（去空格后超过 10 字符才截断，避免短名称因空格误截）
                const needsTruncate = p.name.replace(/\s/g, '').length > 10
                return (
                  <tr key={p.name} className="bg-muted/20 hover:bg-muted/30">
                    {/* 名称单行截断（空格不计入 10 字符判定）：span 固定 w-[10em] + truncate，与表头列宽一致，任何情况下不换行不撑列 */}
                    <td className={cn(TD_CLS, 'pl-7 text-left text-muted-foreground', 'w-[10em]')}>
                      {needsTruncate ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="block w-[10em] truncate">{p.name}</span>
                          </TooltipTrigger>
                          <TooltipContent side="top">{p.name}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="block w-[10em] truncate">{p.name}</span>
                      )}
                    </td>
                    <ValueCells g={groupOf(p)} />
                  </tr>
                )
              })
            ) : (
              <tr>
                <td colSpan={15} className="px-3 py-3 text-center text-xs text-muted-foreground">
                  暂无产品明细（可在「数据管理 · 看板管理 · 产品配置」中维护产品与收入科目关键词的对应关系）
                </td>
              </tr>
            )
          ) : (
            <tr>
              <td colSpan={15} className="px-3 py-3 text-center text-xs text-muted-foreground">
                渠道配置待看板管理扩展后启用，当前仅支持产品维度明细
              </td>
            </tr>
          )
        )}
      </>
    )
  }

  return (
    <TooltipProvider>
    <div className="flex min-h-0 flex-col space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={dimension} onValueChange={(v) => setDimension(v as 'product' | 'channel')}>
          <TabsList variant="segmented" className="justify-start">
            <TabsTrigger value="product">按产品</TabsTrigger>
            <TabsTrigger value="channel">按渠道</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isLoading ? (
        <div className="space-y-2 py-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <p className="text-sm font-medium text-foreground">关键指标数据加载失败</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            重试
          </Button>
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
            <Inbox className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-foreground">暂无经营数据</p>
          <p className="text-xs text-muted-foreground">当前主体或期间暂无数据，请调整筛选后重试</p>
        </div>
      ) : (
        <div className={cn('min-h-0 overflow-x-auto overflow-y-auto transition-opacity duration-200', isFetching && 'opacity-60')}>
          {/* border-separate：sticky 表头单元格边框随滚动稳定跟随（collapse 模式下边框渲染异常，对齐 DataTable 限高模式） */}
          <table className="w-full border-separate border-spacing-0 text-sm [&_th]:border-b [&_td]:border-b [&_th]:border-border [&_td]:border-border">
            {/* 分组表头整体吸顶：页面同色白底（不透明，防止滚动内容透出；与品类预算达成卡表头一致，无灰底填充） */}
            <thead className="sticky top-0 z-20 bg-background">
              <tr>
                {/* 首列固定宽度 w-[10em]：auto 表格布局下 width 参与列宽分配，配合 td 内 span 固定宽截断，保证指标列单行不撑开 */}
                <th rowSpan={2} className={cn(TH_CLS, 'text-left', 'w-[10em]')}>指标</th>
                <th colSpan={8} className={cn(TH_CLS, 'font-semibold')}>月度分析</th>
                <th colSpan={6} className={cn(TH_CLS, 'font-semibold')}>年度分析</th>
              </tr>
              <tr>
                <th className={TH_CLS}>月度预算</th>
                <th className={TH_CLS}>本期实际</th>
                <th className={TH_CLS}>去年同期</th>
                <th className={TH_CLS}>同比变动</th>
                <th className={TH_CLS}><TipLabel label="同比" tip="（本期-去年同期）÷去年同期" /></th>
                <th className={TH_CLS}>环比变动</th>
                <th className={TH_CLS}><TipLabel label="环比" tip="（本期-上期）÷上期" /></th>
                <th className={TH_CLS}><TipLabel label="完成率" tip="本月实际÷当月预算" /></th>
                <th className={TH_CLS}>年度预算</th>
                <th className={TH_CLS}>本年累计</th>
                <th className={TH_CLS}>同期累计</th>
                <th className={TH_CLS}>同比变动</th>
                <th className={TH_CLS}><TipLabel label="累计同比" tip="（累计金额-同期累计）÷同期累计" /></th>
                <th className={TH_CLS}><TipLabel label="年度完成率" tip="累计金额÷年度预算" /></th>
              </tr>
            </thead>
            <tbody>
              {/* 损益板块 */}
              <tr className="bg-muted/40">
                <td colSpan={15} className="px-3 py-1.5 text-left text-xs font-semibold text-foreground">损益</td>
              </tr>
              {incomeRow && renderExpandable(incomeRow, (p) => p.income)}
              {profitRow && renderExpandable(profitRow, (p) => p.profit)}
              {otherRows
                .filter((r) => ['expense', 'finance', 'netProfit'].includes(r.key))
                .map((r) => (
                  <tr key={r.key} className="hover:bg-muted/30">
                    {/* 主行指标名恒单行：固定 w-[10em]，按钮 whitespace-nowrap、纯文本 truncate */}
                    <td className={cn(TD_CLS, 'text-left font-medium', 'w-[10em]')}>
                      {r.key === 'expense' ? (
                        <button type="button" onClick={() => navigate('/dashboard/analysis/expense')} className="inline-flex items-center gap-1 whitespace-nowrap hover:text-primary" title="跳转运营费用明细表">
                          {r.label}
                          <span className="text-xs text-chart-1">明细</span>
                        </button>
                      ) : (
                        <span className="block truncate">{r.label}</span>
                      )}
                    </td>
                    <ValueCells g={r.values} />
                  </tr>
                ))}
              {/* 现金流板块 */}
              <tr className="bg-muted/40">
                <td colSpan={15} className="px-3 py-1.5 text-left text-xs font-semibold text-foreground">现金流</td>
              </tr>
              {otherRows
                .filter((r) => ['fcf', 'operating', 'investing', 'financing'].includes(r.key))
                .map((r) => (
                  <tr key={r.key} className="hover:bg-muted/30">
                    <td className={cn(TD_CLS, 'text-left font-medium', 'w-[10em]')}>
                      <span className="block truncate">{r.label}</span>
                    </td>
                    <ValueCells g={r.values} />
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </TooltipProvider>
  )
}
