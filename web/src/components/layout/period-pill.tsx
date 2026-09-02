import { useEffect, useMemo } from 'react'
import { Calendar, ChevronDown } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { useAvailablePeriods } from '@/hooks/api-queries'
import { cn } from '@/lib/utils'

/**
 * 顶栏期间胶囊（参考 AntD ProLayout 风格）：
 * 形态为 `FY2026 · 8月` 的圆角胶囊，点击展开财年 + 月份双下拉；
 * 写入选中项至 periodStore（fiscalYear / period）。
 *
 * 数据流：
 * - useAvailablePeriods 拉取 periods / fiscalYears / fiscalStartMonth（periods 升序，fiscalYears 降序）
 * - 财年下拉选项 = fiscalYears；月份下拉选项 = 当前财年内可用的 periods
 * - 财年切换时若当前 period 不在新财年候选内，自动回退到新财年最新月份
 *
 * 加载/失败/空数据态：参考现有 header.tsx 财年选择器，渲染骨架或占位文案，避免「功能不见了」的困惑。
 */
export function PeriodPill() {
  const fiscalYear = usePeriodStore((s) => s.fiscalYear)
  const period = usePeriodStore((s) => s.period)
  const setFiscalYear = usePeriodStore((s) => s.setFiscalYear)
  const setPeriod = usePeriodStore((s) => s.setPeriod)
  const { data, isPending, isError } = useAvailablePeriods()

  // data 每次渲染是稳定引用（React Query），但为符合 useMemo 依赖稳定性，加锁：periods/fiscalYears 是字符串数组
  // 本就稳定，fiscalStartMonth 是 number；缺失时回退常量，组合依赖值不会每次 render 重新创建
  const periods = data?.periods
  const fiscalYears = data?.fiscalYears
  const fiscalStartMonth = data?.fiscalStartMonth ?? 1

  // 归一化：未选/失效财年 → 最新财年（与历史 header 行为一致）
  useEffect(() => {
    if (!fiscalYears || fiscalYears.length === 0) return
    if (!fiscalYear || !fiscalYears.includes(fiscalYear)) {
      setFiscalYear(fiscalYears[0])
    }
  }, [fiscalYears, fiscalYear, setFiscalYear])

  // 当前财年下的可选月份
  const monthsInFY = useMemo(
    () => (periods ? filterPeriodsByFiscalYear(periods, fiscalYear, fiscalStartMonth) : []),
    [periods, fiscalYear, fiscalStartMonth],
  )

  // 财年切换：若当前 period 不在新财年候选内，自动回退到新财年最新月份（periods 升序，取末位）
  // 关键：available-periods 加载中（isPending）不得触碰 period——否则会把 persist 恢复的
  // 期间在数据到达前清空，刷新后表现为「期间被重置为最新」（全局唯一期间源下必须防护）。
  useEffect(() => {
    if (isPending) return
    if (monthsInFY.length === 0) {
      if (period !== null) setPeriod(null)
      return
    }
    if (!period || !monthsInFY.includes(period)) {
      setPeriod(monthsInFY[monthsInFY.length - 1])
    }
  }, [isPending, monthsInFY, period, setPeriod])

  const display = formatPillLabel(fiscalYear, period)

  if (!fiscalYears || fiscalYears.length === 0) {
    return isPending ? (
      <div className="h-8 w-[160px] animate-pulse rounded-md bg-muted" />
    ) : isError ? (
      <span className="text-sm text-muted-foreground" title="期间加载失败">期间加载失败</span>
    ) : (
      <span className="text-sm text-muted-foreground" title="导入并激活经营数据后，可切换期间">暂无经营数据</span>
    )
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="选择期间"
          title={`当前期间：${display}`}
          className={cn(
            'inline-flex h-8 items-center gap-2 rounded-md border border-border/60 bg-muted/50 px-3 text-sm text-foreground transition-colors',
            'hover:bg-muted',
          )}
        >
          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium tabular-nums">{display}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-[280px] p-3">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">财年</label>
            <Select value={fiscalYear ?? ''} onValueChange={(v) => setFiscalYear(v)}>
              <SelectTrigger className="h-8 w-full text-sm" title="财年">
                <SelectValue placeholder="选择财年" />
              </SelectTrigger>
              <SelectContent>
                {fiscalYears.map((fy) => (
                  <SelectItem key={fy} value={fy}>
                    {fy}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">月份</label>
            <Select
              value={period ?? ''}
              onValueChange={(v) => setPeriod(v)}
              disabled={monthsInFY.length === 0}
            >
              <SelectTrigger className="h-8 w-full text-sm" title="月份">
                <SelectValue placeholder="选择月份" />
              </SelectTrigger>
              <SelectContent>
                {monthsInFY.map((p) => (
                  <SelectItem key={p} value={p}>
                    {formatMonthLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between border-t border-border/60 pt-2">
            <span className="text-xs text-muted-foreground">影响看板/指标/数据浏览的期间候选</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                if (monthsInFY.length > 0) setPeriod(monthsInFY[monthsInFY.length - 1])
              }}
            >
              最新期间
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** 胶囊显示：FY2026 · 8月 */
function formatPillLabel(fiscalYear: string | null, period: string | null): string {
  const fy = fiscalYear ?? '—'
  const m = period ? formatMonthLabel(period) : '—'
  return `${fy} · ${m}`
}

/** 2026-08 → 8月 */
function formatMonthLabel(period: string): string {
  const m = Number(period.split('-')[1])
  return Number.isFinite(m) ? `${m}月` : period
}
