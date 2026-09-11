import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { EChartsOption } from 'echarts'
import ReactECharts, { echarts } from '@/components/charts/echarts-core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowRight } from 'lucide-react'
import { useInventoryOverview } from '@/hooks/api-queries'
import { formatMoneyWan } from '@/lib/utils'
import { CHART_FONT, getChartInk, getChartSeries, labelSpan, numSpan, titleSpan, tooltipShell } from '@/lib/chart-theme'
import { useThemeStore } from '@/stores/themeStore'

interface InventoryPieCardProps {
  /** 选定期（跟随看板当前期间） */
  period?: string
  /** 主体编码（跟随看板顶部筛选）：单体=自身，汇总主体由后端展开为成员合并口径 */
  companyCode?: string
}

/**
 * 存货品类分析卡：数据与库存管理页同源（/inventory/overview，fact_static），
 * 主体口径跟随看板顶部筛选（无独立筛选器）；期间跟随看板当前期间；
 * 点击扇区跳转库存管理页查看明细。数据经后端 scope 过滤。
 */
export function InventoryPieCard({ period, companyCode }: InventoryPieCardProps) {
  const navigate = useNavigate()
  // 分类色板跟随当前侧边栏风格：按序轮转，首位为风格主色；主页面恒白，图表框架色恒定
  const sidebarStyle = useThemeStore((s) => s.sidebarStyle)
  /** 深链库存页：携带当前主体与期间，库存页挂载时写入 store 后清理 URL；来源标记供库存页显示「返回首页」 */
  const gotoInventory = () => {
    const params = new URLSearchParams()
    if (companyCode) params.set('companies', companyCode)
    if (period) params.set('period', period)
    const qs = params.toString()
    sessionStorage.setItem('dashboard.fromDashboard', '1')
    navigate(qs ? `/inventory?${qs}` : '/inventory')
  }
  const companyCodes = companyCode ? [companyCode] : undefined
  const { data, isLoading } = useInventoryOverview({ period, companyCodes })
  const categories = useMemo(() => data?.categories ?? [], [data])

  // 仅纳入正金额品类；负值品类记入脚注提示（与库存页口径一致）
  const pieData = useMemo(() => categories.filter((c) => c.current > 0), [categories])
  const negatives = useMemo(() => categories.filter((c) => c.current < 0), [categories])

  const option = useMemo<EChartsOption>(() => {
    const ink = getChartInk()
    const seriesColors = getChartSeries(sidebarStyle)
    const sum = pieData.reduce((s, c) => s + c.current, 0)
    return {
      animation: false,
      textStyle: {
        fontFamily: CHART_FONT,
      },
      tooltip: {
        trigger: 'item',
        ...tooltipShell(ink),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        formatter: (params: any) => {
          const pct = sum > 0 ? ((params.value / sum) * 100).toFixed(1) : '0.0'
          return titleSpan(params.name, ink)
            + `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px">
              ${labelSpan('金额', ink)}
              ${numSpan(formatMoneyWan(params.value))}
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:16px">
              ${labelSpan('占比', ink)}
              ${numSpan(`${pct}%`)}
            </div>
            <div style="margin-top:6px;color:${ink.axis};font-size:11px">点击查看库存明细</div>`
        },
      },
      series: [
        {
          type: 'pie',
          radius: ['42%', '70%'],
          center: ['50%', '50%'],
          itemStyle: { borderColor: ink.surface, borderWidth: 2, borderRadius: 4 },
          label: {
            fontSize: 11,
            color: ink.sub,
            formatter: (p: { name: string; percent?: number }) => `${p.name} ${p.percent?.toFixed(1) ?? 0}%`,
          },
          labelLine: { length: 10, length2: 8, lineStyle: { color: ink.grid } },
          data: pieData.map((c, i) => ({
            name: c.name,
            value: c.current,
            itemStyle: { color: seriesColors[i % seriesColors.length] },
          })),
        },
      ],
    }
  }, [pieData, sidebarStyle])

  return (
    <Card className="animate-fade-in border border-border" style={{ animationDelay: '240ms' }}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 px-6 pb-3 pt-5">
        <div>
          <CardTitle className="text-lg font-semibold">
            存货品类分析
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {period ? `期间 ${period} · ` : ''}单位：万元 · 金额：品类本期金额占比（万元）
          </p>
        </div>
        <Button variant="ghost" size="sm" className="gap-1 text-primary" onClick={gotoInventory}>
          查看库存明细
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        {isLoading ? (
          <div className="skeleton h-[260px] w-full rounded-lg lg:h-[320px]" />
        ) : !period ? (
          <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground lg:h-[320px]">
            正在加载期间数据...
          </div>
        ) : pieData.length === 0 ? (
          <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground lg:h-[320px]">
            当前期间暂无存货数据
          </div>
        ) : (
          <>
            <div className="h-[260px] w-full lg:h-[320px]">
              <ReactECharts
                echarts={echarts}
                option={option}
                notMerge
                style={{ height: '100%', width: '100%' }}
                opts={{ renderer: 'svg' }}
                onEvents={{ click: gotoInventory }}
              />
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
