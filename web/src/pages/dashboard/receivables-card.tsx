import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import ReactECharts, { echarts } from '@/components/charts/echarts-core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useDashboardReceivables } from '@/hooks/api-queries'
import { formatMoneyWan } from '@/lib/utils'
import { CHART_FONT, getChartInk, getChartSeries, labelSpan, numSpan, titleSpan, tooltipShell } from '@/lib/chart-theme'
import { useThemeStore } from '@/stores/themeStore'

interface ReceivablesCardProps {
  /** 选定期（跟随看板当前期间） */
  period?: string
  /** 主体编码（跟随看板顶部筛选）：单体=自身一行，汇总主体由后端展开为成员公司各行 */
  companyCode?: string
}

/**
 * 应收账款分析卡（横向柱状图）：指定期间各主体应收期末余额降序排布，
 * 主体口径完全跟随看板顶部筛选（无独立筛选器）：单体=自身，汇总主体=其成员公司各行；
 * 期间跟随看板当前期间。数据经后端 scope 过滤。
 */
export function ReceivablesCard({ period, companyCode }: ReceivablesCardProps) {
  const { data, isLoading } = useDashboardReceivables({ period, mode: 'single', companyCode })
  const rows = useMemo(() => data?.rows ?? [], [data])
  // 分类色板跟随当前侧边栏风格：按序轮转，首位为风格主色；主页面恒白，图表框架色恒定
  const sidebarStyle = useThemeStore((s) => s.sidebarStyle)

  const option = useMemo<EChartsOption>(() => {
    const ink = getChartInk()
    const seriesColors = getChartSeries(sidebarStyle)
    const byName = new Map(rows.map((r) => [r.name, r]))
    const total = rows.reduce((s, r) => s + r.balance, 0)
    return {
      animation: false,
      textStyle: {
        fontFamily: CHART_FONT,
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(0, 0, 0, 0.04)' } },
        ...tooltipShell(ink),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          const item = Array.isArray(params) ? params[0] : params
          const row = byName.get(item?.name)
          if (!row) return ''
          const pct = total ? ((row.balance / total) * 100).toFixed(1) : '0.0'
          const line = (label: string, value: string) =>
            `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin:2px 0">
              ${labelSpan(label, ink)}
              ${numSpan(value)}
            </div>`
          return titleSpan(row.name, ink)
            + line('应收余额', formatMoneyWan(row.balance))
            + line('占比', `${pct}%`)
        },
      },
      grid: { top: 8, right: 48, bottom: 8, left: 8, containLabel: true },
      xAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: ink.grid, type: 'dashed' } },
        axisLabel: { color: ink.axis, fontSize: 11 },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: rows.map((r) => r.name),
        axisLine: { lineStyle: { color: ink.grid } },
        axisTick: { show: false },
        axisLabel: { color: ink.sub, fontSize: 11 },
      },
      series: [
        {
          type: 'bar',
          barWidth: 18,
          data: rows.map((r, i) => ({
            value: r.balance,
            itemStyle: { color: seriesColors[i % seriesColors.length], borderRadius: [0, 4, 4, 0] },
          })),
          // hover 缩放 + 投影：提升交互辨识度（SVG 渲染器下同样生效）
          emphasis: {
            scale: true,
            scaleSize: 4,
            itemStyle: {
              shadowBlur: 8,
              shadowColor: 'rgba(0, 0, 0, 0.15)',
            },
          },
          label: {
            show: true,
            position: 'right',
            fontSize: 10,
            color: ink.axis,
            fontFamily: CHART_FONT,
            formatter: (p: { value?: number | unknown }) => formatMoneyWan(Number(p.value ?? 0)),
          },
        },
      ],
    }
  }, [rows, sidebarStyle])

  return (
    <Card className="animate-fade-in" style={{ animationDelay: '200ms' }}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 px-6 pb-3 pt-5">
        <div>
          <CardTitle className="text-lg font-semibold">
            应收账款分析
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {period ? `期间 ${period} · ` : ''}单位：万元 · 金额：应收期末余额（万元）
          </p>
        </div>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        {isLoading ? (
          <div className="skeleton h-[260px] w-full rounded-lg lg:h-[320px]" />
        ) : !period ? (
          <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground lg:h-[320px]">
            正在加载期间数据...
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground lg:h-[320px]">
            当前期间暂无应收账款数据
          </div>
        ) : (
          <div className="h-[260px] w-full lg:h-[320px]">
            <ReactECharts
              echarts={echarts}
              option={option}
              notMerge
              style={{ height: '100%', width: '100%' }}
              opts={{ renderer: 'svg' }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
