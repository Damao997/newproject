import type { ReactNode } from 'react'
import { Card } from './card'
import { cn } from '@/lib/utils'

/** 经营分析与管理页面共用的只读指标磁贴，不包含数据计算。 */
export function StatTile({ label, value, unit, foot, accent = '', valueClass, tone }: {
  label: string; value: ReactNode; unit?: string; foot?: ReactNode; accent?: string; valueClass?: string; tone?: 1 | 2 | 3 | 4
}) {
  const metricTone = tone ?? (/success/.test(accent) ? 2 : /orange|warning|destructive/.test(accent) ? 3 : /blue|chart-5/.test(accent) ? 4 : 1)
  return <Card variant="metric" data-metric-tone={metricTone} className="stat-tile flex flex-col gap-2">
    <span className="text-sm font-medium text-muted-foreground">{label}</span>
    <div className={cn('font-num text-[28px] font-semibold leading-tight text-foreground', valueClass)}>
      {value}{unit && <span className="ml-1 text-sm font-normal text-muted-foreground">{unit}</span>}
    </div>
    {foot && <div className="mt-auto pt-1 text-xs leading-relaxed text-muted-foreground">{foot}</div>}
  </Card>
}
