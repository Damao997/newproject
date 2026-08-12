import { useEffect, useMemo, useState } from 'react'
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

/**
 * 轻量水平条形图（纯 CSS，零图表库依赖）。
 *
 * 借鉴 demo-3 的性能优先理念：不引入 ECharts 等重型库，
 * 仅用 CSS 宽度过渡实现流畅的条形增长动画（挂载后从 0 增长到目标值）。
 * 适合分类少、只需展示相对占比的轻量场景。
 */

export function MiniBarChart({ data, max, valueFormatter, barColors, className }: MiniBarChartProps) {
  const theme = useThemeStore((s) => s.theme)
  // 默认四色活泼体系：首位跟随当前品牌主题主色
  const defaultBarColors = useMemo(() => getChartSeries(theme).slice(0, 4), [theme])
  const colors = barColors ?? defaultBarColors
  const [ready, setReady] = useState(false)
  const maxValue = max ?? Math.max(...data.map((d) => d.value), 1)

  // 挂载后下一帧触发宽度过渡，形成从 0 增长的动画
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <div className={cn('space-y-5', className)}>
      {data.map((item, i) => {
        const pct = Math.min((item.value / maxValue) * 100, 100)
        const barColor = colors[i % colors.length]
        return (
          <div key={item.label} className="group">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground transition-colors group-hover:text-primary">
                {item.label}
              </span>
              <div className="flex items-center gap-3">
                {item.hint && <span className="text-xs text-muted-foreground">{item.hint}</span>}
                <span className="font-num text-sm font-semibold text-foreground">
                  {valueFormatter ? valueFormatter(item.value) : item.value}
                </span>
              </div>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="chart-bar h-full rounded-full"
                style={{ width: ready ? `${pct}%` : '0%', backgroundColor: barColor }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
