import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { usePermission } from '@/hooks/usePermission'
import { useCompanies, useOperatingIndicators, useStaticIndicators, useAvailablePeriods, type OperatingRow, type StaticRow } from '@/hooks/api-queries'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { usePageStore } from '@/stores/pageStateStore'
import { exportToExcel } from '@/lib/export'
import { cn } from '@/lib/utils'
import type { MetricValue } from '@/lib/metric-values'
import { Download, ChevronsDownUp, ChevronsUpDown, History, Eye } from 'lucide-react'
import type { SubjectNode } from '@/types'

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
        valueType: r.valueType,
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
  const navigate = useNavigate()
  // 子标签由 URL ?tab= 直接派生（非 useState：同 pathname 切换 tab 时组件不重挂载，
  // 派生可保证导航菜单点击后页面立即联动；?tab=static 定位静态指标）
  const [searchParams] = useSearchParams()
  const activeTab: 'operating' | 'static' = searchParams.get('tab') === 'static' ? 'static' : 'operating'
  // 查询条件与展开状态持久化到 pageStateStore（路由切换/刷新后恢复）；analysisTarget 为瞬时抽屉状态
  const setIndicators = usePageStore((s) => s.setIndicators)
  const dimFilter = usePageStore((s) => s.indicators.dimFilter)
  const periodFilter = usePageStore((s) => s.indicators.periodFilter)
  const excludeReclassify = usePageStore((s) => s.indicators.excludeReclassify)
  const expandedCodes = usePageStore((s) => s.indicators.expandedCodes)
  const [analysisTarget, setAnalysisTarget] = useState<AnalysisTarget | null>(null)
  const setDimFilter = useCallback((v: string) => setIndicators({ dimFilter: v }), [setIndicators])
  const setPeriodFilter = useCallback((v: string) => setIndicators({ periodFilter: v }), [setIndicators])
  const setExcludeReclassify = useCallback((v: boolean) => setIndicators({ excludeReclassify: v }), [setIndicators])
  // 展开集合由持久化数组派生（Set 不可序列化，store 以数组存储）
  const expandedSet = useMemo(() => new Set(expandedCodes), [expandedCodes])
  const setExpandedCodes = useCallback((updater: (prev: Set<string>) => Set<string>) => {
    const prev = new Set(usePageStore.getState().indicators.expandedCodes)
    usePageStore.getState().setIndicators({ expandedCodes: [...updater(prev)] })
  }, [])

  const isOperating = activeTab === 'operating'

  const fiscalYear = usePeriodStore((s) => s.fiscalYear)
  const { data: periodsData } = useAvailablePeriods()
  // 期间候选按全局选中财年过滤
  const periods = useMemo(
    () => filterPeriodsByFiscalYear(periodsData?.periods ?? [], fiscalYear, periodsData?.fiscalStartMonth ?? 1),
    [periodsData, fiscalYear],
  )

  useEffect(() => {
    if (periods.length === 0) return
    // 首次加载（periodFilter 为空）默认选中最新期间；已选期间不存在时回退最新
    if (periodFilter === '' || (!periods.includes(periodFilter) && periodFilter !== 'all')) {
      setPeriodFilter(periods[periods.length - 1])
    }
  }, [periods])

  // 主体维度：company:CODE / summary:CODE → 传对应编码；all → 不传（后端按 scope 汇总）
  const companyCode = dimFilter.startsWith('company:')
    ? dimFilter.slice('company:'.length)
    : dimFilter.startsWith('summary:')
      ? dimFilter.slice('summary:'.length)
      : undefined
  const period = periodFilter === 'all' ? undefined : periodFilter

  const { data: companies } = useCompanies()
  // 持久化主体校验：编码已删除/超出数据权限时回退全部主体（候选加载后生效一次，用户手动切换后不再覆盖）
  useEffect(() => {
    if (!companies || companies.length === 0) return
    const valid = new Set(companies.map((c) => c.code))
    const cur = usePageStore.getState().indicators.dimFilter
    if (cur === 'all') return
    const code = cur.startsWith('company:') || cur.startsWith('summary:') ? cur.slice('company:'.length) : undefined
    if (!code || !valid.has(code)) setDimFilter('all')
  }, [companies, setDimFilter])
  const operatingQuery = useOperatingIndicators({ companyCode, period, excludeReclassify: excludeReclassify || undefined })
  const staticQuery = useStaticIndicators({ companyCode, excludeReclassify: excludeReclassify || undefined })

  const entityCompanies = useMemo(() => (companies ?? []).filter((c) => c.type === 'entity'), [companies])
  const summaryEntities = useMemo(() => (companies ?? []).filter((c) => c.type === 'summary'), [companies])

  const activeItems = (isOperating ? operatingQuery.data?.items : staticQuery.data?.items) ?? []
  const isLoading = isOperating ? operatingQuery.isLoading : staticQuery.isLoading
  // isFetching：筛选刷新中（已保留旧数据），用于轻量视觉反馈而非整块替换
  const isFetching = isOperating ? operatingQuery.isFetching : staticQuery.isFetching
  // 去重分类口径下无法回溯的记录数（批次已替换/缺快照）
  const skippedReclassifyLogs = (isOperating ? operatingQuery.data?.skippedReclassifyLogs : staticQuery.data?.skippedReclassifyLogs) ?? 0

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

  // 是否已全部展开：用于展开/折叠切换按钮的状态判断
  const isAllExpanded = activeExpandable.length > 0 && activeExpandable.every((code) => expandedSet.has(code))

  const toggleExpandAll = () =>
    setExpandedCodes((prev) => {
      if (isAllExpanded) {
        const next = new Set(prev)
        for (const code of activeExpandable) next.delete(code)
        return next
      }
      return new Set([...prev, ...activeExpandable])
    })

  /** 打开单项分析抽屉：需先选中单一公司主体 */
  const handleAnalyze = (node: SubjectNode) => {
    if (!companyCode) {
      window.alert('请先在「主体维度」中选择单一公司，再对该公司的科目撰写单项分析。')
      return
    }
    const companyName = entityCompanies.find((c) => c.code === companyCode)?.name ?? companyCode
    const effectivePeriod = period ?? periods[periods.length - 1] ?? ''
    setAnalysisTarget({
      companyCode,
      companyName,
      subjectCode: node.code,
      subjectName: node.name,
      subjectType: activeTab,
      valueType: node.valueType,
      fiscalYear: effectivePeriod.slice(0, 4),
      period: effectivePeriod,
      metric: activeValueMap.get(node.code),
    })
  }

  const handleExport = async () => {
    const pct = (v: number) => `${v.toFixed(1)}%`
    // 分型导出：比率列乘 100 加 %，数量取整，金额保持数值；比率科目同比为百分点差 pp（后端已按 pp 返回）
    const fmtVal = (v: number, vt: string) => (vt === 'ratio' ? `${(v * 100).toFixed(1)}%` : vt === 'quantity' ? Math.round(v) : v)
    const fmtYoy = (v: number, vt: string) => (vt === 'ratio' ? `${v.toFixed(1)}pp` : pct(v))
    const flat = flattenForExport(activeItems as Row[])
    // 去重分类口径导出时文件名标识区分，避免与正式口径混淆
    const scopeSuffix = excludeReclassify ? '_原始口径' : ''
    if (isOperating) {
      const rows = flat.map(({ row, depth }) => {
        const o = row as OperatingRow
        return {
          account: `${'　'.repeat(depth)}${o.name}`,
          budget: fmtVal(o.budget, o.valueType), actual: fmtVal(o.actual, o.valueType), samePeriod: fmtVal(o.samePeriod, o.valueType),
          yoy: fmtYoy(o.yoy, o.valueType), achievement: pct(o.achievement),
          ytd: fmtVal(o.ytd, o.valueType), samePeriodYtd: fmtVal(o.samePeriodYtd, o.valueType), ytdYoy: fmtYoy(o.ytdYoy, o.valueType),
        }
      })
      await exportToExcel({
        filename: `财务指标_经营指标${scopeSuffix}_${new Date().toISOString().slice(0, 10)}.xlsx`,
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
          actual: fmtVal(s.current, s.valueType), samePeriod: fmtVal(s.samePeriod, s.valueType), yoy: fmtYoy(s.yoy, s.valueType),
        }
      })
      await exportToExcel({
        filename: `财务指标_静态指标${scopeSuffix}_${new Date().toISOString().slice(0, 10)}.xlsx`,
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
        <div className="flex items-center gap-2">
          {can('indicators', 'export') ? (
            <Button variant="outline" size="sm" onClick={handleExport} disabled={isLoading || activeItems.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              导出Excel
            </Button>
          ) : null}
        </div>
      }
    >
      {/* 筛选栏 */}
      <Card className="animate-fade-in">
        <CardContent className="p-4">
          <div className="flex flex-col space-y-3 lg:flex-row lg:items-center lg:justify-end lg:space-y-0">
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

              <div
                className="flex items-center space-x-2"
                title="按重分类日志快照回溯展示调整前口径，仅供对比查看，不修改数据"
              >
                <Switch id="exclude-reclassify" checked={excludeReclassify} onCheckedChange={setExcludeReclassify} />
                <Label htmlFor="exclude-reclassify" className="cursor-pointer whitespace-nowrap text-sm">去除重分类影响</Label>
              </div>

              <div className="flex items-center space-x-2">
                {can('reports', 'view') && (
                  <Button variant="outline" size="sm" onClick={() => navigate('/reports?tab=analyses')}>
                    <Eye className="mr-2 h-4 w-4" /> 查看分析
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={toggleExpandAll}>
                  {isAllExpanded ? (
                    <ChevronsDownUp className="mr-2 h-4 w-4" />
                  ) : (
                    <ChevronsUpDown className="mr-2 h-4 w-4" />
                  )}
                  {isAllExpanded ? '全部折叠' : '全部展开'}
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 去重分类模拟口径提示条 */}
      {excludeReclassify && (
        <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning/[0.08] px-4 py-2 text-sm text-warning-strong">
          <History className="h-4 w-4 shrink-0" />
          <span>
            当前展示的是去除跨公司重分类影响后的模拟口径，不修改任何数据。
            {skippedReclassifyLogs > 0 && `另有 ${skippedReclassifyLogs} 条记录因数据批次已替换无法回溯。`}
          </span>
        </div>
      )}

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
                expandedCodes={expandedSet}
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
