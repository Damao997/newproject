import { useMemo } from 'react'
import { DistributionBar } from './distribution-bar'
import { getChartSeries } from '@/lib/chart-theme'
import { useThemeStore } from '@/stores/themeStore'
import { cn } from '@/lib/utils'

export interface MiniBarChartItem {
  /** 分类名称 */
  label: string
  /** 数值 */
  value: number
  /** 可选的右侧提示（如占比） */
  hint?: string
}

interface MiniBarChartProps {
  data: MiniBarChartItem[]
  /** 最大值，缺省取数据最大值 */
  max?: number
  /** 数值格式化 */
  valueFormatter?: (value: number) => string
  /** 条形颜色数组，循环着色（默认四色活泼体系） */
  barColors?: string[]
  className?: string
}

/** 轻量排名图复用全站横条，格式化和身份配色沿用调用方。 */
export function MiniBarChart({ data, max, valueFormatter, barColors, className }: MiniBarChartProps) {
  const sidebarStyle = useThemeStore((s) => s.printing ? 'light' : s.sidebarStyle)
  const defaultBarColors = useMemo(() => getChartSeries(sidebarStyle).slice(0, 4), [sidebarStyle])
  const colors = barColors?.length ? barColors : defaultBarColors
  const maxValue = max ?? Math.max(...data.map((d) => d.value), 1)
  return <div className={cn('distribution-list', className)}>
    {data.map((item, i) => <DistributionBar key={item.label} variant="ranking"
      label={item.label} value={valueFormatter ? valueFormatter(item.value) : item.value}
      meta={item.hint} width={maxValue > 0 ? item.value / maxValue * 100 : 0}
      color={colors[i % colors.length]} />)}
  </div>
}
