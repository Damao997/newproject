import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { usePermission } from '@/hooks/usePermission'
import { Upload, FileText, TrendingUp, ArrowLeftRight } from 'lucide-react'

interface QuickAction {
  label: string
  to: string
  icon: React.ElementType
  iconBg: string
  iconColor: string
  /** 权限点（resource/action），缺省不校验 */
  permission?: { resource: string; action: string }
}

// 四个入口互不重复：导入数据 / 新建报告 / 财务指标 / 往来分析
const ACTIONS: QuickAction[] = [
  { label: '导入数据', to: '/data', icon: Upload, iconBg: 'bg-primary/10', iconColor: 'text-primary', permission: { resource: 'data:import', action: 'upload' } },
  { label: '新建报告', to: '/reports', icon: FileText, iconBg: 'bg-chart-3/10', iconColor: 'text-chart-3' },
  { label: '财务指标', to: '/indicators', icon: TrendingUp, iconBg: 'bg-chart-2/10', iconColor: 'text-chart-2' },
  { label: '往来分析', to: '/transactions', icon: ArrowLeftRight, iconBg: 'bg-chart-5/10', iconColor: 'text-chart-5' },
]

/** 快捷入口卡：常用功能直达按钮 */
export function QuickActions() {
  const { can } = usePermission()
  const navigate = useNavigate()
  const actions = ACTIONS.filter((a) => !a.permission || can(a.permission.resource, a.permission.action))

  return (
    <Card className="animate-fade-in border border-border shadow-sm" style={{ animationDelay: '360ms' }}>
      <CardHeader className="px-6 pb-3 pt-5">
        <CardTitle className="text-lg font-semibold">快捷入口</CardTitle>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {actions.map(({ label, to, icon: Icon, iconBg, iconColor }) => (
            <button
              key={label}
              type="button"
              className="group flex h-24 flex-col items-center justify-center gap-3 rounded-xl border border-border bg-card transition-all duration-150 hover:border-primary/50 hover:bg-accent/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.97]"
              onClick={() => navigate(to)}
            >
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${iconBg}`}>
                <Icon className={`h-5 w-5 ${iconColor}`} />
              </div>
              <span className="text-sm font-medium">{label}</span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
