import { useId } from 'react'
import { cn } from '@/lib/utils'

export interface TrendPoint {
  /** X 轴标签（如「1月」） */
  label: string
  /** 折线 1 数值 */
  v1: number
  /** 折线 2 数值 */
  v2: number
}

interface KeyMetricsTrendChartProps {
  data: TrendPoint[]
  /** Y 轴最大值（默认取数据 1.1 倍向上取整） */
  yMax?: number
  /** Y 轴刻度数（默认 5 段：1500/1200/900/600/300） */
  ticks?: number[]
  /** 折线 1 图例名 + 颜色（默认营业收入 / 主色） */
  legend1?: { name: string; color: string }
  /** 折线 2 图例名 + 颜色（默认毛利 / 橙 500） */
  legend2?: { name: string; color: string }
  className?: string
}

const VIEW_W = 280
const VIEW_H = 320
const PAD_LEFT = 30
const PAD_RIGHT = 0
const PAD_TOP = 40
const PAD_BOTTOM = 30
const PLOT_W = VIEW_W - PAD_LEFT - PAD_RIGHT
const PLOT_H = VIEW_H - PAD_TOP - PAD_BOTTOM

/**
 * 关键指标页月度趋势折线图：HTML .trend-svg 的 React 实现（纯 SVG，无 recharts 依赖）。
 * - 双线（营业收入 / 毛利）+ 折线 1 下方浅蓝渐变填充；
 * - 5 条横向网格虚线 + Y 轴 5 段刻度（300~1500 等差）+ X 轴偶数月份标签；
 * - 图例置顶：10px 圆角色块 + 名称。
 */
export function KeyMetricsTrendChart({
  data,
  yMax,
  ticks,
  legend1 = { name: '营业收入', color: 'hsl(var(--primary))' },
  legend2 = { name: '毛利', color: 'hsl(var(--orange-500))' },
  className,
}: KeyMetricsTrendChartProps) {
  const gradId = useId()
  const maxV = yMax ?? Math.max(...data.map((d) => d.v1), ...data.map((d) => d.v2)) * 1.1
  const tickValues = ticks ?? [1500, 1200, 900, 600, 300]
  const yToPx = (v: number) => PAD_TOP + PLOT_H * (1 - v / maxV)
  const xToPx = (i: number) => PAD_LEFT + (PLOT_W * i) / (data.length - 1)
  const line1Path = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xToPx(i)},${yToPx(d.v1)}`).join(' ')
  const line2Path = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${xToPx(i)},${yToPx(d.v2)}`).join(' ')
  const areaPath = `${line1Path} L${xToPx(data.length - 1)},${PAD_TOP + PLOT_H} L${xToPx(0)},${PAD_TOP + PLOT_H} Z`
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-[2px]"
            style={{ background: legend1.color }}
            aria-hidden
          />
          {legend1.name}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-[2px]"
            style={{ background: legend2.color }}
            aria-hidden
          />
          {legend2.name}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-[280px] w-full"
        aria-label="月度趋势"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.18" />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
          </linearGradient>
        </defs>
        <g className="text-[11px] text-muted-foreground">
          {tickValues.map((v, i) => {
            const y = PAD_TOP + (PLOT_H * i) / (tickValues.length - 1)
            return (
              <g key={v}>
                <line
                  x1={PAD_LEFT}
                  x2={VIEW_W}
                  y1={y}
                  y2={y}
                  stroke="hsl(var(--border))"
                  strokeWidth={1}
                  strokeDasharray="2 2"
                />
                <text x={2} y={y + 4} fill="hsl(var(--muted-foreground))">
                  {v}
                </text>
              </g>
            )
          })}
          {data.map((d, i) => {
            // 仅显示 1月/3月/5月/7月/9月/11月/12月 标签
            if (!(d.label === '1月' || d.label === '3月' || d.label === '5月' || d.label === '7月' || d.label === '9月' || d.label === '11月' || d.label === '12月')) return null
            return (
              <text
                key={`x-${i}`}
                x={xToPx(i)}
                y={VIEW_H - 10}
                fill="hsl(var(--muted-foreground))"
                textAnchor="middle"
              >
                {d.label}
              </text>
            )
          })}
        </g>
        <path d={areaPath} fill={`url(#${gradId})`} aria-hidden />
        <path d={line1Path} fill="none" stroke={legend1.color} strokeWidth={2} />
        <path d={line2Path} fill="none" stroke={legend2.color} strokeWidth={2} />
      </svg>
    </div>
  )
}
