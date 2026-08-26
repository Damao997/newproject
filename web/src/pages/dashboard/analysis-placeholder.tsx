import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Link } from 'react-router-dom'
import { ArrowRight, Inbox } from 'lucide-react'

interface AnalysisPlaceholderProps {
  /** 占位入口标题（如「壹品慧关键指标表」） */
  title: string
  /** 补充说明（功能规划状态 / 需求反馈渠道）；缺省时展示通用文案 */
  note?: string
  /** 跳转动作按钮标签（如「前往往来账龄分析」） */
  actionLabel?: string
  /** 跳转目标（react-router 内部路径） */
  actionHref?: string
}

/**
 * 经营分析占位子页：入口已建、功能待实现。
 * 支持跳转通道（数据已落地的关联页面）与规划说明，避免死胡同。
 */
export function AnalysisPlaceholder({ title, note, actionLabel, actionHref }: AnalysisPlaceholderProps) {
  return (
    <Card className="animate-fade-in border border-border shadow-sm">
      <CardContent className="px-6 py-0">
        <EmptyState
          icon={Inbox}
          title={title}
          description={note ?? '功能开发中，敬请期待'}
          action={actionLabel && actionHref ? (
            <Button asChild variant="outline" size="sm">
              <Link to={actionHref}>
                {actionLabel}
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : undefined}
        />
      </CardContent>
    </Card>
  )
}
