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
import { AiOverviewDialog } from '@/components/indicators/ai-overview-panel'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { usePermission } from '@/hooks/usePermission'
import { useCompanies, useOperatingIndicators, useStaticIndicators, useAvailablePeriods, type OperatingRow, type StaticRow } from '@/hooks/api-queries'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { usePageStore } from '@/stores/pageStateStore'
import { exportToExcel } from '@/lib/export'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import type { MetricValue } from '@/lib/metric-values'
import { Download, ChevronsDownUp, ChevronsUpDown, History, Eye, Sparkles, Loader2 } from 'lucide-react'
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
  // AI 预分析弹窗开关（数据就绪后令牌递增，由弹窗内自动打开）
  const [overviewOpen, setOverviewOpen] = useState(false)
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
  }, [periods, periodFilter, setPeriodFilter])

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
  // AI 预分析需要两体系数据：当前 tab 的 query 恒挂载，另一体系在触发预分析时按需拉取（静态懒加载）
  const [aiNeedData, setAiNeedData] = useState(false)
  const operatingQuery = useOperatingIndicators(
    { companyCode, period, excludeReclassify: excludeReclassify || undefined },
    { enabled: isOperating || aiNeedData },
  )
  const staticQuery = useStaticIndicators(
    { companyCode, period, excludeReclassify: excludeReclassify || undefined },
    { enabled: !isOperating || aiNeedData },
  )

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

  /** 打开单项分析抽屉：需先选中单一公司主体（未选择时按钮已在表格中禁用并提示） */
  const handleAnalyze = (node: SubjectNode) => {
    // 安全兜底：未选单一公司时不打开（正常流程按钮已禁用，此处防类型窄化丢失）
    if (!companyCode) return
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

  /** AI 全局预分析：筛选栏入口按钮触发面板自动生成（令牌递增） */
  const [overviewAutoRun, setOverviewAutoRun] = useState(0)
  // 两体系数据均就绪（对象存在即视为已加载，即使 items 为空）→ 递增令牌触发面板生成
  const bothReady = operatingQuery.data !== undefined && staticQuery.data !== undefined
  // 数据准备中：AI 已触发但另一体系数据仍在拉取（顶部按钮 loading 反馈）
  const overviewPreparing = aiNeedData && !bothReady
  useEffect(() => {
    if (aiNeedData && bothReady) {
      setAiNeedData(false)
      setOverviewAutoRun((n) => n + 1)
    }
  }, [aiNeedData, bothReady])
  // 预分析数据：经营+静态两体系；未加载的另一体系为空数组（触发预分析时按需拉取后自动生成）
  const overviewOperatingRows = useMemo(
    () => flattenForExport((operatingQuery.data?.items ?? []) as Row[]).map(({ row }) => row),
    [operatingQuery.data?.items],
  )
  const overviewStaticRows = useMemo(
    () => flattenForExport((staticQuery.data?.items ?? []) as Row[]).map(({ row }) => row),
    [staticQuery.data?.items],
  )
  const hasOverviewData = overviewOperatingRows.length + overviewStaticRows.length > 0

  /** 重置筛选：恢复默认主体/期间/重分类口径（空状态引导动作） */
  const handleResetFilters = () => {
    setDimFilter('all')
    setPeriodFilter('')
    setExcludeReclassify(false)
  }

  const handleExport = async () => {
    const pct = (v: number) => `${v.toFixed(1)}%`
    // 分型导出：比率列乘 100 加 %，数量取整，金额保持数值；同比统一按增长率百分比（后端已按增长率返回）
    const fmtVal = (v: number, vt: string) => (vt === 'ratio' ? `${(v * 100).toFixed(1)}%` : vt === 'quantity' ? Math.round(v) : v)
    const fmtYoy = (v: number) => pct(v)
    const flat = flattenForExport(activeItems as Row[])
    // 去重分类口径导出时文件名标识区分，避免与正式口径混淆
    const scopeSuffix = excludeReclassify ? '_原始口径' : ''
    if (isOperating) {
      const rows = flat.map(({ row, depth }) => {
        const o = row as OperatingRow
        return {
          account: `${'　'.repeat(depth)}${o.name}`,
          budget: fmtVal(o.budget, o.valueType), actual: fmtVal(o.actual, o.valueType), samePeriod: fmtVal(o.samePeriod, o.valueType),
          yoy: fmtYoy(o.yoy), achievement: pct(o.achievement),
          ytd: fmtVal(o.ytd, o.valueType), samePeriodYtd: fmtVal(o.samePeriodYtd, o.valueType), ytdYoy: fmtYoy(o.ytdYoy),
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
          actual: fmtVal(s.current, s.valueType), samePeriod: fmtVal(s.samePeriod, s.valueType), yoy: fmtYoy(s.yoy),
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
    <PageContainer title="财务指标" description="按科目层级查看经营指标和静态指标数据" className="space-y-3">
      {/* 筛选与操作控制条 */}
      <Card className="animate-fade-in">
        <CardContent className="p-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            {/* 左侧：主体维度选择（加宽，保证公司名称完整显示） */}
            <Select value={dimFilter} onValueChange={setDimFilter}>
              <SelectTrigger className="h-8 w-full lg:w-[280px]" aria-label="主体维度">
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

            {/* 右侧：期间 + 重分类 + 操作按钮组（lg 以上靠右对齐） */}
            <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
              <Select value={periodFilter} onValueChange={setPeriodFilter}>
                <SelectTrigger className="h-8 w-full sm:w-[160px]" aria-label="期间">
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
                className="flex items-center gap-1.5"
                title="按重分类日志快照回溯展示调整前口径，仅供对比查看，不修改数据"
              >
                <Switch id="exclude-reclassify" checked={excludeReclassify} onCheckedChange={setExcludeReclassify} />
                <Label htmlFor="exclude-reclassify" className="cursor-pointer whitespace-nowrap text-[13px]">去除重分类影响</Label>
              </div>

              <div className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

              {/* AI 预分析：点击后弹出分析窗口（数据就绪后自动生成） */}
              {can('reports', 'create') ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAiNeedData(true)}
                  disabled={isLoading || !hasOverviewData || overviewPreparing}
                >
                  {overviewPreparing ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                  {overviewPreparing ? '数据准备中…' : 'AI 预分析'}
                </Button>
              ) : null}

              {/* 查看分析：跳转单项分析管理页 */}
              {can('reports', 'view') ? (
                <Button variant="outline" size="sm" onClick={() => navigate('/reports?tab=analyses')}>
                  <Eye className="mr-1 h-3.5 w-3.5" /> 查看分析
                </Button>
              ) : null}

              {/* 展开/折叠全部 */}
              <Button variant="outline" size="sm" onClick={toggleExpandAll}>
                {isAllExpanded ? <ChevronsDownUp className="mr-1 h-3.5 w-3.5" /> : <ChevronsUpDown className="mr-1 h-3.5 w-3.5" />}
                {isAllExpanded ? '全部折叠' : '全部展开'}
              </Button>

              {/* 导出 Excel */}
              {can('indicators', 'export') ? (
                <Button variant="outline" size="sm" onClick={handleExport} disabled={isLoading || activeItems.length === 0}>
                  <Download className="mr-1 h-3.5 w-3.5" /> 导出 Excel
                </Button>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* AI 全局预分析弹窗（权限控制显示；key 重建保证筛选变化时旧流中止、数据随新筛选；关闭不中断后台生成） */}
      {can('reports', 'create') ? (
        <AiOverviewDialog
          key={`${companyCode ?? 'all'}|${period ?? 'all'}`}
          open={overviewOpen}
          onOpenChange={setOverviewOpen}
          onViewAnalyses={() => navigate('/reports?tab=analyses')}
          slotKey={`${companyCode ?? 'all'}|${period ?? 'all'}`}
          companyCode={companyCode}
          period={period ?? periods[periods.length - 1]}
          operatingRows={overviewOperatingRows}
          staticRows={overviewStaticRows}
          disabled={isLoading}
          autoRunToken={overviewAutoRun}
          onNeedData={() => setAiNeedData(true)}
        />
      ) : null}

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
            /* 加载骨架：保持表格占位高度，避免内容区塌陷再撑回导致跳动 */
            <div className="py-3">
              <div className="flex gap-3">
                {Array.from({ length: isOperating ? 10 : 5 }).map((_, c) => (
                  <Skeleton key={c} className="h-11 flex-1" />
                ))}
              </div>
              {Array.from({ length: 6 }).map((_, r) => (
                <div key={r} className="mt-2 flex gap-3">
                  {Array.from({ length: isOperating ? 10 : 5 }).map((_, c) => (
                    <Skeleton key={c} className="h-10 flex-1" />
                  ))}
                </div>
              ))}
            </div>
          ) : activeTree.length === 0 ? (
            /* 空状态：引导调整筛选或一键重置 */
            <div className="py-16 text-center">
              <p className="text-sm text-muted-foreground">当前筛选无数据</p>
              <p className="mt-1 text-xs text-muted-foreground/70">请调整主体维度或期间后重试。</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={handleResetFilters}>
                重置筛选
              </Button>
            </div>
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
                analyzeDisabled={!companyCode}
                analyzeHint="请先在「主体维度」选择单一公司，再对该公司的科目撰写单项分析"
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
