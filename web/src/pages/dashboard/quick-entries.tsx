import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface QuickEntry {
  to: string
  name: string
  desc: string
}

const PRIMARY: QuickEntry[] = [
  { to: '/indicators/operating', name: '经营指标', desc: '收入 / 毛利 / 利润' },
  { to: '/transactions/overview', name: '往来总览', desc: '应收 / 应付 / 账龄' },
  { to: '/data/import', name: '数据导入', desc: 'Excel 批量导入' },
  { to: '/reports', name: '汇总报告', desc: '报告中心' },
]

const SECONDARY: QuickEntry[] = [
  { to: '/tools/enterprise-lookup', name: '企业查询', desc: '工商 / 风险信息' },
  { to: '/reports/analyses', name: '单项分析', desc: 'AI 分析 / 润色' },
  { to: '/data/dimensions/operating', name: '科目管理', desc: '经营 / 静态科目' },
  { to: '/dashboard/analysis/category-budget', name: '品类预算达成', desc: '预算 vs 实际' },
]

/** 快捷入口网格（8 张 antd 风格 quick-card，纯文字无图标） */
export function QuickEntries() {
  return (
    <Card className="animate-fade-in border border-border shadow-sm">
      <CardHeader className="px-6 pb-3 pt-5">
        <CardTitle className="text-base font-semibold">快捷入口</CardTitle>
      </CardHeader>
      <CardContent className="px-6 pb-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {[...PRIMARY, ...SECONDARY].map((q) => (
            <Link
              key={q.to + q.name}
              to={q.to}
              className="group flex flex-col rounded-antd-md border border-orange-200 bg-orange-50/40 px-4 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-antd-1"
            >
              <div className="text-sm font-medium text-foreground">{q.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{q.desc}</div>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
