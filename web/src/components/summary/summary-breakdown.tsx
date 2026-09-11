import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Pin, PinOff } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatMoneyWan, formatPercent, formatQuantity, getChangeColor, getChangePrefix } from '@/lib/utils'
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
 *
 * 固定（pin）：传 onPin 的调用方（指标页）浮层左上角显示钉子图标，点击后弹层关闭、
 * 同位置由页面渲染 PinnedSummaryCard（fixed 定位可拖拽）；不传 onPin 的调用方（KPI 卡）无 pin 图标，行为不变。
 * 同比：列配置 yoy/summaryYoy 可选注入，成员行/合计行在主数值右侧显示同比小字（红涨绿跌 + 前缀）。
 */

/** 浮层列配置：单列（指标页单元格）或双列（KPI 卡 本月实际+本年累计） */
export interface BreakdownColumn {
  /** 列名（"本月实际" / "本年累计" 等） */
  label: string
  /** 从成员指标值中取该列数值 */
  pick: (value: MetricValue) => number
  /** 汇总展示值（用于差额行与合计对平） */
  summaryValue: number
  /** 成员行同比取数（相对增长率，与主表 yoy 列同口径）；未配置则该列不显示同比 */
  yoy?: (value: MetricValue) => number
  /** 合计行同比（汇总口径，调用方算好传入）；未配置不显示 */
  summaryYoy?: number
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

/** 同比小字（红涨绿跌 + 前缀，1 位小数；0 显示 '-'）：紧跟主数值右侧，视觉从属于主数值 */
function YoyText({ value }: { value: number }) {
  return (
    <span className={cn('ml-1.5 font-num text-micro tabular-nums', getChangeColor(value))}>
      {value === 0 ? '-' : `${getChangePrefix(value)}${formatPercent(value)}`}
    </span>
  )
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
  /** 点击浮层 pin 图标回调（携带弹层内容 rect，页面据此渲染固定卡）；不传则浮层不渲染 pin 图标（KPI 卡现状不变） */
  onPin?: (rect: DOMRect) => void
}

/** 成员明细卡内容（Popover / 固定卡复用），供浮层与测试复用 */
export function SummaryBreakdownContent({
  title,
  columns,
  rows,
  loading = false,
  failedCount = 0,
  valueType = 'amount',
  onPinClick,
  pinned = false,
  dragHandleProps,
  rootRef,
}: {
  title: string
  columns: BreakdownColumn[]
  rows?: MemberValue[]
  loading?: boolean
  failedCount?: number
  valueType?: MetricValueType
  /** pin 图标点击回调（弹层模式：关闭弹层并固定；固定卡模式：取消固定关闭）；不传则不渲染 pin 图标 */
  onPinClick?: () => void
  /** 固定卡模式：pin 图标为已固定形态（PinOff + primary 色），语义为"点击取消固定" */
  pinned?: boolean
  /** 标题栏拖拽手柄属性（固定卡传入，pointer 事件 + cursor-grab）；弹层模式不传（hover 语义下禁止拖拽） */
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement>
  /** 内容根节点 ref（弹层模式由 Popover 传入：pin 时取 getBoundingClientRect 作为固定卡初始坐标） */
  rootRef?: React.Ref<HTMLDivElement>
}) {
  const multi = columns.length > 1
  // 比率类不可加总：不计算差额/合计（汇总值由公式按汇总口径重算，与 Σ成员无关）
  const additive = valueType !== 'ratio'
  // 各列差额：汇总值 − Σ成员（round2 后比较，浮点尾差不出现在 UI）
  const colSums = columns.map((col) => rows?.reduce((s, r) => s + col.pick(r.value), 0) ?? 0)
  const diffs = columns.map((col, i) => round2(col.summaryValue - colSums[i]))
  const hasDiff = additive && diffs.some((d) => Math.abs(d) >= DIFF_THRESHOLD)

  return (
    <div ref={rootRef} className="p-3" data-testid="summary-breakdown-content">
      <div
        data-testid="summary-breakdown-header"
        className={cn('mb-2 flex items-center justify-between gap-2', dragHandleProps && 'cursor-grab select-none')}
        {...dragHandleProps}
      >
        <span className="flex min-w-0 items-center gap-1">
          {onPinClick && (
            <button
              type="button"
              onClick={onPinClick}
              aria-label={pinned ? '取消固定' : '固定卡片'}
              data-testid="summary-breakdown-pin"
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors',
                pinned
                  ? 'bg-primary/10 text-primary hover:bg-primary/15'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            </button>
          )}
          <span className="min-w-0 truncate text-xs font-medium text-foreground">{title}</span>
        </span>
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
                  {columns.map((col) => {
                    const yoyVal = col.yoy ? col.yoy(r.value) : undefined
                    return (
                      <td key={col.label} className="py-1 pl-2 text-right">
                        <span className="font-num tabular-nums text-foreground">{fmtByType(col.pick(r.value), valueType)}</span>
                        {yoyVal !== undefined && <YoyText value={yoyVal} />}
                      </td>
                    )
                  })}
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
                {col.summaryYoy !== undefined && <YoyText value={col.summaryYoy} />}
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

/** 固定卡定位状态：pin 时刻由页面持有，数据按 subjectCode/colKey 每次渲染实时取（跟随刷新） */
export interface PinnedCardState {
  /** 科目编码（成员明细取数 key） */
  subjectCode: string
  /** 列 key（MetricValue 字段名） */
  colKey: string
  /** 卡片标题（pin 时刻的 `科目名 · 列名`） */
  title: string
  /** 科目值类型（金额/数量/比率） */
  valueType?: MetricValueType
  /** fixed 定位初始左上角（pin 时刻弹层位置，clamp 视口内） */
  x: number
  y: number
}

/**
 * 悬浮触发包装：children 原样渲染（不改变表格/卡片布局），hover / 键盘聚焦时弹出成员明细浮层。
 * 仅汇总主体口径由调用方启用；单体公司/全部公司口径不渲染本组件（数值原样）。
 *
 * 受控 open：点击浮层内 pin 图标时关闭弹层（onPin 回调携带弹层内容 rect，页面据此渲染固定卡），
 * 避免 hover 弹层与固定卡重叠；hover 开合行为与非受控一致（antd onOpenChange 透传）。
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
  onPin,
}: SummaryBreakdownPopoverProps) {
  const [open, setOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  return (
    <Popover trigger={['hover', 'focus']} open={open} onOpenChange={setOpen}>
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
          rootRef={contentRef}
          onPinClick={
            onPin
              ? () => {
                  // 固定卡初始坐标 = 弹层内容根节点 rect（clamp 由固定卡 mount 时执行）
                  onPin(contentRef.current?.getBoundingClientRect() ?? new DOMRect(0, 0, 0, 0))
                  setOpen(false)
                }
              : undefined
          }
        />
      </PopoverContent>
    </Popover>
  )
}

/** 视口 clamp：卡片（宽 300px）始终留在可操作范围内（上/左留 8px，右侧不出视口，底部至少露出头部可拖回） */
function clampToViewport(x: number, y: number): { x: number; y: number } {
  const w = typeof window === 'undefined' ? 1280 : window.innerWidth
  const h = typeof window === 'undefined' ? 800 : window.innerHeight
  const maxX = Math.max(8, w - 316)
  const maxY = Math.max(8, h - 80)
  return { x: Math.min(Math.max(x, 8), maxX), y: Math.min(Math.max(y, 8), maxY) }
}

/**
 * 固定卡（pin 后的成员明细）：portal 到 body 的 fixed 定位卡片，置顶悬浮（z-[1100] 高于 antd 弹层 1030）。
 * 标题栏为拖拽手柄（Pointer Events + setPointerCapture，移出手柄仍持续跟手）；再次点击 pin 图标（PinOff）取消固定。
 * 数据由调用方每次渲染实时注入（跟随 React Query 刷新），本组件只管定位与交互。
 */
export function PinnedSummaryCard({
  state,
  columns,
  rows,
  loading,
  failedCount,
  onClose,
}: {
  state: PinnedCardState
  columns: BreakdownColumn[]
  rows?: MemberValue[]
  loading?: boolean
  failedCount?: number
  /** 取消固定（点击 PinOff 图标）：页面清空 pinnedCell，卡片销毁 */
  onClose: () => void
}) {
  const [pos, setPos] = useState(() => clampToViewport(state.x, state.y))
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // 手柄内按钮（pin 图标）点击不触发拖拽
    if ((e.target as HTMLElement).closest('button')) return
    dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y }
    setDragging(true)
    // jsdom 无该 API，可选调用兼容测试环境
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    setPos(clampToViewport(d.originX + e.clientX - d.startX, d.originY + e.clientY - d.startY))
  }
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  return createPortal(
    <div
      data-testid="pinned-summary-card"
      className={cn(
        // 坐标不走 transition（即时跟手）；仅阴影/缩放过渡，拖拽中视觉反馈
        'fixed z-[1100] w-[300px] rounded-card border border-border bg-card shadow-lg transition-[box-shadow,transform] duration-200',
        dragging && 'scale-[1.02] shadow-xl ring-1 ring-primary/30',
      )}
      style={{ left: pos.x, top: pos.y }}
    >
      <SummaryBreakdownContent
        title={state.title}
        columns={columns}
        rows={rows}
        loading={loading}
        failedCount={failedCount}
        valueType={state.valueType}
        pinned
        onPinClick={onClose}
        dragHandleProps={{
          onPointerDown,
          onPointerMove,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
        }}
      />
    </div>,
    document.body,
  )
}
