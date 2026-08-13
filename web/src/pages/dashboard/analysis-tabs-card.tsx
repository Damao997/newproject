import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { TrendSection } from './trend-section'
import { ProductBudgetCard } from './product-budget-card'
import { SubjectBudgetCard } from './subject-budget-card'
import { ExpenseAnalysisCard } from './expense-analysis-card'
import type { TrendData } from '@/types'
import type { TrendMetric, TrendMode } from '@/components/charts/trend-metrics'

/** 综合分析卡标签：趋势分析 / 品类预算达成 / 公司预算达成 / 运营费用 */
export type AnalysisTab = 'trend' | 'product' | 'subject' | 'expense'

interface AnalysisTabsCardProps {
  /** 选定期（跟随看板当前期间） */
  period?: string
  /** 主体口径（跟随看板顶部筛选，单体/汇总主体编码） */
  companyCode?: string
  /** 当前主体显示名（标题下说明口径） */
  subjectName?: string
  /** 趋势数据（来自父级 overview 接口） */
  trendData: TrendData[]
  trendMetric: TrendMetric
  onTrendMetricChange: (m: TrendMetric) => void
  /** 趋势图金额口径：month=本月合计/月度预算，ytd=累计实际/年度预算 */
  trendMode: TrendMode
  onTrendModeChange: (m: TrendMode) => void
  /** 财年标签（如 FY2026），用于趋势页说明 X 轴范围 */
  fiscalYearLabel?: string | null
  /** 当前激活标签（父级持久化，模式同 trendMetric） */
  tab: AnalysisTab
  onTabChange: (t: AnalysisTab) => void
}

/** 线条式标签：选中态主色文字 + 底部主色短横线指示器，未选中 muted 弱化；分割线由 line 变体 TabsList 的 border-b 承担（w-full 贯穿卡片内容区） */
const TABS: { value: AnalysisTab; label: string }[] = [
  { value: 'trend', label: '趋势分析' },
  { value: 'product', label: '品类预算达成' },
  { value: 'subject', label: '公司预算达成' },
  { value: 'expense', label: '运营费用' },
]

/**
 * 综合分析：趋势分析 / 品类预算达成 / 公司预算达成 / 运营费用四个分析视图的 TAB 复合卡。
 * 线条式标签栏位于卡片内容区左上方，与图表/表格紧密贴合；四个内容组件各自保留数据请求与交互
 * （Radix TabsContent 默认非激活不挂载，切换时才触发加载，React Query 缓存保证回切秒开）。
 * 主体/期间口径跟随看板顶部筛选。
 */
export function AnalysisTabsCard({
  period,
  companyCode,
  subjectName,
  trendData,
  trendMetric,
  onTrendMetricChange,
  trendMode,
  onTrendModeChange,
  fiscalYearLabel,
  tab,
  onTabChange,
}: AnalysisTabsCardProps) {
  return (
    <Card className="animate-fade-in" style={{ animationDelay: '120ms' }}>
      <Tabs value={tab} onValueChange={(v) => onTabChange(v as AnalysisTab)}>
        <CardContent className="px-6 py-6">
          <TabsList variant="line" className="mb-4 justify-start">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="trend">
            <TrendSection
              data={trendData}
              metric={trendMetric}
              onMetricChange={onTrendMetricChange}
              mode={trendMode}
              onModeChange={onTrendModeChange}
              fiscalYearLabel={fiscalYearLabel}
              subjectName={subjectName}
            />
          </TabsContent>
          <TabsContent value="product">
            <ProductBudgetCard period={period} companyCode={companyCode} subjectName={subjectName} />
          </TabsContent>
          <TabsContent value="subject">
            <SubjectBudgetCard period={period} companyCode={companyCode} subjectName={subjectName} />
          </TabsContent>
          <TabsContent value="expense">
            <ExpenseAnalysisCard period={period} companyCode={companyCode} subjectName={subjectName} />
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  )
}
