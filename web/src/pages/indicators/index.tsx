import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PageContainer } from '@/components/layout/page-container'
import { MetricTree } from '@/components/subject-tree/metric-tree'
import { AnalysisDrawer, type AnalysisTarget } from '@/components/indicators/analysis-drawer'
import { usePermission } from '@/hooks/usePermission'
import { useCompanies, useOperatingIndicators, useStaticIndicators, type OperatingRow, type StaticRow } from '@/hooks/api-queries'
import { exportToExcel } from '@/lib/export'
import { cn } from '@/lib/utils'
import type { MetricValue } from '@/lib/metric-values'
import { Download, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import type { SubjectNode } from '@/types'

const periods = ['2025-06', '2025-05', '2025-04', '2025-03', '2025-02', '2025-01']

/** 收集含子节点的科目编码（用于全部展开） */
function collectExpandableCodes(nodes: SubjectNode[]): string[] {
  const codes: string[] = []
  for (const node of nodes) {
    if (node.children.length > 0) {
      codes.push(node.code)
      codes.push(...collectExpandableCodes(node.children))
    }
  }
  return codes
}

type Row = OperatingRow | StaticRow

/** 将后端嵌套行转为 MetricTree 需要的结构树 + 数值 Map */
function adapt(items: Row[], isOperating: boolean): { nodes: SubjectNode[]; map: Map<string, MetricValue> } {
  const map = new Map<string, MetricValue>()
  const walk = (rows: Row[]): SubjectNode[] =>
    rows.map((r) => {
      if (isOperating) {
        const o = r as OperatingRow
        map.set(o.code, { budget: o.budget, actual: o.actual, samePeriod: o.samePeriod, ytd: o.ytd, samePeriodYtd: o.samePeriodYtd })
      } else {
        const s = r as StaticRow
        // 静态科目映射到统一 MetricValue：本期→actual、同期→samePeriod、年初→ytd、上年年初→samePeriodYtd
        map.set(s.code, { budget: s.yearStart, actual: s.current, samePeriod: s.samePeriod, ytd: s.yearStart, samePeriodYtd: s.lastYearStart })
      }
      return {
        code: r.code, name: r.name, level: r.level, category: r.category,
        dataType: r.dataType as SubjectNode['dataType'],
        children: r.children ? walk(r.children as Row[]) : [],
      }
    })
  return { nodes: walk(items), map }
}

/** 前序展开为 {row, depth} 供导出 */
function flattenForExport(rows: Row[], depth = 0): { row: Row; depth: number }[] {
  const out: { row: Row; depth: number }[] = []
  for (const r of rows) {
    out.push({ row: r, depth })
    if (r.children && r.children.length > 0) out.push(...flattenForExport(r.children as Row[], depth + 1))
  }
  return out
}

export default function IndicatorsPage() {
  const { can } = usePermission()
  const [activeTab, setActiveTab] = useState<'operating' | 'static'>('operating')
  const [dimFilter, setDimFilter] = useState('all')
  const [periodFilter, setPeriodFilter] = useState('2025-06')
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(new Set())
  const [analysisTarget, setAnalysisTarget] = useState<AnalysisTarget | null>(null)

  const isOperating = activeTab === 'operating'

  // 主体维度：company:CODE → 精确公司；all/summary/bu → 不传（后端按 scope 汇总，summary/BU 展开为后续项）
  const companyCode = dimFilter.startsWith('company:') ? dimFilter.slice('company:'.length) : undefined
  const period = periodFilter === 'all' ? undefined : periodFilter

  const { data: companies } = useCompanies()
  const operatingQuery = useOperatingIndicators({ companyCode, period })
  const staticQuery = useStaticIndicators({ companyCode })

  const entityCompanies = useMemo(() => (companies ?? []).filter((c) => c.type === 'entity'), [companies])
  const summaryEntities = useMemo(() => (companies ?? []).filter((c) => c.type === 'summary'), [companies])
  const businessUnits = useMemo(
    () => Array.from(new Set(entityCompanies.map((c) => c.businessUnit).filter((bu): bu is string => !!bu))),
    [entityCompanies],
  )

  const activeItems = (isOperating ? operatingQuery.data?.items : staticQuery.data?.items) ?? []
  const isLoading = isOperating ? operatingQuery.isLoading : staticQuery.isLoading
  // isFetching：筛选刷新中（已保留旧数据），用于轻量视觉反馈而非整块替换
  const isFetching = isOperating ? operatingQuery.isFetching : staticQuery.isFetching

  const { nodes: activeTree, map: activeValueMap } = useMemo(
    () => adapt(activeItems as Row[], isOperating),
    [activeItems, isOperating],
  )
  const activeExpandable = useMemo(() => collectExpandableCodes(activeTree), [activeTree])

  // 数据到达后默认展开 level0 根节点
  useEffect(() => {
    const roots = activeTree.map((n) => n.code)
    if (roots.length > 0) {
      setExpandedCodes((prev) => {
        const next = new Set(prev)
        roots.forEach((c) => next.add(c))
        return next
      })
    }
  }, [activeTree])

  const handleToggle = (code: string) => {
    setExpandedCodes((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const expandActive = () => setExpandedCodes((prev) => new Set([...prev, ...activeExpandable]))
  const collapseActive = () =>
    setExpandedCodes((prev) => {
      const next = new Set(prev)
      for (const code of activeExpandable) next.delete(code)
      return next
    })

  /** 打开单项分析抽屉：需先选中单一公司主体 */
  const handleAnalyze = (node: SubjectNode) => {
    if (!companyCode) {
      window.alert('请先在「主体维度」中选择单一公司，再对该公司的科目撰写单项分析。')
      return
    }
    const companyName = entityCompanies.find((c) => c.code === companyCode)?.name ?? companyCode
    const effectivePeriod = period ?? '2025-06'
    setAnalysisTarget({
      companyCode,
      companyName,
      subjectCode: node.code,
      subjectName: node.name,
      subjectType: activeTab,
      fiscalYear: effectivePeriod.slice(0, 4),
      period: effectivePeriod,
      metric: activeValueMap.get(node.code),
    })
  }

  const handleExport = async () => {
    const pct = (v: number) => `${v.toFixed(1)}%`
    const flat = flattenForExport(activeItems as Row[])
    if (isOperating) {
      const rows = flat.map(({ row, depth }) => {
        const o = row as OperatingRow
        return {
          account: `${'　'.repeat(depth)}${o.name}`,
          budget: o.budget, actual: o.actual, samePeriod: o.samePeriod,
          yoy: pct(o.yoy), achievement: pct(o.achievement),
          ytd: o.ytd, samePeriodYtd: o.samePeriodYtd, ytdYoy: pct(o.ytdYoy),
        }
      })
      await exportToExcel({
        filename: `财务指标_经营指标_${new Date().toISOString().slice(0, 10)}.xlsx`,
        sheetName: '经营指标',
        columns: [
          { header: '科目', key: 'account', width: 40 },
          { header: '预算金额(万)', key: 'budget', width: 14 },
          { header: '本月实际(万)', key: 'actual', width: 14 },
          { header: '同期实际(万)', key: 'samePeriod', width: 14 },
          { header: '同比', key: 'yoy', width: 10 },
          { header: '达成率', key: 'achievement', width: 10 },
          { header: '本年累计(万)', key: 'ytd', width: 14 },
          { header: '同期累计(万)', key: 'samePeriodYtd', width: 14 },
          { header: '累计同比', key: 'ytdYoy', width: 10 },
        ],
        rows,
      })
    } else {
      const rows = flat.map(({ row, depth }) => {
        const s = row as StaticRow
        return {
          account: `${'　'.repeat(depth)}${s.name}`,
          actual: s.current, samePeriod: s.samePeriod, yoy: pct(s.yoy),
        }
      })
      await exportToExcel({
        filename: `财务指标_静态指标_${new Date().toISOString().slice(0, 10)}.xlsx`,
        sheetName: '静态指标',
        columns: [
          { header: '科目', key: 'account', width: 40 },
          { header: '本期金额(万)', key: 'actual', width: 16 },
          { header: '同期金额(万)', key: 'samePeriod', width: 16 },
          { header: '变动率', key: 'yoy', width: 10 },
        ],
        rows,
      })
    }
  }

  return (
    <PageContainer
      title="财务指标"
      description="按科目层级查看经营指标和静态指标数据"
      className="space-y-3"
      actions={
        can('indicators', 'export') ? (
          <Button variant="outline" size="sm" onClick={handleExport} disabled={isLoading || activeItems.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            导出Excel
          </Button>
        ) : null
      }
    >
      {/* 筛选栏 */}
      <Card className="animate-fade-in">
        <CardContent className="p-4">
          <div className="flex flex-col space-y-3 lg:flex-row lg:items-center lg:justify-between lg:space-y-0">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'operating' | 'static')}>
              <TabsList className="text-foreground">
                <TabsTrigger value="operating">经营指标</TabsTrigger>
                <TabsTrigger value="static">静态指标</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:space-x-2 sm:space-y-0">
              <Select value={dimFilter} onValueChange={setDimFilter}>
                <SelectTrigger className="w-full sm:w-[220px]">
                  <SelectValue placeholder="选择主体维度" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部主体</SelectItem>
                  <SelectGroup>
                    <SelectLabel>公司</SelectLabel>
                    {entityCompanies.map((c) => (
                      <SelectItem key={c.code} value={`company:${c.code}`}>{c.name}</SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>汇总主体</SelectLabel>
                    {summaryEntities.map((c) => (
                      <SelectItem key={c.code} value={`summary:${c.code}`}>{c.name}</SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>事业部</SelectLabel>
                    {businessUnits.map((bu) => (
                      <SelectItem key={bu} value={`bu:${bu}`}>{bu}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>

              <Select value={periodFilter} onValueChange={setPeriodFilter}>
                <SelectTrigger className="w-full sm:w-[160px]">
                  <SelectValue placeholder="选择期间" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部期间</SelectItem>
                  {periods.map((p) => (
                    <SelectItem key={p} value={p}>{p}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center space-x-2">
                <Button variant="outline" size="sm" onClick={expandActive}>
                  <ChevronsUpDown className="mr-2 h-4 w-4" />
                  全部展开
                </Button>
                <Button variant="outline" size="sm" onClick={collapseActive}>
                  <ChevronsDownUp className="mr-2 h-4 w-4" />
                  全部折叠
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 指标科目树 */}
      <Card className="animate-fade-in">
        <CardContent className="min-h-[420px] px-4 py-3">
          {isLoading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">数据加载中...</div>
          ) : activeTree.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">当前筛选无数据</div>
          ) : (
            <div className={cn('transition-opacity duration-200', isFetching && 'opacity-60')}>
              <MetricTree
                nodes={activeTree}
                valueMap={activeValueMap}
                variant={activeTab}
                categoryColumn={isOperating}
                expandedCodes={expandedCodes}
                onToggle={handleToggle}
                onAnalyze={can('reports', 'create') ? handleAnalyze : undefined}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* 单项分析抽屉 */}
      <AnalysisDrawer open={analysisTarget !== null} target={analysisTarget} onClose={() => setAnalysisTarget(null)} />
    </PageContainer>
  )
}
