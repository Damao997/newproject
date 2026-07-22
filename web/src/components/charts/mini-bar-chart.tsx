import { useEffect, useState } from 'react'
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
  className?: string
}

/**
 * 轻量水平条形图（纯 CSS，零图表库依赖）。
 *
 * 借鉴 demo-3 的性能优先理念：不引入 ECharts 等重型库，
 * 仅用 CSS 宽度过渡实现流畅的条形增长动画（挂载后从 0 增长到目标值）。
 * 适合分类少、只需展示相对占比的轻量场景。
 */
export function MiniBarChart({ data, max, valueFormatter, className }: MiniBarChartProps) {
  const [ready, setReady] = useState(false)
  const maxValue = max ?? Math.max(...data.map((d) => d.value), 1)

  // 挂载后下一帧触发宽度过渡，形成从 0 增长的动画
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true))
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <div className={cn('space-y-5', className)}>
      {data.map((item) => {
        const pct = Math.min((item.value / maxValue) * 100, 100)
        return (
          <div key={item.label} className="group">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-foreground transition-colors group-hover:text-primary">
                {item.label}
              </span>
              <div className="flex items-center gap-3">
                {item.hint && <span className="text-xs text-muted-foreground">{item.hint}</span>}
                <span className="font-mono text-sm font-semibold text-foreground">
                  {valueFormatter ? valueFormatter(item.value) : item.value}
                </span>
              </div>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="chart-bar h-full rounded-full bg-gradient-to-r from-primary/80 to-primary"
                style={{ width: ready ? `${pct}%` : '0%' }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
