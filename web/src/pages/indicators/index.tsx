import { useMemo, useState } from 'react'
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
import { usePermission } from '@/hooks/usePermission'
import { exportToExcel } from '@/lib/export'
import {
  operatingAnalysisTree,
  staticAnalysisTree,
  flattenTree,
} from '@/lib/subject-tree'
import { computeMetricMap, calcYoy, calcAchievement, calcYtdYoy } from '@/lib/metric-values'
import { Download, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { mockCompanies } from '@/mock/data'
import type { SubjectNode } from '@/types'

// 主体维度筛选：公司 / 汇总主体 / 事业部
const entityCompanies = mockCompanies.filter((c) => c.type === 'entity')
const summaryEntities = mockCompanies.filter((c) => c.type === 'summary')
const businessUnits = Array.from(
  new Set(entityCompanies.map((c) => c.businessUnit).filter((bu): bu is string => !!bu)),
)

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

const operatingRootCodes = operatingAnalysisTree.map((n) => n.code)
const staticRootCodes = staticAnalysisTree.map((n) => n.code)
const operatingExpandable = collectExpandableCodes(operatingAnalysisTree)
const staticExpandable = collectExpandableCodes(staticAnalysisTree)

export default function IndicatorsPage() {
  const { can } = usePermission()
  const [activeTab, setActiveTab] = useState<'operating' | 'static'>('operating')
  const [dimFilter, setDimFilter] = useState('all')
  const [periodFilter, setPeriodFilter] = useState('2025-06')
  // 默认展开两棵树的 level0
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(
    () => new Set([...operatingRootCodes, ...staticRootCodes]),
  )

  const isOperating = activeTab === 'operating'
  const activeTree = isOperating ? operatingAnalysisTree : staticAnalysisTree
  const activeExpandable = isOperating ? operatingExpandable : staticExpandable

  const operatingValueMap = useMemo(
    () => computeMetricMap(operatingAnalysisTree, dimFilter, periodFilter, { valueMin: 5, valueMax: 200 }),
    [dimFilter, periodFilter],
  )
  const staticValueMap = useMemo(
    () => computeMetricMap(staticAnalysisTree, dimFilter, periodFilter, { valueMin: 500, valueMax: 5000 }),
    [dimFilter, periodFilter],
  )
  const activeValueMap = isOperating ? operatingValueMap : staticValueMap

  const handleToggle = (code: string) => {
    setExpandedCodes((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const expandActive = () =>
    setExpandedCodes((prev) => new Set([...prev, ...activeExpandable]))
  const collapseActive = () =>
    setExpandedCodes((prev) => {
      const next = new Set(prev)
      for (const code of activeExpandable) next.delete(code)
      return next
    })

  const handleExport = async () => {
    const pct = (v: number) => `${(v * 100).toFixed(1)}%`
    const rows = flattenTree(activeTree).map(({ node, depth }) => {
      const mv = activeValueMap.get(node.code)
      const indent = '　'.repeat(depth)
      if (isOperating) {
        return {
          account: `${indent}${node.name}`,
          budget: mv?.budget ?? 0,
          actual: mv?.actual ?? 0,
          samePeriod: mv?.samePeriod ?? 0,
          yoy: mv ? pct(calcYoy(mv)) : '-',
          achievement: mv ? pct(calcAchievement(mv)) : '-',
          ytd: mv?.ytd ?? 0,
          samePeriodYtd: mv?.samePeriodYtd ?? 0,
          ytdYoy: mv ? pct(calcYtdYoy(mv)) : '-',
        }
      }
      return {
        account: `${indent}${node.name}`,
        actual: mv?.actual ?? 0,
        samePeriod: mv?.samePeriod ?? 0,
        yoy: mv ? pct(calcYoy(mv)) : '-',
      }
    })

    if (isOperating) {
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
          <Button variant="outline" size="sm" onClick={handleExport}>
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
              {/* 筛选器1：公司 / 汇总主体 / 事业部 */}
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

              {/* 筛选器2：期间 */}
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
        <CardContent className="px-4 py-3">
          <MetricTree
            nodes={activeTree}
            valueMap={activeValueMap}
            variant={activeTab}
            categoryColumn={isOperating}
            expandedCodes={expandedCodes}
            onToggle={handleToggle}
          />
        </CardContent>
      </Card>
    </PageContainer>
  )
}
