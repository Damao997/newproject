import { cn } from '@/lib/utils'

/** 热力档位：0=无数据（空灰），1~5 由浅至深的橙色阶梯 */
export type HeatmapLevel = 0 | 1 | 2 | 3 | 4 | 5

export interface HeatmapCell {
  /** 0~5，与 HeatmapLevel 对应 */
  level: HeatmapLevel
  /** 鼠标悬浮提示，可选 */
  title?: string
}

export interface HeatmapProps {
  /** 二维数据：rows × cols */
  data: HeatmapCell[][]
  /** 每行首列的标签（行标题），与 data 同长度 */
  rowLabels: string[]
  /** 每列首行的标签（列标题），与 data[0] 同长度 */
  colLabels: string[]
  /** 自定义 grid 模板：默认 "32px repeat(cols, 1fr)"（行首列 32px 宽） */
  gridTemplateColumns?: string
  /** 单元之间距（px），默认 3 */
  gap?: number
  className?: string
}

/**
 * 热力网格：HTML antd-style-design 中 .antd-heatmap 的 React 实现。
 * 5 档强度（lv-1 浅橙 → lv-5 深橙），0=空（浅灰）。适用于 业务线 × 月份 强度矩阵。
 * 视觉：白底卡 + 浅边框，grid 布局，行/列首格放标签。
 */
export function Heatmap({
  data,
  rowLabels,
  colLabels,
  gridTemplateColumns,
  gap = 3,
  className,
}: HeatmapProps) {
  const cols = data[0]?.length ?? 0
  const template = gridTemplateColumns ?? `32px repeat(${cols}, 1fr)`

  return (
    <div
      className={cn('grid', className)}
      style={{ gridTemplateColumns: template, gap }}
    >
      <div />
      {colLabels.map((label) => (
        <div
          key={`col-${label}`}
          className="text-center text-[11px] text-muted-foreground"
        >
          {label}
        </div>
      ))}
      {data.map((row, ri) => (
        <HeatmapRow key={`row-${ri}`} row={row} label={rowLabels[ri] ?? ''} />
      ))}
    </div>
  )
}

function HeatmapRow({ row, label }: { row: HeatmapCell[]; label: string }) {
  return (
    <>
      <div className="self-center text-[11px] text-muted-foreground">{label}</div>
      {row.map((cell, ci) => (
        <div
          key={`c-${ci}`}
          className={cn('aspect-square rounded-[3px]', levelClass(cell.level))}
          title={cell.title}
        />
      ))}
    </>
  )
}

function levelClass(level: HeatmapLevel): string {
  switch (level) {
    case 0: return 'bg-muted'
    case 1: return 'bg-orange-100'
    case 2: return 'bg-orange-200'
    case 3: return 'bg-orange-300'
    case 4: return 'bg-orange-500'
    case 5: return 'bg-orange-700'
  }
}
