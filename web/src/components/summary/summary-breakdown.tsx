import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatMoneyWan, formatPercent, formatQuantity, getChangeColor } from '@/lib/utils'
import type { MetricValueType } from '@/lib/utils'
import type { MetricValue } from '@/lib/metric-values'
import type { MemberValue } from '@/hooks/use-summary-member-values'

/**
 * 汇总指标成员明细浮层：hover 汇总口径的指标数值时，展示该汇总下所有单体公司的对应数值。
 *
 * 口径一致性（金额/数量类，可加总）：汇总展示值 = Σ成员值 + 汇总抵消调整（后端汇总口径叠加的内部抵消净额）。
 * 每列独立对平：diff = 汇总值 − Σ成员；|diff| ≥ 0.01 万元时显示「汇总抵消调整」行，
 * 合计行恒等于汇总展示值。差额为 0 时仅显示成员合计。
 *
 * 比率类（valueType='ratio'，不可加总）：成员行展示各成员自身公式重算值（百分比格式），
 * 不渲染差额行与合计行，改为口径说明文案（汇总值由公式按汇总口径重算，非成员之和）。
 *
 * 交互：antd Popover hover+focus 触发（悬停约 100ms 开、移开自动隐藏；键盘聚焦可开），
 * 数据由调用方预取注入（React Query 缓存），浮层渲染零网络等待。
 */

/** 浮层列配置：单列（指标页单元格）或双列（KPI 卡 本月实际+本年累计） */
export interface BreakdownColumn {
  /** 列名（"本月实际" / "本年累计" 等） */
  label: string
  /** 从成员指标值中取该列数值 */
  pick: (value: MetricValue) => number
  /** 汇总展示值（用于差额行与合计对平） */
  summaryValue: number
}

/** 万元两位小数（差额/合计对平用，避免浮点尾差） */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** 差额阈值：小于 0.01 万元视为无抵消调整 */
const DIFF_THRESHOLD = 0.01

/** 按科目值类型分型格式化：比率百分比（1 位小数）/ 数量整数 / 金额万元两位小数 */
function fmtByType(v: number, valueType: MetricValueType | string | undefined): string {
  if (valueType === 'ratio') return formatPercent(v)
  if (valueType === 'quantity') return formatQuantity(v)
  return formatMoneyWan(v)
}

/** 浮层单位标签：金额万元 / 比率 % / 数量（具体单位科目级各异，统一标注"数量"） */
function unitLabel(valueType: MetricValueType | string | undefined): string {
  if (valueType === 'ratio') return '%'
  if (valueType === 'quantity') return '数量'
  return '万元'
}

interface SummaryBreakdownPopoverProps {
  /** 浮层标题（科目名 / KPI 指标名） */
  title: string
  /** 列配置（1-2 列） */
  columns: BreakdownColumn[]
  /** 成员明细；undefined 或 loading=true → 骨架行 */
  rows?: MemberValue[]
  /** 成员树预取中 */
  loading?: boolean
  /** 预取失败成员数（>0 显示提示行） */
  failedCount?: number
  /** 科目值类型（金额/数量/比率，决定格式化与合计口径）；缺省 amount（看板 KPI 卡均金额类） */
  valueType?: MetricValueType
  /** 触发元素（原数值，原样渲染不改变外观） */
  children: React.ReactNode
  /** 触发元素附加类 */
  className?: string
}

/** 成员明细卡内容（Popover 内），供浮层与测试复用 */
export function SummaryBreakdownContent({
  title,
  columns,
  rows,
  loading = false,
  failedCount = 0,
  valueType = 'amount',
}: {
  title: string
  columns: BreakdownColumn[]
  rows?: MemberValue[]
  loading?: boolean
  failedCount?: number
  valueType?: MetricValueType
}) {
  const multi = columns.length > 1
  // 比率类不可加总：不计算差额/合计（汇总值由公式按汇总口径重算，与 Σ成员无关）
  const additive = valueType !== 'ratio'
  // 各列差额：汇总值 − Σ成员（round2 后比较，浮点尾差不出现在 UI）
  const colSums = columns.map((col) => rows?.reduce((s, r) => s + col.pick(r.value), 0) ?? 0)
  const diffs = columns.map((col, i) => round2(col.summaryValue - colSums[i]))
  const hasDiff = additive && diffs.some((d) => Math.abs(d) >= DIFF_THRESHOLD)

  return (
    <div className="p-3" data-testid="summary-breakdown-content">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-medium text-foreground">{title}</span>
        <span className="shrink-0 text-micro text-muted-foreground">{multi ? `单位：${unitLabel(valueType)}` : `${columns[0].label}（${unitLabel(valueType)}）`}</span>
      </div>

      {loading || rows === undefined ? (
        <div className="space-y-2 py-1" aria-label="成员明细加载中">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-3.5 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-3 text-center text-xs text-muted-foreground">成员公司暂无数据</p>
      ) : (
        <div className="max-h-[280px] overflow-y-auto">
          <table className="w-full text-xs" aria-label={`${title}成员公司明细`}>
            {multi && (
              <thead>
                <tr className="text-micro text-muted-foreground">
                  <th scope="col" className="py-1 pr-2 text-left font-normal">成员公司</th>
                  {columns.map((col) => (
                    <th key={col.label} scope="col" className="py-1 pl-2 text-right font-normal">{col.label}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {rows.map((r) => (
                <tr key={r.code} className="border-t border-subtle">
                  <td className="max-w-[8.5em] truncate py-1 pr-2 text-foreground" title={r.name}>{r.name}</td>
                  {columns.map((col) => (
                    <td key={col.label} className="py-1 pl-2 text-right">
                      <span className="font-num tabular-nums text-foreground">{fmtByType(col.pick(r.value), valueType)}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {failedCount > 0 && (
        <p className="mt-2 text-micro text-warning-strong">{failedCount} 家成员数据加载失败，明细可能不完整</p>
      )}

      {/* 差额行：仅可加总类型（金额/数量）且存在汇总抵消调整时显示（红涨绿跌：正差额红、负差额绿） */}
      {additive && rows !== undefined && rows.length > 0 && hasDiff && (
        <div className={cn('mt-2 flex items-center justify-between gap-2 border-t border-subtle pt-2', multi ? 'flex-wrap' : '')}>
          <span className="text-xs text-muted-foreground">汇总抵消调整</span>
          <span className={cn('flex gap-3 font-num text-xs tabular-nums', multi && 'flex-1 justify-end')}>
            {columns.map((col, i) => (
              <span key={col.label} className={cn(multi ? 'w-[4.5em] text-right' : '', getChangeColor(diffs[i]))}>
                {fmtByType(diffs[i], valueType)}
              </span>
            ))}
          </span>
        </div>
      )}

      {/* 合计行：仅可加总类型渲染，恒等于汇总展示值（Σ成员 + 抵消差额）；比率类改为口径说明 */}
      {rows !== undefined && rows.length > 0 && (additive ? (
        <div className="mt-1 flex items-center justify-between gap-2 border-t border-border bg-muted/40 px-1.5 py-1.5 font-semibold">
          <span className="text-xs text-foreground">合计</span>
          <span className={cn('flex gap-3 font-num text-xs tabular-nums', multi && 'flex-1 justify-end')}>
            {columns.map((col, i) => (
              <span key={col.label} className={cn('text-foreground', multi ? 'w-[4.5em] text-right' : '')}>
                {fmtByType(round2(colSums[i] + diffs[i]), valueType)}
              </span>
            ))}
          </span>
        </div>
      ) : (
        <p className="mt-2 border-t border-subtle pt-2 text-micro leading-relaxed text-muted-foreground">
          比率为各成员公司自身口径，不可直接加总；汇总值由公式按汇总口径重算
        </p>
      ))}
    </div>
  )
}

/**
 * 悬浮触发包装：children 原样渲染（不改变表格/卡片布局），hover / 键盘聚焦时弹出成员明细浮层。
 * 仅汇总主体口径由调用方启用；单体公司/全部公司口径不渲染本组件（数值原样）。
 */
export function SummaryBreakdownPopover({
  title,
  columns,
  rows,
  loading,
  failedCount,
  valueType,
  children,
  className,
}: SummaryBreakdownPopoverProps) {
  return (
    <Popover trigger={['hover', 'focus']}>
      <PopoverTrigger>
        <span
          tabIndex={0}
          aria-label="查看成员公司明细"
          data-testid="summary-breakdown-trigger"
          className={cn('inline-block cursor-help rounded-sm focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary', className)}
        >
          {children}
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] rounded-card border border-border bg-card shadow-md" side="bottom" align="end">
        <SummaryBreakdownContent
          title={title}
          columns={columns}
          rows={rows}
          loading={loading}
          failedCount={failedCount}
          valueType={valueType}
        />
      </PopoverContent>
    </Popover>
  )
}
