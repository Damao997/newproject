import { useEffect, useMemo, useRef, useState } from 'react'
import { Node, mergeAttributes, type NodeViewProps } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { BarChart3, Loader2, TriangleAlert, X } from 'lucide-react'
import ReactECharts, { echarts } from '@/components/charts/echarts-core'
import { CHART_FONT, getChartInk, getChartSeries } from '@/lib/chart-theme'
import { useThemeStore } from '@/stores/themeStore'
import { useReportChartData, useCompanies, useSubjectTree } from '@/hooks/api-queries'
import { formatMoneyWan, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

/**
 * 报告内嵌图表（TipTap 自定义 Atom Node）：
 * - attrs 携带快照式参数（公司×科目×科目体系×期间），HTML 序列化为 div[data-chart-*]，
 *   前后端净化白名单均已放行该属性集
 * - NodeView 实时渲染：经 POST /reports/chart-data 取数（reports:view 即可读），
 *   经营/现金流科目画「实际/同期/预算」三柱，静态科目画「期末/年初/上年同期」
 * - 进入视口才初始化 ECharts（IntersectionObserver 懒渲染），长报告多图不卡顿
 * - 编辑态选中显示删除按钮；数据缺失/越权显示占位说明
 */

export interface ChartAttrs {
  companyCode: string
  subjectCode: string
  subjectType: 'operating' | 'static' | 'cashflow'
  period: string
  title: string
}

export const ChartNode = Node.create({
  name: 'chart',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      companyCode: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-chart-company') ?? '',
        renderHTML: (attrs) => ({ 'data-chart-company': attrs.companyCode }),
      },
      subjectCode: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-chart-subject') ?? '',
        renderHTML: (attrs) => ({ 'data-chart-subject': attrs.subjectCode }),
      },
      subjectType: {
        default: 'operating',
        parseHTML: (el) => {
          const v = el.getAttribute('data-chart-subject-type')
          return v === 'static' || v === 'cashflow' ? v : 'operating'
        },
        renderHTML: (attrs) => ({ 'data-chart-subject-type': attrs.subjectType }),
      },
      period: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-chart-period') ?? '',
        renderHTML: (attrs) => ({ 'data-chart-period': attrs.period }),
      },
      title: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-chart-title') ?? '',
        renderHTML: (attrs) => ({ 'data-chart-title': attrs.title }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-chart]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-chart': '1' }, HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ChartView)
  },
})

/** ECharts 柱图配置（与首页趋势图同源的纸质感样式） */
function buildChartOption(labels: string[], values: Array<number | null | undefined>, colors: string[], ink: ReturnType<typeof getChartInk>) {
  return {
    animation: false,
    textStyle: { fontFamily: CHART_FONT },
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'shadow' as const, shadowStyle: { color: 'rgba(0,0,0,0.04)' } },
      formatter: (params: unknown) => {
        const arr = params as Array<{ name: string; value: number | null; seriesName: string; color: string }>
        if (!Array.isArray(arr) || arr.length === 0) return ''
        let html = `<div style="font-weight:600;margin-bottom:4px">${arr[0].name}</div>`
        arr.forEach((item) => {
          const v = item.value === null || item.value === undefined ? '–' : `${formatMoneyWan(item.value)} 万`
          html += `<div style="display:flex;align-items:center;gap:6px;margin:2px 0"><span style="width:8px;height:8px;border-radius:50%;background:${item.color};display:inline-block"></span>${item.seriesName}<span style="margin-left:auto;font-weight:600">${v}</span></div>`
        })
        return html
      },
    },
    grid: { top: 16, right: 16, bottom: 28, left: 8, containLabel: true },
    xAxis: {
      type: 'category' as const,
      data: labels,
      axisLine: { lineStyle: { color: ink.grid } },
      axisTick: { show: false },
      axisLabel: { color: ink.axis, fontSize: 11 },
    },
    yAxis: {
      type: 'value' as const,
      name: '万元',
      nameTextStyle: { color: ink.axis, fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { lineStyle: { color: ink.grid, type: 'dashed' } },
      axisLabel: { color: ink.axis, fontSize: 11 },
    },
    series: [
      {
        name: '数值',
        type: 'bar' as const,
        data: values,
        barWidth: '32%',
        itemStyle: (p: { dataIndex: number }) => ({ color: colors[p.dataIndex % colors.length], borderRadius: [4, 4, 0, 0] }),
      },
    ],
  }
}

/** 图表 NodeView：懒渲染 + 取数 + 编辑态删除 */
function ChartView({ node, editor, deleteNode, selected }: NodeViewProps) {
  const attrs = node.attrs as ChartAttrs
  const sidebarStyle = useThemeStore((s) => s.sidebarStyle)
  const { data, isLoading, isError, error } = useReportChartData({
    companyCode: attrs.companyCode,
    subjectCode: attrs.subjectCode,
    subjectType: attrs.subjectType,
    period: attrs.period,
  })
  // 进入视口才初始化 ECharts（长报告多图懒渲染）
  const containerRef = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = containerRef.current
    if (!el || inView) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true)
          io.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [inView])

  const isStatic = attrs.subjectType === 'static'
  const labels = isStatic ? ['期末值', '年初值', '上年同期'] : ['本期实际', '上年同期', '本期预算']
  const values = useMemo(() => {
    if (!data) return [null, null, null]
    return isStatic
      ? [data.current ?? null, data.yearStart ?? null, data.samePeriod ?? null]
      : [data.actual ?? null, data.samePeriod ?? null, data.budget ?? null]
  }, [data, isStatic])
  const option = useMemo(() => {
    if (!inView || !data) return null
    const ink = getChartInk()
    const seriesColors = getChartSeries(sidebarStyle)
    return buildChartOption(labels, values, [seriesColors[0], seriesColors[1], seriesColors[4]], ink)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, data, sidebarStyle])

  const editable = editor.isEditable

  return (
    <NodeViewWrapper as="div">
      <div
        ref={containerRef}
        className={cn(
          'my-2 rounded-md border bg-card p-3',
          selected && editor.isEditable && 'ring-2 ring-primary/40',
        )}
      >
        <div className="mb-1.5 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 truncate text-body font-medium text-foreground" title={attrs.title}>
            {attrs.title || data?.name || attrs.subjectCode}
          </span>
          <span className="ml-auto shrink-0 text-caption text-muted-foreground">
            {attrs.companyCode} · {attrs.subjectCode} · {attrs.period}
          </span>
          {editable && selected && (
            <button
              type="button"
              aria-label="删除图表"
              title="删除图表"
              onClick={deleteNode}
              className="rounded p-1 text-muted-foreground hover:bg-destructive-50 hover:text-destructive"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {isLoading ? (
          <div className="flex h-[220px] items-center justify-center gap-2 text-caption text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> 图表数据加载中…
          </div>
        ) : isError || !data ? (
          <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-caption text-muted-foreground">
            <TriangleAlert className="h-5 w-5 text-warning-strong" />
            <span>{(error as Error | undefined)?.message || '暂无图表数据（科目未导入或无权限）'}</span>
          </div>
        ) : (
          <div className="h-[220px] w-full">
            {inView && option ? (
              <ReactECharts echarts={echarts} option={option} notMerge style={{ height: '100%', width: '100%' }} opts={{ renderer: 'svg' }} />
            ) : (
              <div className="flex h-full items-center justify-center text-caption text-muted-foreground">图表加载中…</div>
            )}
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

// ============ 图表插入对话框 ============

const SUBJECT_TYPE_OPTIONS = [
  { value: 'operating', label: '经营科目' },
  { value: 'static', label: '静态科目' },
  { value: 'cashflow', label: '现金流科目' },
] as const

/**
 * 插入图表对话框：公司 × 科目体系 × 科目（关键词过滤）× 期间（默认报告期间）。
 * onInsert 由编辑器提供（chain().insertContent chart 节点）。
 */
export function ChartInsertDialog({
  open,
  onClose,
  onInsert,
  defaultCompanyCode,
  defaultPeriod,
}: {
  open: boolean
  onClose: () => void
  onInsert: (attrs: ChartAttrs) => void
  defaultCompanyCode: string
  defaultPeriod: string
}) {
  const { data: companies } = useCompanies()
  const [companyCode, setCompanyCode] = useState(defaultCompanyCode)
  const [subjectType, setSubjectType] = useState<'operating' | 'static' | 'cashflow'>('operating')
  const [keyword, setKeyword] = useState('')
  const [selectedSubject, setSelectedSubject] = useState<{ code: string; name: string } | null>(null)
  const { data: treeData, isLoading: treeLoading } = useSubjectTree(subjectType)

  // 打开时重置（沿用默认值）
  useEffect(() => {
    if (open) {
      setCompanyCode(defaultCompanyCode)
      setSubjectType('operating')
      setKeyword('')
      setSelectedSubject(null)
    }
  }, [open, defaultCompanyCode])

  const singleCompanies = (companies ?? []).filter((c) => c.type === 'entity')
  const subjects = treeData ?? []
  const q = keyword.trim().toLowerCase()
  const matchedSubjects = q
    ? subjects.filter((s) => s.code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)).slice(0, 30)
    : subjects.filter((s) => s.isLeaf || s.level <= 1).slice(0, 30)

  const canSubmit = !!companyCode && !!selectedSubject && !!defaultPeriod

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>插入数据图表</DialogTitle>
          <DialogDescription>选择公司、科目与期间，图表将随最新数据实时渲染（读者亦可见）。</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>公司</Label>
            <Select value={companyCode} onValueChange={(v) => { setCompanyCode(v); setSelectedSubject(null) }}>
              <SelectTrigger className="h-9 w-full"><SelectValue placeholder="选择公司" /></SelectTrigger>
              <SelectContent>
                {singleCompanies.length === 0 ? (
                  <SelectItem value="__none" disabled>暂无可选公司</SelectItem>
                ) : (
                  singleCompanies.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>科目体系</Label>
            <Select value={subjectType} onValueChange={(v) => { setSubjectType(v as 'operating' | 'static' | 'cashflow'); setSelectedSubject(null) }}>
              <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUBJECT_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>科目（输入编码或名称过滤）</Label>
            <Input
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setSelectedSubject(null) }}
              placeholder="如：PL02 或 毛利"
              className="h-9"
            />
            <div className="max-h-40 overflow-y-auto rounded-md border border-border">
              {treeLoading ? (
                <p className="px-3 py-2 text-caption text-muted-foreground">科目加载中…</p>
              ) : matchedSubjects.length === 0 ? (
                <p className="px-3 py-2 text-caption text-muted-foreground">无匹配科目</p>
              ) : (
                matchedSubjects.map((s) => (
                  <button
                    key={s.code}
                    type="button"
                    onClick={() => setSelectedSubject({ code: s.code, name: s.name })}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-caption transition-colors hover:bg-muted',
                      selectedSubject?.code === s.code ? 'bg-muted text-primary' : 'text-foreground',
                    )}
                  >
                    <span className="truncate">{s.name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{s.code}</span>
                  </button>
                ))
              )}
            </div>
          </div>
          <p className="text-caption text-muted-foreground">期间：{defaultPeriod}（取报告期间）</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              if (!selectedSubject) return
              onInsert({
                companyCode,
                subjectCode: selectedSubject.code,
                subjectType,
                period: defaultPeriod,
                title: `${selectedSubject.name}（${defaultPeriod}）`,
              })
              onClose()
            }}
          >
            插入图表
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
