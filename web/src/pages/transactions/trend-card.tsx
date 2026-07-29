import { useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { saveAs } from 'file-saver'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useTransactionTrend, useTransactionFiscalYears } from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { formatMoneyWan } from '@/lib/utils'
import { Download, LineChart, RefreshCw } from 'lucide-react'

/**
 * 往来变动趋势折线图：单一往来类型 × 多公司的期末余额月度趋势。
 * 数据来自 GET /transactions/trend（公司×月份 DB 侧聚合）；
 * 公司多选由页面筛选区传入（空数组 = 全部公司合计一条线）。
 */

const TRANSACTION_TYPES = ['应收账款', '其他应收款', '预收账款', '应付账款', '其他应付款', '预付账款']

const MONTH_OPTIONS = [
  { value: 6, label: '最近 6 个月' },
  { value: 12, label: '最近 12 个月' },
  { value: 24, label: '最近 24 个月' },
  { value: 36, label: '最近 36 个月' },
]

/** 折线色板：按公司顺序轮转，风格与看板图表一致 */
const LINE_COLORS = ['#3B82F6', '#F97316', '#10B981', '#8B5CF6', '#EF4444', '#06B6D4', '#EAB308', '#EC4899', '#84CC16', '#64748B']

export function TransactionTrendCard({ companyCodes }: { companyCodes: string[] }) {
  const [transactionType, setTransactionType] = useState('应收账款')
  // 期间范围：数字串 = 最近 N 个月；FYxxxx = 完整财年轴
  const [range, setRange] = useState('12')
  const { getDisplayName } = useCompanyDisplayName()
  const { data: fiscalYears } = useTransactionFiscalYears()

  const isMonths = /^\d+$/.test(range)
  const { data, isLoading, isError, error, refetch, isFetching } = useTransactionTrend({
    transactionType,
    companyCodes,
    ...(isMonths ? { months: Number(range) } : { fiscalYear: range }),
  })

  const hasData = !!data && data.series.length > 0 && data.series.some((s) => s.points.some((p) => p !== null))

  const option = useMemo<EChartsOption>(() => {
    const periods = data?.periods ?? []
    const series = data?.series ?? []
    return {
      textStyle: {
        fontFamily: "'Microsoft YaHei', '微软雅黑', sans-serif",
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#fff',
        borderColor: '#E2E8F0',
        borderWidth: 1,
        padding: [12, 16],
        textStyle: { color: '#1E293B', fontSize: 13 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          if (!Array.isArray(params) || params.length === 0) return ''
          let result = `<div style="font-weight:600;margin-bottom:8px;color:#0F172A;font-size:14px">${params[0].axisValue} · ${transactionType}</div>`
          for (const item of params) {
            if (item.value === null || item.value === undefined) continue
            result += `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin:4px 0">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${item.color}"></span>
                <span style="color:#64748B;font-size:12px">${item.seriesName}</span>
              </div>
              <span style="font-weight:500;font-family:'Microsoft YaHei','微软雅黑',sans-serif;font-variant-numeric:tabular-nums;font-size:13px">${formatMoneyWan(item.value)}</span>
            </div>`
          }
          return result
        },
      },
      legend: {
        data: series.map((s) => `${getDisplayName(s.companyCode, s.companyName)}·${transactionType}`),
        bottom: 0,
        type: 'scroll',
        itemWidth: 12,
        itemHeight: 8,
        itemGap: 24,
        textStyle: { color: '#64748B', fontSize: 12 },
      },
      grid: { top: 24, right: 24, bottom: 72, left: 72 },
      dataZoom: [
        { type: 'inside' },
        { type: 'slider', height: 16, bottom: 28 },
      ],
      xAxis: {
        type: 'category',
        data: periods,
        axisLine: { lineStyle: { color: '#E2E8F0' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#94A3B8',
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
        splitLine: { lineStyle: { color: '#E2E8F0', type: 'dashed' } },
        axisLabel: {
          color: '#94A3B8',
          fontSize: 11,
          formatter: (v: number) => (Math.abs(v) >= 10000 ? `${(v / 10000).toFixed(0)}万` : String(v)),
        },
      },
      series: series.map((s, i) => ({
        name: `${getDisplayName(s.companyCode, s.companyName)}·${transactionType}`,
        type: 'line' as const,
        data: s.points,
        smooth: 0.4,
        connectNulls: false,
        lineStyle: { color: LINE_COLORS[i % LINE_COLORS.length], width: 2.5, cap: 'round' as const },
        symbol: 'circle',
        symbolSize: 6,
        itemStyle: { color: LINE_COLORS[i % LINE_COLORS.length], borderWidth: 2, borderColor: '#fff' },
      })),
    }
  }, [data, transactionType, getDisplayName])

  // CSV 导出：公司,往来类型,期间,期末余额（BOM 防中文乱码）
  const handleExport = () => {
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
    saveAs(blob, `往来变动趋势_${transactionType}_${data.periods[0] ?? ''}_${data.periods[data.periods.length - 1] ?? ''}.csv`)
  }

  return (
    <Card>
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
            <Select value={range} onValueChange={setRange}>
              <SelectTrigger className="h-8 w-[140px] text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTH_OPTIONS.map((m) => (
                  <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                ))}
                {(fiscalYears || []).map((fy) => (
                  <SelectItem key={fy} value={fy}>{fy}（财年）</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" className="h-8" disabled={!hasData} onClick={handleExport}>
              <Download className="mr-1 h-3.5 w-3.5" />
              导出 CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">加载中...</div>
        ) : isError ? (
          <div className="flex h-[320px] flex-col items-center justify-center gap-3">
            <p className="text-sm text-red-500">{error instanceof Error ? error.message : '数据加载失败'}</p>
            <Button variant="outline" size="sm" disabled={isFetching} onClick={() => refetch()}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              重试
            </Button>
          </div>
        ) : !hasData ? (
          <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">暂无数据</div>
        ) : (
          <ReactECharts
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
