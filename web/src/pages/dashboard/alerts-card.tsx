import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { TriangleAlert } from 'lucide-react'
import { useDashboardAlerts } from '@/hooks/api-queries'
import { cn } from '@/lib/utils'

const SEVERITY_STYLES: Record<string, string> = {
  error: 'text-destructive',
  warning: 'text-warning-strong',
  info: 'text-info-strong',
}

/**
 * 首页预警卡（US-13）：未确认预警列表（超预算/回款逾期/库存积压等，severity 标红分级）。
 * 数据来自 GET /dashboard/alerts（scope 过滤），点击卡片跳转对应分析页由快捷入口承担，
 * 此卡聚焦「有哪些预警 + 严重程度」。
 */
export function AlertsCard() {
  const { data, isLoading, isError, refetch } = useDashboardAlerts()
  const alerts = data ?? []

  return (
    <Card className="animate-fade-in rounded-card">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base">预警提醒</CardTitle>
        {alerts.length > 0 && (
          <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
            {alerts.length} 条未确认
          </span>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : isError ? (
          <div className="flex h-24 flex-col items-center justify-center gap-1">
            <p className="text-sm text-destructive">预警数据加载失败</p>
            <button className="text-xs text-muted-foreground underline" onClick={() => void refetch()}>重试</button>
          </div>
        ) : alerts.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            当前无未确认预警。
          </div>
        ) : (
          <ul className="space-y-2">
            {alerts.slice(0, 8).map((a) => (
              <li key={a.id} className="flex items-start gap-2 rounded-md border border-border/60 px-3 py-2">
                <TriangleAlert className={cn('mt-0.5 h-4 w-4 shrink-0', SEVERITY_STYLES[a.severity] ?? 'text-muted-foreground')} />
                <div className="min-w-0">
                  <p className={cn('truncate text-sm font-medium', SEVERITY_STYLES[a.severity] ?? '')}>{a.title}</p>
                  {a.message && <p className="truncate text-xs text-muted-foreground">{a.message}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
