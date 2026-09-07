import type { ReactNode } from 'react'
import { useExpenseAnalysis } from '@/hooks/api-queries'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { TipLabel } from '@/components/ui/tip-label'
import { totalExpenseMetrics } from './budget-total'
import { RateBar } from '@/components/ui/rate-bar'
import { ExpenseAlertLight } from '@/components/ui/alert-light'
import { DeltaTag } from '@/components/ui/delta-tag'
import { formatMoneyWan, cn } from '@/lib/utils'
import type { ExpenseAnalysisRow } from '@/types'

interface ExpenseAnalysisCardProps {
  /** 选定期（跟随看板当前期间） */
  period?: string
  /** 主体口径（跟随看板顶部筛选，单体/汇总主体编码） */
  companyCode?: string
  /** 隐藏的数据列 key（「列设置」选择器持久化值；默认空 = 全部显示，指标名称列固定不可隐藏） */
  hiddenColumns?: string[]
}

// 表头对齐《统一表格设计标准》：13px/500 黑字居中（数值列表头同样居中）；TD 保持右对齐 font-num
const TH_CLS = 'px-3 py-2 text-center text-body font-medium text-foreground'
const TD_CLS = 'px-3 py-2 text-right font-num text-sm text-foreground'

/** 单行指标组（ExpenseAnalysisRow 去掉 code/name 即指标组字段） */
type MetricOf = Omit<ExpenseAnalysisRow, 'code' | 'name'>

/** 列分组（双层表头第一层，供「列设置」选择器分组展示） */
export const EXPENSE_COLUMN_GROUPS = [
  { key: 'month', label: '月度完成情况' },
  { key: 'ytd', label: '财年累计完成情况' },
] as const

export type ExpenseColumnGroup = (typeof EXPENSE_COLUMN_GROUPS)[number]['key']

export type ExpenseColumnKey =
  | 'month-budget' | 'month-actual' | 'month-rate' | 'month-alert' | 'month-same' | 'month-yoy' | 'month-mom'
  | 'ytd-budget' | 'ytd-actual' | 'ytd-rate' | 'ytd-alert' | 'ytd-same' | 'ytd-yoy'

export interface ExpenseColumnMeta {
  key: ExpenseColumnKey
  header: string
  group: ExpenseColumnGroup
  /** 表头悬浮提示（无则纯文本表头） */
  tip?: string
  /** 单元格内容居中（预警红绿灯列） */
  center?: boolean
}

/** 运营费用明细表列元数据（key/标题/分组/提示）：表格渲染与「列设置」选择器共用 */
export const EXPENSE_COLUMN_META: readonly ExpenseColumnMeta[] = [
  { key: 'month-budget', header: '月度预算', group: 'month' },
  { key: 'month-actual', header: '本月金额', group: 'month' },
  { key: 'month-rate', header: '使用率', group: 'month', tip: '本月金额÷当月预算（月度）' },
  { key: 'month-alert', header: '预警', group: 'month', tip: '按使用率红黄绿三档：<75 绿 / 75-100 黄 / >100 红', center: true },
  { key: 'month-same', header: '同期金额', group: 'month' },
  { key: 'month-yoy', header: '同比', group: 'month', tip: '（本期-去年同期）÷去年同期' },
  { key: 'month-mom', header: '环比', group: 'month', tip: '（本月-上月）÷上月' },
  { key: 'ytd-budget', header: '年度预算', group: 'ytd' },
  { key: 'ytd-actual', header: '累计金额', group: 'ytd' },
  { key: 'ytd-rate', header: '使用率', group: 'ytd', tip: '累计金额÷年度预算（累计）' },
  { key: 'ytd-alert', header: '预警', group: 'ytd', tip: '按使用率红黄绿三档：<75 绿 / 75-100 黄 / >100 红', center: true },
  { key: 'ytd-same', header: '同期累计金额', group: 'ytd' },
  { key: 'ytd-yoy', header: '财年同比', group: 'ytd', tip: '（累计金额-同期累计）÷同期累计' },
]

/** 各数据列单元格渲染（与 EXPENSE_COLUMN_META 的 key 一一对应，Record 完备性由类型保证） */
const CELL_RENDERERS: Record<ExpenseColumnKey, (m: MetricOf) => ReactNode> = {
  'month-budget': (m) => formatMoneyWan(m.monthBudget ?? m.budget / 12),
  'month-actual': (m) => formatMoneyWan(m.monthActual),
  'month-rate': (m) => <RateBar rate={m.monthRate} />,
  'month-alert': (m) => <ExpenseAlertLight rate={m.monthRate} />,
  'month-same': (m) => formatMoneyWan(m.monthSame),
  'month-yoy': (m) => <DeltaTag value={m.monthYoy} />,
  'month-mom': (m) => <DeltaTag value={m.monthMom} />,
  'ytd-budget': (m) => formatMoneyWan(m.budget),
  'ytd-actual': (m) => formatMoneyWan(m.ytdActual),
  'ytd-rate': (m) => <RateBar rate={m.ytdRate} />,
  'ytd-alert': (m) => <ExpenseAlertLight rate={m.ytdCumRate} />,
  'ytd-same': (m) => formatMoneyWan(m.ytdSame),
  'ytd-yoy': (m) => <DeltaTag value={m.ytdYoy} />,
}

/**
 * 运营费用分析内容（运营费用分析页，单期间）：按映射配置（映射管理 > 运营费用映射）聚合的运营费用科目，
 * 同时展示月度完成情况（月度预算/本月金额/使用率/预警/同期金额/同比/环比）与
 * 财年累计完成情况（年度预算/累计金额/使用率/预警/同期累计金额/财年同比）。
 * 使用率以橙色进度条展示；预警按费用类红绿灯：使用率 <75 绿 / 75-100 黄 / >100 红，
 * 月度用月度使用率、累计用累计预算口径使用率（ytdCumRate）判断；同比/环比以红涨绿跌胶囊展示
 * （环比 =（本月-上月）÷|上月|，上月金额与环比率由后端按上期经营树取数）。主体口径跟随看板顶部筛选；
 * 外层 Card 由所在页面提供；数据列可通过 hiddenColumns 隐藏（「列设置」选择器，指标名称列固定显示）。
 */
export function ExpenseAnalysisCard({ period, companyCode, hiddenColumns = [] }: ExpenseAnalysisCardProps) {
  const { data, isLoading } = useExpenseAnalysis({ period, companyCode })
  const rows = data?.rows ?? []
  const isEmpty = !isLoading && rows.length === 0

  // 可见数据列（指标名称列固定显示不参与过滤）；累计组第一个可见列带左分隔线（该列被隐藏时随第一个可见列迁移）
  const visibleCols = EXPENSE_COLUMN_META.filter((c) => !hiddenColumns.includes(c.key))
  const monthColSpan = visibleCols.filter((c) => c.group === 'month').length
  const ytdColSpan = visibleCols.filter((c) => c.group === 'ytd').length
  const firstYtdIdx = visibleCols.findIndex((c) => c.group === 'ytd')

  const renderCells = (m: MetricOf) =>
    visibleCols.map((col, i) => (
      <td key={col.key} className={cn(TD_CLS, col.center && 'text-center', i === firstYtdIdx && 'border-l border-border/60')}>
        {CELL_RENDERERS[col.key](m)}
      </td>
    ))

  return (
    <TooltipProvider>
      {isEmpty ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm font-medium text-foreground">暂无运营费用数据</p>
            <p className="text-xs text-muted-foreground">配置运营费用映射并导入经营数据后，将按映射展示费用使用情况</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table-report data-table-report--striped">
              <thead>
                <tr className="border-b border-border">
                  <th rowSpan={2} className="text-left w-[10em]">指标名称</th>
                  <th colSpan={monthColSpan} className="text-center font-semibold">月度完成情况</th>
                  <th colSpan={ytdColSpan} className="text-center font-semibold">财年累计完成情况</th>
                </tr>
                <tr>
                  {visibleCols.map((col, i) => (
                    <th key={col.key} className={cn(TH_CLS, i === firstYtdIdx && 'border-l border-border')}>
                      {col.tip ? <TipLabel label={col.header} tip={col.tip} /> : col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { code, name, ...metric } = row
                  return (
                    <tr key={code}>
                      {/* 指标名单行截断（空格不计入 10 字符判定）：固定 w-[10em] + truncate，Tooltip 悬停显示完整名称 */}
                      <td className="px-3 py-2 text-left text-sm font-medium text-foreground w-[10em]">
                        {name.replace(/\s/g, '').length > 10 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="block w-[10em] truncate">{name}</span>
                            </TooltipTrigger>
                            <TooltipContent side="top">{name}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="block w-[10em] truncate">{name}</span>
                        )}
                      </td>
                      {renderCells(metric)}
                    </tr>
                  )
                })}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  {(() => {
                    const total = totalExpenseMetrics(rows)
                    return (
                      <tr className="border-t-2 border-border bg-muted/40 font-semibold">
                        <td className="px-3 py-2 text-left text-sm font-semibold text-foreground">合计</td>
                        {renderCells(total)}
                      </tr>
                    )
                  })()}
                </tfoot>
              )}
            </table>
          </div>
        )}
    </TooltipProvider>
  )
}
