import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import ReactECharts, { echarts } from '@/components/charts/echarts-core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoneyWan } from '@/lib/utils'
import { CHART_FONT, CHART_INK, getChartSeries, labelSpan, numSpan, titleSpan, tooltipShell } from '@/lib/chart-theme'
import { useThemeStore } from '@/stores/themeStore'
import { PieChart } from 'lucide-react'
import type { InventoryCategoryRow } from '@/hooks/api-queries'
import { EmptyHint } from './empty-hint'

/**
 * 存货品类占比饼图：按品类本期金额展示占比结构，环形中心显示正值合计总额。
 * 金额 ≤0 的品类不进饼图（占比无意义），负值品类在卡片脚注说明。
 * 点击扇区触发品类钻取（onCategoryClick），联动明细表筛选。
 */

export function CategoryPieCard({ categories, loading, onCategoryClick }: {
  categories: InventoryCategoryRow[]
  loading?: boolean
  onCategoryClick?: (code: string) => void
}) {
  // 分类色板跟随当前品牌主题：按序轮转，首位为品牌主色
  const theme = useThemeStore((s) => s.theme)
  // 饼图仅纳入正金额品类；负值品类记入脚注提示
  const pieData = useMemo(() => categories.filter((c) => c.current > 0), [categories])
  const negatives = useMemo(() => categories.filter((c) => c.current < 0), [categories])
  const sum = useMemo(() => pieData.reduce((s, c) => s + c.current, 0), [pieData])
  // ECharts click 回调仅能拿到 name，这里维护 名称→编码 映射用于钻取
  const nameToCode = useMemo(() => new Map(pieData.map((c) => [c.name, c.code])), [pieData])

  const option = useMemo<EChartsOption>(() => {
    const seriesColors = getChartSeries(theme)
    return {
      animation: false,
      textStyle: {
        fontFamily: CHART_FONT,
      },
      tooltip: {
        trigger: 'item',
        ...tooltipShell,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          const pct = sum > 0 ? ((params.value / sum) * 100).toFixed(1) : '0.0'
          return titleSpan(params.name)
            + `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px">
              ${labelSpan('金额')}
              ${numSpan(formatMoneyWan(params.value))}
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:16px">
              ${labelSpan('占比')}
              ${numSpan(`${pct}%`)}
            </div>
            <div style="margin-top:6px;color:${CHART_INK.axis};font-size:11px">点击钻取该品类明细</div>`
        },
      },
      series: [
        {
          type: 'pie',
          radius: ['42%', '70%'],
          center: ['50%', '50%'],
          itemStyle: { borderColor: CHART_INK.surface, borderWidth: 2, borderRadius: 4 },
          emphasis: { scale: true, scaleSize: 4 },
          label: {
            fontSize: 11,
            color: CHART_INK.sub,
            formatter: (p: { name: string; percent?: number }) => `${p.name} ${p.percent?.toFixed(1) ?? 0}%`,
          },
          labelLine: { length: 10, length2: 8, lineStyle: { color: CHART_INK.grid } },
          data: pieData.map((c, i) => ({
            name: c.name,
            value: c.current,
            itemStyle: { color: seriesColors[i % seriesColors.length] },
          })),
        },
      ],
    }
  }, [pieData, sum, theme])

  return (
    <Card className="animate-fade-in">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <PieChart className="h-4 w-4" />
          品类金额占比
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="skeleton h-[260px] w-full rounded-lg lg:h-[320px]" />
        ) : pieData.length === 0 ? (
          <EmptyHint
            icon={PieChart}
            title="暂无品类数据"
            hint="当前公司/期间无正金额存货品类，请调整筛选条件"
            className="h-[260px] lg:h-[320px]"
          />
        ) : (
          <>
            <div className="relative h-[260px] w-full lg:h-[320px]">
              <ReactECharts
                echarts={echarts}
                option={option}
                notMerge
                style={{ height: '100%', width: '100%' }}
                opts={{ renderer: 'svg' }}
                onEvents={{
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  click: (params: any) => {
                    const code = nameToCode.get(params?.name ?? '')
                    if (code) onCategoryClick?.(code)
                  },
                }}
              />
              {/* 环形中心总额（与图表 center 50%/50% 对齐，不拦截鼠标事件） */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xs text-muted-foreground">存货总额</span>
                <span className="font-num text-lg font-semibold">{formatMoneyWan(sum)}</span>
              </div>
            </div>
            {negatives.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                金额为负的品类未计入饼图：{negatives.map((c) => `${c.name}（${formatMoneyWan(c.current)}）`).join('、')}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
