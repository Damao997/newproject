import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react'
import type { DashboardAlert } from '@/types'

/** 预警提醒卡：未确认预警列表，空态给出正向提示 */
export function AlertsCard({ alerts }: { alerts: DashboardAlert[] }) {
  return (
    <Card className="animate-fade-in border border-border bg-white shadow-sm transition-shadow duration-200 hover:shadow-md" style={{ animationDelay: '280ms' }}>
      <CardHeader className="px-6 pb-3 pt-5">
        <CardTitle className="flex items-center gap-2 text-lg font-semibold">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
          </div>
          预警提醒
        </CardTitle>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-500/60" />
            <p className="text-sm text-muted-foreground">暂无未确认预警，各项指标运行正常</p>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert, i) => (
              <div
                key={alert.id}
                className={`animate-fade-in rounded-xl border p-4 ${
                  alert.severity === 'error'
                    ? 'border-red-200 border-l-[3px] border-l-red-500 bg-red-50'
                    : 'border-amber-200 border-l-[3px] border-l-amber-500 bg-amber-50'
                }`}
                style={{ animationDelay: `${320 + i * 80}ms` }}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3">
                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      alert.severity === 'error' ? 'bg-red-100' : 'bg-amber-100'
                    }`}>
                      <AlertTriangle
                        className={`h-4 w-4 ${
                          alert.severity === 'error' ? 'text-red-500' : 'text-amber-600'
                        }`}
                      />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">{alert.title}</h4>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {alert.message}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`ml-2 inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      alert.severity === 'error'
                        ? 'bg-red-100 text-red-500'
                        : 'bg-amber-100 text-amber-600'
                    }`}
                  >
                    {alert.severity === 'error' ? '严重' : '警告'}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {new Date(alert.createdAt).toLocaleString('zh-CN')}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
