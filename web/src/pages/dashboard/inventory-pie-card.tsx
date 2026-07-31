import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { EChartsOption } from 'echarts'
import ReactECharts, { echarts } from '@/components/charts/echarts-core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useCompanies, useInventoryOverview } from '@/hooks/api-queries'
import { formatMoneyWan } from '@/lib/utils'
import { CATEGORY_COLORS } from '@/lib/chart-colors'
import { PieChart } from 'lucide-react'

/**
 * 存货占比环形图卡：数据与库存管理页同源（/inventory/overview，fact_static），
 * 卡内独立主体筛选（全部/单体公司），期间跟随看板当前期间；
 * 点击扇区跳转库存管理页查看明细。数据经后端 scope 过滤。
 */
export function InventoryPieCard({ period }: { period?: string }) {
  const [companyFilter, setCompanyFilter] = useState('all')
  const navigate = useNavigate()
  const { data: companies } = useCompanies()
  const singles = useMemo(() => (companies ?? []).filter((c) => c.type === 'entity'), [companies])
  const companyCodes = companyFilter === 'all' ? undefined : [companyFilter]
  const { data, isLoading } = useInventoryOverview({ period, companyCodes })
  const categories = useMemo(() => data?.categories ?? [], [data])

  // 仅纳入正金额品类；负值品类记入脚注提示（与库存页口径一致）
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
            </div>
            <div style="margin-top:6px;color:#94A3B8;font-size:11px">点击查看库存明细</div>`
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
    <Card className="animate-fade-in border border-border bg-white shadow-sm transition-shadow duration-200 hover:shadow-md" style={{ animationDelay: '240ms' }}>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 px-6 pb-3 pt-5">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg font-semibold">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50">
              <PieChart className="h-4 w-4 text-emerald-600" />
            </div>
            存货品类占比
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {period ? `期间 ${period} · ` : ''}品类本期金额占比（万元），与库存管理同源
          </p>
        </div>
        <Select value={companyFilter} onValueChange={setCompanyFilter}>
          <SelectTrigger className="h-8 w-[160px] text-xs">
            <SelectValue placeholder="全部公司" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部公司</SelectItem>
            {singles.map((c) => (
              <SelectItem key={c.code} value={c.code}>{c.shortName ?? c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        {isLoading ? (
          <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">加载中...</div>
        ) : pieData.length === 0 ? (
          <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground">
            当前期间暂无存货数据
          </div>
        ) : (
          <>
            <ReactECharts
              echarts={echarts}
              option={option}
              notMerge
              style={{ height: 320, width: '100%' }}
              opts={{ renderer: 'svg' }}
              onEvents={{ click: () => navigate('/inventory') }}
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
