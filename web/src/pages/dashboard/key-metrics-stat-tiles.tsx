import { cn } from '@/lib/utils'

export type StatTileTone = 'orange' | 'green' | 'blue' | 'cyan' | 'violet' | 'gray'

export interface StatTileItem {
  /** 排名（仅 1/2/3 彩色，4+ 灰） */
  rank?: number
  /** 主标签 */
  label: string
  /** 右上角图标缩写（1~2 字） */
  iconText: string
  /** 主数值（不含单位） */
  value: number
  /** 单位（如「万」「%」「pp」） */
  unit: string
  /** 同比/变动（与 chipArrow/chipColor 联合渲染） */
  deltaPct: number
  /** 变动箭头（默认按 deltaPct 正负推断） */
  chipArrow?: '↑' | '↓' | '→'
  /** chip 语义：up=不利方向（红），down=有利方向（绿），flat=持平（灰） */
  chipColor: 'up' | 'down' | 'flat'
  /** 同比文案（与 chip 并列展示，缺省「同比」） */
  deltaSuffix?: string
  /** 12 月趋势 sparkline（0~1 浮点数组） */
  spark: number[]
  /** 主题色（默认根据 rank 推断） */
  tone?: StatTileTone
}

interface KeyMetricsStatTilesProps {
  items: StatTileItem[]
  className?: string
}

const TONE_PRE: Record<StatTileTone, string> = {
  orange: 'before:bg-orange-500',
  green: 'before:bg-success-500',
  blue: 'before:bg-chart-2',
  cyan: 'before:bg-info-500',
  violet: 'before:bg-chart-5',
  gray: 'before:bg-neutral-500',
}

const TONE_ICON: Record<StatTileTone, { bg: string; fg: string; spark: string }> = {
  orange: { bg: 'bg-orange-50', fg: 'text-orange-500', spark: 'bg-orange-200' },
  green: { bg: 'bg-success-50', fg: 'text-success-500', spark: 'bg-success-100' },
  blue: { bg: 'bg-blue-1', fg: 'text-blue-8', spark: 'bg-blue-2' },
  cyan: { bg: 'bg-info-50', fg: 'text-info-500', spark: 'bg-info-100' },
  violet: { bg: 'bg-accent', fg: 'text-chart-5', spark: 'bg-accent' },
  gray: { bg: 'bg-muted', fg: 'text-muted-foreground', spark: 'bg-muted' },
}

const RANK_BG: Record<1 | 2 | 3, string> = {
  1: 'bg-orange-500',
  2: 'bg-warning-500',
  3: 'bg-success-500',
}

const CHIP_CLS = {
  up: 'bg-destructive-50 text-destructive-500',
  down: 'bg-success-50 text-success-500',
  flat: 'bg-muted text-muted-foreground',
} as const

function formatValue(value: number): string {
  const isInt = Math.abs(value - Math.round(value)) < 0.05
  return isInt
    ? Math.round(value).toLocaleString('zh-CN')
    : value.toLocaleString('zh-CN', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
}

function deltaText(arrow: '↑' | '↓' | '→', delta: number, unit: string): string {
  if (arrow === '→') return `→ 0.0${unit === '%' ? '%' : unit === 'pp' ? ' pp' : '%'}`
  return `${arrow} ${Math.abs(delta).toFixed(1)}${unit === 'pp' ? ' pp' : '%'}`
}

/**
 * 关键指标页 5 列 KPI 磁贴行：HTML .antd-stat-tile 的 React 实现。
 * - 左侧 3px 色条 + 头部「排名徽章 + 标签」+ 右上角图标方块；
 * - 28px 等宽数字 + 单位；底部 chip + 同比文案 + 12 月趋势 sparkline；
 * - 首项 emphasis-warm-strong：橙 100→50 渐变背景 + 橙 300 描边；
 * - chip 颜色由调用方按业务语义指定（收入/毛利涨为绿 chip；应收涨为红 chip；预算完成率涨为绿 chip；持平为灰）。
 */
export function KeyMetricsStatTiles({ items, className }: KeyMetricsStatTilesProps) {
  return (
    <div className={cn('grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5', className)}>
      {items.map((it, i) => {
        const tone = it.tone ?? defaultTone(it.rank, i)
        const arrow = it.chipArrow ?? (Math.abs(it.deltaPct) < 0.05 ? '→' : it.deltaPct > 0 ? '↑' : '↓')
        const t = TONE_ICON[tone]
        const isLead = i === 0
        return (
          <div
            key={`${it.label}-${i}`}
            className={cn(
              'group relative flex flex-col gap-2 overflow-hidden rounded-lg border border-border bg-card p-4 transition-all',
              'before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:content-[""]',
              TONE_PRE[tone],
              'hover:shadow-antd-2',
              isLead && 'border-orange-300 bg-gradient-to-br from-orange-100 to-orange-50',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                {it.rank ? (
                  <span
                    className={cn(
                      'inline-flex h-[22px] w-[22px] items-center justify-center rounded-sm font-mono text-xs font-semibold text-white',
                      it.rank >= 1 && it.rank <= 3 ? RANK_BG[it.rank as 1 | 2 | 3] : 'bg-neutral-500',
                    )}
                  >
                    {it.rank}
                  </span>
                ) : null}
                {it.label}
              </span>
              <span
                className={cn(
                  'inline-flex h-7 w-7 items-center justify-center rounded-md text-sm font-semibold',
                  t.bg,
                  t.fg,
                )}
              >
                {it.iconText}
              </span>
            </div>
            <div className="font-mono text-2xl font-semibold leading-tight tabular-nums text-foreground">
              {formatValue(it.value)}
              <span className="ml-1 text-sm font-normal text-muted-foreground">{it.unit}</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  'inline-flex h-5 items-center rounded-sm px-1.5 font-mono text-xs tabular-nums',
                  CHIP_CLS[it.chipColor],
                )}
              >
                {deltaText(arrow, it.deltaPct, it.unit)}
              </span>
              <span className="text-xs text-muted-foreground">{it.deltaSuffix ?? '同比'}</span>
              <div className="ml-auto flex h-6 items-end gap-[2px]" aria-hidden>
                {it.spark.map((h, idx) => (
                  <span
                    key={idx}
                    className={cn('w-[3px] rounded-sm', t.spark)}
                    style={{ height: `${Math.max(8, Math.round(h * 100))}%` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function defaultTone(rank: number | undefined, idx: number): StatTileTone {
  if (rank === 1) return 'orange'
  if (rank === 2) return 'green'
  if (idx === 2) return 'blue'
  if (idx === 3) return 'cyan'
  if (idx === 4) return 'violet'
  return 'gray'
}
