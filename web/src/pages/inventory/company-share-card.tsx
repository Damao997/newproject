import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import ReactECharts, { echarts } from '@/components/charts/echarts-core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatMoneyWan } from '@/lib/utils'
import { CHART_FONT, CHART_INK, labelSpan, numSpan, titleSpan, tooltipShell } from '@/lib/chart-theme'
import { PieChart } from 'lucide-react'
import type { InventoryDetailRow } from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { CATEGORY_COLORS } from './category-colors'
import { EmptyHint } from './empty-hint'

/**
 * 成员单体公司占比饼图：展示所选汇总主体下各成员单体公司本期库存金额占比。
 * 数据来自 GET /inventory/details（公司×品类明细），前端按公司分组求和；
 * 金额 ≤0 的公司不进饼图（占比无意义），负值公司脚注说明。
 * 仅当筛选器恰好选中一个汇总主体时由父级条件渲染。
 */

/** 金额两位小数舍入（与明细表聚合口径一致） */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function CompanyShareCard({ rows, loading }: { rows: InventoryDetailRow[]; loading?: boolean }) {
  const { getDisplayName } = useCompanyDisplayName()
  // 公司 → 本期金额跨品类求和；名称跟随全局「显示简称」开关
  const companies = useMemo(() => {
    const by = new Map<string, { code: string; name: string; current: number }>()
    for (const r of rows) {
      const acc = by.get(r.companyCode) ?? { code: r.companyCode, name: r.companyName, current: 0 }
      acc.current += r.current
      by.set(r.companyCode, acc)
    }
    return [...by.values()].map((c) => ({
      ...c,
      current: round2(c.current),
      label: getDisplayName(c.code, c.name),
    }))
  }, [rows, getDisplayName])

  // 仅纳入正金额公司；负值公司记入脚注（与品类饼图口径一致）
  const pieData = useMemo(() => companies.filter((c) => c.current > 0), [companies])
  const negatives = useMemo(() => companies.filter((c) => c.current < 0), [companies])
  const sum = useMemo(() => pieData.reduce((s, c) => s + c.current, 0), [pieData])

  const option = useMemo<EChartsOption>(() => {
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
            </div>`
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
            name: c.label,
            value: c.current,
            itemStyle: { color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] },
          })),
        },
      ],
    }
  }, [pieData, sum])

  return (
    <Card className="animate-fade-in">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <PieChart className="h-4 w-4" />
          成员单体公司占比
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="skeleton h-[260px] w-full rounded-lg lg:h-[320px]" />
        ) : pieData.length === 0 ? (
          <EmptyHint
            icon={PieChart}
            title="暂无成员公司数据"
            hint="当前汇总主体/期间无正金额存货公司，请调整筛选条件"
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
              />
              {/* 环形中心总额（与图表 center 50%/50% 对齐，不拦截鼠标事件） */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xs text-muted-foreground">存货总额</span>
                <span className="font-num text-lg font-semibold">{formatMoneyWan(sum)}</span>
              </div>
            </div>
            {negatives.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                金额为负的公司未计入饼图：{negatives.map((c) => `${c.label}（${formatMoneyWan(c.current)}）`).join('、')}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
