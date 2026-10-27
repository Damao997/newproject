import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { formatMoneyWan, formatQuantity } from '@/lib/utils'
import { MagnitudeValue, magnitudeMaximum } from '@/components/ui/magnitude-value'
import { DeltaTag } from '@/components/ui/delta-tag'
import { EmptyState } from '@/components/ui/empty-state'
import type { AnalysisMetricColumn, AnalysisQueryRow, AnalysisColMember } from '@/types'

/**
 * 通用结果表（即席分析）。按后端下发的 `columns[].valueType` 分发渲染：
 *   amount  → formatMoneyWan（零值随其显示 '-'）+ MagnitudeValue 同列绝对量浅色底面
 *   ratio   → 百分数文本（后端已 ×100，1 位小数，防二次 ×100）
 *   quantity→ formatQuantity 千分位整数
 *   null    → 「—」（不适用/无预算）
 *
 * 同比/环比类指标（key 以 yoy/mom 结尾）额外用 DeltaTag 渲染涨跌胶囊（红涨绿跌，国内财报习惯），
 * 入参需除以 100 转回小数比率。
 *
 * 矩阵模式（colMembers 存在，v2）：列方向按「列成员 × 指标」二维展开，
 * 末尾固定一列「小计」（= 后端 __total，即该行全切片口径，与 v1 单轴结果一致）。
 * 比率类指标（如毛利率）的逐列值是各成员独立重算值，只能横向对比、不可相加 ——
 * 因此小计列取后端合并口径重算值而非逐列求和（前端任何位置都不做列方向求和）。
 */

/** 涨跌类指标：用 DeltaTag 渲染（后端吐 ×100 百分数，需 /100 转小数） */
function isChangeMetric(key: string): boolean {
  return /yoy$|mom$/i.test(key)
}

function CellValue({ column, value, maximum }: { column: AnalysisMetricColumn; value: number | null; maximum: number }) {
  if (value == null) return <span className="text-muted-foreground">—</span>
  if (column.valueType === 'quantity') return formatQuantity(value)
  if (column.valueType === 'ratio') {
    if (isChangeMetric(column.key)) return <DeltaTag value={value / 100} />
    return `${value.toFixed(1)}%`
  }
  return (
    <MagnitudeValue value={value} maximum={maximum}>
      {formatMoneyWan(value)}
    </MagnitudeValue>
  )
}

const TOTAL_COL = '__total'

export function ResultTable({
  columns,
  rows,
  totals,
  totalsLabel = '合计',
  emptyHint,
  colMembers,
}: {
  columns: AnalysisMetricColumn[]
  rows: AnalysisQueryRow[]
  totals?: { values: Record<string, number | null> }
  totalsLabel?: string
  emptyHint?: string
  /** 矩阵模式列成员（含末尾追加的 __total 小计列） */
  colMembers?: AnalysisColMember[]
}) {
  // 多指标组维度（product/category/company）时按 columns[].group 渲染二级表头；单组维度只一行表头
  const grouped = columns.some((c) => c.group)
  const groupSpans = columns.reduce<{ label: string; span: number }[]>((acc, c) => {
    const last = acc.at(-1)
    if (last && last.label === (c.group ?? '')) last.span += 1
    else acc.push({ label: c.group ?? '', span: 1 })
    return acc
  }, [])

  // 每列一个绝对量基准：同列按相对最大值的比例着色，跨列/跨成员不可比，逐列独立计算
  const maximums = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of columns) {
      const vals: (number | null)[] = []
      if (colMembers) {
        for (const r of rows) {
          for (const m of colMembers) {
            vals.push(m.code === TOTAL_COL ? r.values[c.key] : r.cells?.[m.code]?.[c.key] ?? null)
          }
        }
        if (totals) vals.push(totals.values[c.key] ?? null)
      } else {
        for (const r of rows) vals.push(r.values[c.key])
        if (totals) vals.push(totals.values[c.key] ?? null)
      }
      map.set(c.key, magnitudeMaximum(vals))
    }
    return map
  }, [columns, rows, colMembers, totals])

  const headerCells = columns.map((c) => (
    <th key={c.key} scope="col" title={c.tip}
      className={cn(
        'whitespace-nowrap border-b border-l px-3 py-2 text-right font-medium',
        c.valueType === 'ratio' ? 'text-muted-foreground' : 'text-foreground',
      )}>
      {c.header}
    </th>
  ))

  if (rows.length === 0) {
    return <EmptyState compact title="暂无数据" description={emptyHint ?? '调整行维度、指标列或期间后再试'} />
  }

  // 矩阵模式：列 = 列成员（+ 末尾 __total 小计）× 指标
  const memberCols: { code: string; name: string }[] = colMembers
    ? [...colMembers, { code: TOTAL_COL, name: '小计' }]
    : []
  const cellOf = (row: AnalysisQueryRow, memberCode: string, key: string): number | null =>
    memberCode === TOTAL_COL ? row.values[key] ?? null : row.cells?.[memberCode]?.[key] ?? null

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-full border-collapse text-sm">
        <thead>
          {colMembers ? (
            <>
              <tr>
                <th rowSpan={grouped ? 3 : 2} scope="col"
                  className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium text-muted-foreground">行</th>
                {memberCols.map((m) => (
                  <th key={m.code} colSpan={columns.length} rowSpan={grouped ? 2 : 1} scope="colgroup"
                    className={cn(
                      'whitespace-nowrap border-b border-l px-3 py-1.5 text-center text-xs font-medium',
                      m.code === TOTAL_COL ? 'bg-muted/40 text-foreground' : 'text-muted-foreground',
                    )}>
                    {m.name}
                  </th>
                ))}
              </tr>
              {grouped && (
                <tr>
                  {memberCols.flatMap((m) =>
                    groupSpans.map((g, i) => (
                      <th key={`${m.code}-${g.label}-${i}`} colSpan={g.span} scope="colgroup"
                        className="border-b border-l px-3 py-1 text-center text-xs font-normal text-muted-foreground">
                        {g.label}
                      </th>
                    )),
                  )}
                </tr>
              )}
              <tr>
                {memberCols.flatMap((m) =>
                  columns.map((c) => (
                    <th key={`${m.code}-${c.key}`} scope="col" title={c.tip}
                      className={cn(
                        'whitespace-nowrap border-b border-l px-3 py-2 text-right font-medium',
                        c.valueType === 'ratio' ? 'text-muted-foreground' : 'text-foreground',
                        m.code === TOTAL_COL && 'bg-muted/40',
                      )}>
                      {c.header}
                    </th>
                  )),
                )}
              </tr>
            </>
          ) : grouped ? (
            <>
              <tr>
                <th rowSpan={2} scope="col"
                  className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium text-muted-foreground">行</th>
                {groupSpans.map((g, i) => (
                  <th key={`${g.label}-${i}`} colSpan={g.span}
                    className="border-b border-l px-3 py-1.5 text-center text-xs font-medium text-muted-foreground">
                    {g.label}
                  </th>
                ))}
              </tr>
              <tr>{headerCells}</tr>
            </>
          ) : (
            <tr>
              <th scope="col"
                className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium text-muted-foreground">行</th>
              {headerCells}
            </tr>
          )}
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.code}:${row.name}`} className="border-b last:border-b-0 hover:bg-muted/40">
              <th scope="row" className={cn('sticky left-0 z-10 bg-card px-3 py-2 text-left font-normal whitespace-nowrap', row.isTotal && 'font-medium')}
                style={{ paddingLeft: row.level > 0 ? `${12 + row.level * 16}px` : undefined }}>
                {row.isTotal ? totalsLabel : row.name}
              </th>
              {colMembers
                ? memberCols.flatMap((m) =>
                    columns.map((c) => (
                      <td key={`${m.code}-${c.key}`}
                        className={cn('px-3 py-2 text-right font-num tabular-nums', m.code === TOTAL_COL && 'bg-muted/20')}>
                        <CellValue column={c} value={cellOf(row, m.code, c.key)} maximum={maximums.get(c.key) ?? 0} />
                      </td>
                    )),
                  )
                : columns.map((c) => (
                    <td key={c.key} className="px-3 py-2 text-right font-num tabular-nums">
                      <CellValue column={c} value={row.values[c.key] ?? null} maximum={maximums.get(c.key) ?? 0} />
                    </td>
                  ))}
            </tr>
          ))}
        </tbody>
        {/* 总计行只渲染单轴模式：矩阵模式后端只给全量 totals，逐成员总计无数据支撑
            （行级全口径已由每行末尾「小计」列给出） */}
        {totals && !colMembers && (
          <tfoot>
            <tr className="border-t-2 bg-muted/30 font-medium">
              <th scope="row" className="sticky left-0 z-10 bg-muted/30 px-3 py-2 text-left">{totalsLabel}</th>
              {colMembers
                ? memberCols.flatMap((m) =>
                    columns.map((c) => (
                      <td key={`${m.code}-${c.key}`} className="px-3 py-2 text-right font-num tabular-nums">
                        <CellValue column={c} value={totals.values[c.key] ?? null} maximum={maximums.get(c.key) ?? 0} />
                      </td>
                    )),
                  )
                : columns.map((c) => (
                    <td key={c.key} className="px-3 py-2 text-right font-num tabular-nums">
                      <CellValue column={c} value={totals.values[c.key] ?? null} maximum={maximums.get(c.key) ?? 0} />
                    </td>
                  ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
