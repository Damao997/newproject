import { cn } from '@/lib/utils'

export interface RankBadgeProps {
  /** 排名（1/2/3 强制彩色，4+ 灰色） */
  rank: number
  className?: string
}

const RANK_BG: Record<1 | 2 | 3, string> = {
  1: 'bg-orange-500',
  2: 'bg-warning-500',
  3: 'bg-success-500',
}

/**
 * 排名徽标：HTML .antd-rank-badge 的 React 实现。
 * 1=橙 / 2=黄 / 3=绿 / 4+ = 灰；22×22 等宽数字 / mono 字体。
 */
export function RankBadge({ rank, className }: RankBadgeProps) {
  const tone = (rank >= 1 && rank <= 3 ? RANK_BG[rank as 1 | 2 | 3] : 'bg-neutral-500')
  return (
    <span
      className={cn(
        'inline-flex h-[22px] w-[22px] items-center justify-center rounded-antd-sm font-mono text-xs font-semibold tabular-nums text-white',
        tone,
        className,
      )}
    >
      {rank}
    </span>
  )
}
