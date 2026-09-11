import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface FormulaTextProps {
  /** 完整公式文本（已中文化） */
  text: string
  /** 触发器额外类名（通常传 max-w-[...] 控制截断宽度） */
  className?: string
}

/**
 * 超长公式文本截断展示：溢出时显示省略号，悬停弹出完整内容 Tooltip。
 * 未溢出（无截断）时不弹提示，避免干扰；依赖 App 全局 TooltipProvider。
 */
export function FormulaText({ text, className }: FormulaTextProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)

  // 仅在文本实际溢出（被截断）时允许打开 Tooltip
  const handleOpenChange = (next: boolean) => {
    if (next && ref.current && ref.current.scrollWidth <= ref.current.clientWidth) return
    setOpen(next)
  }

  return (
    <Tooltip open={open} onOpenChange={handleOpenChange}>
      <TooltipTrigger asChild>
        <span ref={ref} className={cn('block truncate font-mono', className)}>{text}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[480px] break-all font-mono text-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}
