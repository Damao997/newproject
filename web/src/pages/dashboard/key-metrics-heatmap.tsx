import { cn } from '@/lib/utils'

export type HeatmapLevel = 0 | 1 | 2 | 3 | 4 | 5

export interface HeatmapRow {
  /** 行标签（如「营业收入」「毛利率」「净利率」） */
  label: string
  /** 12 列单元格（与 colLabels 同长度） */
  cells: HeatmapCell[]
}

export interface HeatmapCell {
  /** 0~5，与 HeatmapLevel 对应（0=空/无数据） */
  level: HeatmapLevel
  /** 鼠标悬浮提示文本（如「1月 980万」） */
  tip?: string
}

interface KeyMetricsHeatmapProps {
  rows: HeatmapRow[]
  /** 12 列首行标签（1月~12月） */
  colLabels: string[]
  className?: string
}

const LEVEL_BG: Record<HeatmapLevel, string> = {
  0: 'bg-muted',
  1: 'bg-orange-100',
  2: 'bg-orange-200',
  3: 'bg-orange-300',
  4: 'bg-orange-500',
  5: 'bg-orange-700',
}

/**
 * 关键指标页 5×12 热力图：HTML .heatmap-card / .heatmap-row 的 React 实现。
 * - 行标签在每行首格（56px 宽，灰字右对齐），12 列 1fr 单元格 + 3px gap；
 * - 单元格悬浮 tooltip（.heatmap-cell .tip），底部色阶图例（5 级 + 低/高文字）；
 * - 配色：HTML lv-1~lv-5 = 橙 #fff7e6 → #d46b08，对应 Tailwind orange-100/200/300/500/700。
 */
export function KeyMetricsHeatmap({ rows, colLabels, className }: KeyMetricsHeatmapProps) {
  return (
    <div className={className}>
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => (
          <div
            key={r.label}
            className="grid items-center gap-2.5"
            style={{ gridTemplateColumns: '56px 1fr 56px' }}
          >
            <div className="text-right text-xs text-muted-foreground">{r.label}</div>
            <div className="grid grid-cols-12 gap-[3px]">
              {r.cells.map((c, ci) => (
                <div
                  key={ci}
                  className={cn(
                    'group/heat relative aspect-square rounded-[3px]',
                    LEVEL_BG[c.level],
                  )}
                  title={c.tip}
                >
                  {c.tip ? (
                    <span className="pointer-events-none absolute bottom-[calc(100%+4px)] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-sm bg-ink-10 px-1.5 py-0.5 text-[11px] text-white opacity-0 shadow transition-opacity group-hover/heat:opacity-100">
                      {c.tip}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
            <div />
          </div>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-12 pl-[66px] text-[11px] text-muted-foreground">
        {colLabels.map((c) => (
          <div key={c} className="text-center">
            {c}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-1.5 pl-[66px] text-[11px] text-muted-foreground">
        <span>低</span>
        {([1, 2, 3, 4, 5] as HeatmapLevel[]).map((lv) => (
          <span
            key={lv}
            className={cn('inline-block h-3 w-3 rounded-[2px]', LEVEL_BG[lv])}
            aria-hidden
          />
        ))}
        <span>高</span>
      </div>
    </div>
  )
}
