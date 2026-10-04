import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { AnalysisSection, AnalysisComparison, AnalysisFailure } from '@/components/analysis/workspace'
import { useAnalysisWorkspace } from '@/components/analysis/analysis-context'
import { StatTile } from '@/components/ui/stat-tile'
import { MagnitudeValue, magnitudeMaximum } from '@/components/ui/magnitude-value'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { AnalysisPageSkeleton } from '@/components/ui/skeleton-blocks'
import { DeltaTag } from '@/components/ui/delta-tag'
import { useInventoryOverview, useInventoryDetails } from '@/hooks/api-queries'
import { formatMoneyWan } from '@/lib/utils'

export function InventoryAgingContent({ period, companyCode }: { period?: string; companyCode?: string }) {
  const workspace = useAnalysisWorkspace(), companyCodes = companyCode ? [companyCode] : undefined
  const overview = useInventoryOverview({ period, companyCodes }), details = useInventoryDetails({ period, companyCodes })
  const data = overview.isPlaceholderData ? undefined : overview.data
  const detailRows = useMemo(() => details.isPlaceholderData ? [] : details.data?.rows ?? [], [details.data, details.isPlaceholderData])
  const visibleRows = workspace?.state.view === 'focus' && workspace.state.selected ? detailRows.filter(row => row.categoryCode === workspace.state.selected) : detailRows
  const amountMaximum = { current: magnitudeMaximum(detailRows.map(row => row.current)), yearStart: magnitudeMaximum(detailRows.map(row => row.yearStart)), samePeriod: magnitudeMaximum(detailRows.map(row => row.samePeriod)) }
  const totalYoy = data?.total.samePeriod ? (data.total.current - data.total.samePeriod) / Math.abs(data.total.samePeriod) : 0
  const report = <>      {/* 公司 × 品类 明细表 */}



          {details.isPending || details.isPlaceholderData ? <AnalysisPageSkeleton blocks={[260]} /> : details.isError && !details.data ? <AnalysisFailure title="公司品类明细加载失败" retry={details.refetch} /> : visibleRows.length === 0 ? (
            <EmptyState compact className="py-10" title="暂无明细数据" />
          ) : (
            <div className="detail-table-scroll max-h-[480px] overflow-auto">
              <table data-ui-table data-detail-table data-comparison-matrix aria-label="公司与品类库存明细，单位万元" className="data-table-report data-table-report--striped">
                <thead className="sticky top-0 z-[1] bg-ink-2">
                  <tr>
                    <th className="text-left">公司</th>
                    <th className="text-left">品类</th>
                    <th className="text-right">本期</th>
                    <th className="text-right">年初</th>
                    <th className="text-right">同期</th>
                    <th className="text-right">同比</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((r) => (
                      <tr key={`${r.companyCode}-${r.categoryCode}`}>
                        <td className="max-w-[12em] truncate text-left text-body text-foreground" title={r.companyName}>
                          {r.companyShortName ?? r.companyName}
                        </td>
                        <td className="text-left text-body text-foreground">{r.categoryName}</td>
                        <td className="text-right font-num text-sm text-foreground"><MagnitudeValue value={r.current} maximum={amountMaximum.current}>{formatMoneyWan(r.current)}</MagnitudeValue></td>
                        <td className="text-right font-num text-sm text-muted-foreground"><MagnitudeValue value={r.yearStart} maximum={amountMaximum.yearStart}>{formatMoneyWan(r.yearStart)}</MagnitudeValue></td>
                        <td className="text-right font-num text-sm text-muted-foreground"><MagnitudeValue value={r.samePeriod} maximum={amountMaximum.samePeriod}>{formatMoneyWan(r.samePeriod)}</MagnitudeValue></td>
                        {/* 库存接口 yoy 为百分数（×100），转小数传入 */}
                        <td className="text-right"><DeltaTag value={r.yoy / 100} /></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}


</>
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-muted-foreground">来源：静态报表与库存明细 · 库存结构及周转口径</p><Button asChild variant="outline" size="sm"><Link to="/inventory">前往库存管理</Link></Button></div>
    {details.isError && details.data && <AnalysisFailure title="明细刷新失败，保留当前内容" retry={details.refetch} />}
    <AnalysisSection kind="focus">
      {overview.isPending || overview.isPlaceholderData ? <AnalysisPageSkeleton blocks={[160, 320]} /> : overview.isError && !data ? <AnalysisFailure title="库存概览加载失败" retry={overview.refetch} /> : !data || (!data.categories.length && !data.total.current) ? <EmptyState title="暂无存货概览" description="请检查静态报表数据" /> : <>
        {overview.isError && <AnalysisFailure title="库存概览刷新失败，保留当前内容" retry={overview.refetch} />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="库存金额" value={formatMoneyWan(data.total.current)} unit="万" tone={1} foot={<span>同比 <DeltaTag value={totalYoy} /></span>} />
          <StatTile label="存货周转天数" value={data.turnoverDays.current > 0 ? String(Math.round(data.turnoverDays.current)) : '—'} unit={data.turnoverDays.current > 0 ? '天' : undefined} tone={2} foot={data.turnoverDays.samePeriod > 0 ? '同期 ' + Math.round(data.turnoverDays.samePeriod) + ' 天' : '暂无同期数据'} />
          <StatTile label="覆盖公司" value={String(data.companyCount)} unit="家" tone={3} foot="当前主体范围" />
          <StatTile label="库存品类" value={String(data.categories.length)} unit="类" tone={4} foot="点击品类联动公司明细" />
        </div>
        <AnalysisComparison title="库存品类比较" note="本期 · 单位：万元 · 选择品类后，下方公司明细同步筛选" items={data.categories.map(category => ({ id: category.code, label: category.name, amount: category.current, share: category.share, detail: <p>占比 {category.share.toFixed(1)}% · 同比 <DeltaTag value={category.yoy / 100} /></p> }))} />
      </>}
      {workspace?.state.selected && <p role="status" className="text-sm text-muted-foreground">局部范围：{data?.categories.find(category => category.code === workspace.state.selected)?.name ?? workspace.state.selected} · <Button size="sm" variant="ghost" onClick={() => workspace.update({ selected: '' })}>显示全部品类</Button></p>}
      {report}
    </AnalysisSection>
    <AnalysisSection kind="report">{report}</AnalysisSection>
  </div>
}
