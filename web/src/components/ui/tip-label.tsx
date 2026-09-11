import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface TipLabelProps {
  /** 表头/标签文本（可含 cn 样式类） */
  label: ReactNode
  /** 悬停提示文案（通俗口径解释） */
  tip: string
}

/** 带悬停解释的表头标签：虚线分隔线提示可悬停，用于专业指标（预算完成率/同比增长等）的通俗口径说明 */
export function TipLabel({ label, tip }: TipLabelProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help border-b border-dotted border-muted-foreground/50">{label}</span>
      </TooltipTrigger>
      <TooltipContent side="top">{tip}</TooltipContent>
    </Tooltip>
  )
}
