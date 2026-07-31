import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import ReactECharts, { echarts } from '@/components/charts/echarts-core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoneyWan } from '@/lib/utils'
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
        fontFamily: "'Microsoft YaHei', '微软雅黑', sans-serif",
      },
      tooltip: {
        trigger: 'item',
        backgroundColor: '#fff',
        borderColor: '#E2E8F0',
        borderWidth: 1,
        padding: [12, 16],
        textStyle: { color: '#1E293B', fontSize: 13 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          const pct = sum > 0 ? ((params.value / sum) * 100).toFixed(1) : '0.0'
          return `<div style="font-weight:600;margin-bottom:6px;color:#0F172A;font-size:14px">${params.name}</div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:16px">
              <span style="color:#64748B;font-size:12px">金额</span>
              <span style="font-weight:500;font-family:'Microsoft YaHei','微软雅黑',sans-serif;font-variant-numeric:tabular-nums;font-size:13px">${formatMoneyWan(params.value)}</span>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:16px">
              <span style="color:#64748B;font-size:12px">占比</span>
              <span style="font-weight:500;font-family:'Microsoft YaHei','微软雅黑',sans-serif;font-variant-numeric:tabular-nums;font-size:13px">${pct}%</span>
            </div>`
        },
      },
      series: [
        {
          type: 'pie',
          radius: ['42%', '70%'],
          center: ['50%', '50%'],
          itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 },
          label: {
            fontSize: 11,
            color: '#64748B',
            formatter: (p: { name: string; percent?: number }) => `${p.name} ${p.percent?.toFixed(1) ?? 0}%`,
          },
          labelLine: { length: 10, length2: 8, lineStyle: { color: '#CBD5E1' } },
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
