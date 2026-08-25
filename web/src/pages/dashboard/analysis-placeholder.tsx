import { Card, CardContent } from '@/components/ui/card'
import { Inbox } from 'lucide-react'

interface AnalysisPlaceholderProps {
  /** 占位入口标题（如「壹品慧关键指标表」） */
  title: string
}

/**
 * 经营分析占位子页：入口已建、功能待实现。居中展示占位提示（与首页看板空态卡风格一致）。
 */
export function AnalysisPlaceholder({ title }: AnalysisPlaceholderProps) {
  return (
    <Card className="animate-fade-in border border-border shadow-sm">
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <Inbox className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">功能开发中，敬请期待</p>
      </CardContent>
    </Card>
  )
}
