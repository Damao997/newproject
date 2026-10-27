import type { ReactNode } from 'react'
import { Card } from './card'
import { cn } from '@/lib/utils'

/** 经营分析与管理页面共用的只读指标磁贴，不包含数据计算。
 * period 标注主金额所属期间（如「财年累计」），避免主数值与脚注期间混淆。 */
export function StatTile({ label, value, unit, foot, accent = '', valueClass, tone, period }: {
  label: string; value: ReactNode; unit?: string; foot?: ReactNode; accent?: string; valueClass?: string; tone?: 1 | 2 | 3 | 4; period?: string
}) {
  const metricTone = tone ?? (/success/.test(accent) ? 2 : /orange|warning|destructive/.test(accent) ? 3 : /blue|chart-5/.test(accent) ? 4 : 1)
  return <Card variant="metric" data-metric-tone={metricTone} className="stat-tile flex flex-col gap-2">
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      {period && <span data-metric-period className="rounded-full bg-muted px-1.5 py-0.5 text-caption font-normal text-muted-foreground">{period}</span>}
    </div>
    <div className={cn('font-num text-[28px] font-semibold leading-tight text-foreground', valueClass)}>
      {value}{unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
    </div>
    {foot && <div className="mt-auto pt-1 text-xs leading-relaxed text-muted-foreground">{foot}</div>}
  </Card>
}
