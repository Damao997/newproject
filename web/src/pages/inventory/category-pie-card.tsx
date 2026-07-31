import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import ReactECharts, { echarts } from '@/components/charts/echarts-core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoneyWan } from '@/lib/utils'
import { CHART_FONT, CHART_INK, labelSpan, numSpan, titleSpan, tooltipShell } from '@/lib/chart-theme'
import { PieChart } from 'lucide-react'
import type { InventoryCategoryRow } from '@/hooks/api-queries'
import { CATEGORY_COLORS } from './category-colors'

/**
 * 存货品类占比饼图：按品类本期金额展示占比结构。
 * 金额 ≤0 的品类不进饼图（占比无意义），负值品类在卡片脚注说明。
 */

export function CategoryPieCard({ categories, loading }: { categories: InventoryCategoryRow[]; loading?: boolean }) {
  // 饼图仅纳入正金额品类；负值品类记入脚注提示
  const pieData = useMemo(() => categories.filter((c) => c.current > 0), [categories])
  const negatives = useMemo(() => categories.filter((c) => c.current < 0), [categories])

  const option = useMemo<EChartsOption>(() => {
    const sum = pieData.reduce((s, c) => s + c.current, 0)
    return {
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
            </div>`
        },
      },
      series: [
        {
          type: 'pie',
          radius: ['42%', '70%'],
          center: ['50%', '50%'],
          itemStyle: { borderColor: CHART_INK.surface, borderWidth: 2, borderRadius: 4 },
          label: {
            fontSize: 11,
            color: CHART_INK.sub,
            formatter: (p: { name: string; percent?: number }) => `${p.name} ${p.percent?.toFixed(1) ?? 0}%`,
          },
          labelLine: { length: 10, length2: 8, lineStyle: { color: CHART_INK.grid } },
          data: pieData.map((c, i) => ({
            name: c.name,
            value: c.current,
            itemStyle: { color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] },
          })),
        },
      ],
    }
  }, [pieData])

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
          <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">加载中...</div>
        ) : pieData.length === 0 ? (
          <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">暂无数据</div>
        ) : (
          <>
            <ReactECharts
              echarts={echarts}
              option={option}
              notMerge
              style={{ height: 320, width: '100%' }}
              opts={{ renderer: 'svg' }}
            />
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
