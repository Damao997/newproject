import { useCallback, useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import ReactECharts, { echarts } from '@/components/charts/echarts-core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTransactionTrend, useTransactionFiscalYears, useTransactionPeriods } from '@/hooks/api-queries'
import { usePeriodStore } from '@/stores/periodStore'
import { usePageStore, type TransactionOverviewState } from '@/stores/pageStateStore'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { formatMoneyWan } from '@/lib/utils'
import { CHART_FONT, getChartInk, getChartSeries, labelSpan, numSpan, titleSpan, tooltipShell } from '@/lib/chart-theme'
import { useThemeStore } from '@/stores/themeStore'
import { Download, LineChart, RefreshCw } from 'lucide-react'

/**
 * 往来变动趋势折线图：单一往来类型 × 多公司的期末余额月度趋势。
 * 数据来自 GET /transactions/trend（公司×月份 DB 侧聚合）；
 * 公司多选由页面筛选区传入（空数组 = 全部公司合计一条线）。
 * 期间模式：跟随全局 Header 财年（默认）/ 指定财年 / 自定义期间范围（开始=结束即单月）。
 */

const TRANSACTION_TYPES = ['应收账款', '其他应收款', '预收账款', '应付账款', '其他应付款', '预付账款']

export function TransactionTrendCard({ companyCodes }: { companyCodes: string[] }) {
  // 折线色板跟随当前侧边栏风格：按公司顺序轮转，首位为风格主色；主页面恒白，图表框架色恒定
  const sidebarStyle = useThemeStore((s) => s.sidebarStyle)
  // 图表筛选持久化到 pageStateStore（跟随 OverviewTab 生命周期，切 tab/切路由/刷新后恢复）
  const transactionType = usePageStore((s) => s.transactions.overview.trend.type)
  // 期间模式：'fiscal' = 跟随全局 Header 财年（默认）；'custom' = 自定义期间范围；'FYxxxx' = 指定财年
  const rangeMode = usePageStore((s) => s.transactions.overview.trend.rangeMode)
  const customFrom = usePageStore((s) => s.transactions.overview.trend.customFrom)
  const customTo = usePageStore((s) => s.transactions.overview.trend.customTo)
  const setTrend = useCallback((patch: Partial<TransactionOverviewState['trend']>) => {
    const cur = usePageStore.getState().transactions.overview.trend
    usePageStore.getState().setTransactionsTab('overview', { trend: { ...cur, ...patch } })
  }, [])
  const setTransactionType = useCallback((v: string) => setTrend({ type: v }), [setTrend])
  const setRangeMode = useCallback((v: string) => setTrend({ rangeMode: v }), [setTrend])
  const setCustomFrom = useCallback((v: string) => setTrend({ customFrom: v }), [setTrend])
  const setCustomTo = useCallback((v: string) => setTrend({ customTo: v }), [setTrend])
  const { getDisplayName } = useCompanyDisplayName()
  const { data: fiscalYears } = useTransactionFiscalYears()
  const { data: periods } = useTransactionPeriods()
  const fiscalYear = usePeriodStore((s) => s.fiscalYear)

  // 请求参数推导：自定义期间（未选完时返回 null 禁用查询）> 跟随全局财年 > 指定财年
  const trendParams = useMemo(() => {
    if (rangeMode === 'custom') {
      if (!customFrom || !customTo) return null
      // 开始晚于结束时自动交换归一，无需限制 UI 选择
      const [from, to] = customFrom > customTo ? [customTo, customFrom] : [customFrom, customTo]
      return { transactionType, companyCodes, periodFrom: from, periodTo: to }
    }
    if (rangeMode === 'fiscal') {
      // 默认遵循全局财年筛选器；未归一化（null）时回退最近 12 个月
      return fiscalYear ? { transactionType, companyCodes, fiscalYear } : { transactionType, companyCodes, months: 12 }
    }
    return { transactionType, companyCodes, fiscalYear: rangeMode }
  }, [transactionType, companyCodes, rangeMode, customFrom, customTo, fiscalYear])

  const { data, isLoading, isError, error, refetch, isFetching } = useTransactionTrend(
    trendParams ?? { transactionType, companyCodes },
    { enabled: !!trendParams },
  )

  const hasData = !!data && data.series.length > 0 && data.series.some((s) => s.points.some((p) => p !== null))

  const option = useMemo<EChartsOption>(() => {
    const ink = getChartInk()
    const lineColors = getChartSeries(sidebarStyle)
    const periods = data?.periods ?? []
    const series = data?.series ?? []
    return {
      textStyle: {
        fontFamily: CHART_FONT,
      },
      tooltip: {
        trigger: 'axis',
        order: 'valueDesc',
        ...tooltipShell(ink),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return ''
          let result = titleSpan(`${params[0].axisValue} · ${transactionType}`, ink)
          for (const item of params) {
            if (item.value === null || item.value === undefined) continue
            result += `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin:4px 0">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="display:inline-block;width:8px;height:2px;border-radius:1px;background:${item.color}"></span>
                ${labelSpan(item.seriesName, ink)}
              </div>
              ${numSpan(formatMoneyWan(item.value))}
            </div>`
          }
          return result
        },
      },
      // B 端 SaaS 图例：公司名即系列名（类型已在卡头下拉体现，不再重复拼接），小色点 + 紧凑间距
      legend: {
        data: series.map((s) => getDisplayName(s.companyCode, s.companyName)),
        bottom: 0,
        type: 'scroll',
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
        itemGap: 20,
        pageIconSize: 12,
        textStyle: { color: ink.sub, fontSize: 12 },
      },
      grid: { top: 16, right: 24, bottom: 48, left: 64 },
      // 仅保留滚轮/触控板缩放，去掉底部 slider 滑块（视觉噪音，B 端默认隐藏）
      dataZoom: [{ type: 'inside' }],
      xAxis: {
        type: 'category',
        data: periods,
        axisLine: { lineStyle: { color: ink.grid } },
        axisTick: { show: false },
        axisLabel: {
          color: ink.axis,
          fontSize: 11,
          formatter: (value: string) => {
            const parts = value.split('-')
            return `${parts[0].slice(2)}/${parts[1]}`
          },
        },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        // 淡实线网格（--border-subtle），比虚线更贴近 antd B 端图表质感
        splitLine: { lineStyle: { color: '#F0F0F0' } },
        axisLabel: {
          color: ink.axis,
          fontSize: 11,
          formatter: (v: number) => (Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(0)}万` : String(v)),
        },
      },
      series: series.map((s, i) => ({
        name: getDisplayName(s.companyCode, s.companyName),
        type: 'line' as const,
        data: s.points,
        // B 端克制线型：直线连接 + 悬浮才显点，默认无符号噪音
        smooth: false,
        connectNulls: false,
        showSymbol: false,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { color: lineColors[i % lineColors.length], width: 2, cap: 'round' as const },
        itemStyle: { color: lineColors[i % lineColors.length], borderWidth: 2, borderColor: ink.surface },
        emphasis: { focus: 'series' as const, lineStyle: { width: 3 } },
      })),
    }
  }, [data, transactionType, getDisplayName, sidebarStyle])

  // CSV 导出：公司,往来类型,期间,期末余额（BOM 防中文乱码）
  // 注意：数值保持 toFixed(2) 原始格式 —— 加千分位会引入逗号破坏 CSV 分隔
  const handleExport = async () => {
    if (!data) return
    const lines = ['公司,往来类型,期间,期末余额']
    for (const s of data.series) {
      data.periods.forEach((p, i) => {
        const v = s.points[i]
        if (v === null || v === undefined) return
        lines.push(`${s.companyName || s.companyCode},${transactionType},${p},${v.toFixed(2)}`)
      })
    }
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    // 按需加载 file-saver，避免进入首屏 chunk
    const { saveAs } = await import('file-saver')
    saveAs(blob, `往来变动趋势_${transactionType}_${data.periods[0] ?? ''}_${data.periods[data.periods.length - 1] ?? ''}.csv`)
  }

  return (
    <Card className="border border-border">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <LineChart className="h-4 w-4" />
            往来变动趋势
          </CardTitle>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Select value={transactionType} onValueChange={setTransactionType}>
              <SelectTrigger className="h-8 w-[130px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSACTION_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={rangeMode} onValueChange={setRangeMode}>
              <SelectTrigger className="h-8 w-[150px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fiscal">{fiscalYear ? `当前财年 ` : '财年'}</SelectItem>
                {/* 指定财年选项排除全局 Header 已选财年，避免与「财年 FYxxxx」重复显示；未归一化（null）时全量列出 */}
                {(fiscalYears || []).filter((fy) => fy !== fiscalYear).map((fy) => (
                  <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                ))}
                <SelectItem value="custom">自定义期间…</SelectItem>
              </SelectContent>
            </Select>
            {rangeMode === 'custom' && (
              <>
                <Select value={customFrom} onValueChange={setCustomFrom}>
                  <SelectTrigger className="h-8 w-[130px] text-sm">
                    <SelectValue placeholder="开始期间" />
                  </SelectTrigger>
                  <SelectContent>
                    {(periods || []).map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">至</span>
                <Select value={customTo} onValueChange={setCustomTo}>
                  <SelectTrigger className="h-8 w-[130px] text-sm">
                    <SelectValue placeholder="结束期间" />
                  </SelectTrigger>
                  <SelectContent>
                    {(periods || []).map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
            <Button variant="outline" size="sm" className="h-8" disabled={!hasData} onClick={handleExport}>
              <Download className="mr-1 h-3.5 w-3.5" />
              导出 CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">加载中…</div>
        ) : isError ? (
          <div className="flex h-[320px] flex-col items-center justify-center gap-3">
            <p className="text-sm text-destructive">{error instanceof Error ? error.message : '数据加载失败'}</p>
            <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              重试
            </Button>
          </div>
        ) : !hasData ? (
          <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
            {rangeMode === 'custom' && (!customFrom || !customTo) ? '请选择开始与结束期间' : '暂无数据'}
          </div>
        ) : (
          <ReactECharts
            echarts={echarts}
            option={option}
            notMerge
            style={{ height: 320, width: '100%' }}
            opts={{ renderer: 'svg' }}
          />
        )}
      </CardContent>
    </Card>
  )
}
