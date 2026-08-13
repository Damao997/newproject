import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { PageContainer } from '@/components/layout/page-container'
import { useTransactionAging, useTransactionPeriods, useCompanies, useAvailablePeriods } from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { usePageStore } from '@/stores/pageStateStore'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { CompanySelect } from '@/components/filters/company-select'
import { usePermission } from '@/hooks/usePermission'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Download, FileText, Eye } from 'lucide-react'
import { TransactionAnalysisDrawer, type TransactionAnalysisTarget } from './analysis-drawer'
import { AccountMultiSelect, PartyTypeSelect, PartyTypeTag, AGING_GROUPS, TRANSACTION_TYPES, useDefaultCompanyCode } from './shared'
import type { AgingAnalysisRow } from '@/types'

/** 账龄表渲染行：数据行 / 公司小计行 / 总合计行 */
type AgingRenderRow =
  | { kind: 'data'; row: AgingAnalysisRow }
  | { kind: 'subtotal' | 'total'; label: string; closingBalance: number; aging: Record<string, number> }

/** 账龄列风险底色（浅色，账龄越深越偏红）；0 值不着色 */
const AGING_CELL_BG: Record<string, string> = {
  '1个月': 'bg-success/[0.06]',
  '2个月': 'bg-success/[0.06]',
  '3个月': 'bg-info/[0.06]',
  '4-6月': 'bg-info/[0.06]',
  '半年以上': 'bg-warning/[0.08]',
  '1年至2年': 'bg-warning/[0.08]',
  '2年至3年': 'bg-destructive/[0.06]',
  '3年以上': 'bg-destructive/[0.06]',
}

/**
 * 往来分析 · 账龄分析：按公司分组的多分段账龄矩阵（小计/合计、仅显示小计）、
 * Excel 导出（服务端生成 + 审计）、往来单项分析撰写入口。
 */

export default function TransactionsAgingPage() {
  const { can } = usePermission()
  const navigate = useNavigate()
  // 抽屉目标为瞬时状态
  const [analysisTarget, setAnalysisTarget] = useState<TransactionAnalysisTarget | null>(null)
  // 筛选与分组持久化到 pageStateStore（切路由/刷新后恢复）
  const setTransactionsTab = usePageStore((s) => s.setTransactionsTab)
  // 默认浙江省公司汇总（ET0001，后端按汇总映射展开为成员合并口径）
  const companyFilter = usePageStore((s) => s.transactions.aging.company)
  const defaultCode = useDefaultCompanyCode()
  const setCompanyFilter = useCallback((v: string) => setTransactionsTab('aging', { company: v }), [setTransactionsTab])
  const setPeriodFilter = useCallback((v: string) => setTransactionsTab('aging', { period: v }), [setTransactionsTab])
  const setTypeFilter = useCallback((v: string) => setTransactionsTab('aging', { type: v }), [setTransactionsTab])
  const setAccountFilter = useCallback((v: string[]) => setTransactionsTab('aging', { accounts: v }), [setTransactionsTab])
  const setPartyFilter = useCallback((v: string) => setTransactionsTab('aging', { party: v }), [setTransactionsTab])
  const keyword = usePageStore((s) => s.transactions.aging.keyword)
  const setKeyword = useCallback((v: string) => setTransactionsTab('aging', { keyword: v }), [setTransactionsTab])
  const setGroupBy = useCallback((v: string) => setTransactionsTab('aging', { groupBy: v }), [setTransactionsTab])
  const subtotalOnly = usePageStore((s) => s.transactions.aging.subtotalOnly)
  const setSubtotalOnly = useCallback((v: boolean) => setTransactionsTab('aging', { subtotalOnly: v }), [setTransactionsTab])
  // 导出状态：exporting 期间显示生成/下载进度（响应头未达时 total 为 undefined，仅显示"生成中…"）
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  // 持久化公司校验：编码已删除/越权时回退默认主体（候选加载后生效，用户手动切换后不再覆盖）
  const { data: companies } = useCompanies()
  useEffect(() => {
    if (!companies || companies.length === 0) return
    const valid = new Set(companies.map((c) => c.code))
    const cur = usePageStore.getState().transactions.aging.company
    if (cur !== 'all' && !valid.has(cur)) setCompanyFilter(defaultCode ?? 'all')
  }, [companies, defaultCode, setCompanyFilter])
  // 空串表示跟随最新期间（默认选中最近一期有数据的期间）；期末余额为时点数，不提供跨期累加
  const periodFilter = usePageStore((s) => s.transactions.aging.period)
  // 默认展示「应收账款」往来类型
  const typeFilter = usePageStore((s) => s.transactions.aging.type)
  const accountFilter = usePageStore((s) => s.transactions.aging.accounts)
  const partyFilter = usePageStore((s) => s.transactions.aging.party)
  const groupBy = usePageStore((s) => s.transactions.aging.groupBy)
  // 持久化期间校验：已选期间不在候选（如财年切换）时回退跟随最新
  // 期间候选按全局选中财年过滤（财年起始月取后端返回值，与 dashboard/indicators/data/inventory 口径一致）
  const { data: periodsData } = useAvailablePeriods()
  const fiscalYear = usePeriodStore((s) => s.fiscalYear)
  const { data: rawPeriods } = useTransactionPeriods()
  const periods = useMemo(
    () => filterPeriodsByFiscalYear(rawPeriods ?? [], fiscalYear, periodsData?.fiscalStartMonth ?? 1),
    [rawPeriods, fiscalYear, periodsData?.fiscalStartMonth],
  )
  useEffect(() => {
    const cur = usePageStore.getState().transactions.aging.period
    if (cur !== '' && !periods.includes(cur)) setPeriodFilter('')
  }, [periods, setPeriodFilter])
  const { getDisplayName } = useCompanyDisplayName()
  const period = periodFilter || periods[0]
  // 科目维度统一由「科目筛选」承载：选中具体科目时自动按科目展开（显示科目列），
  // 未选时按分组方式（往来类型/往来对象）汇总，避免与分组下拉中的「按科目」重复
  const effectiveGroupBy = accountFilter.length > 0 ? 'account' : groupBy

  const { data: agingData, isLoading } = useTransactionAging({
    companyCode: companyFilter === 'all' ? undefined : companyFilter,
    transactionType: typeFilter || undefined,
    groupBy: effectiveGroupBy,
    period,
    accountCodes: accountFilter.length ? accountFilter.join(',') : undefined,
    partyType: partyFilter === 'all' ? undefined : partyFilter,
    counterpartyKeyword: keyword || undefined,
  }, { enabled: !!period }) // 等期间确定后再查，避免跨期重复累加的首次查询

  // 后端已固定排除零余额行，此处为展示层防御（过滤后再聚合小计/合计，0 行对金额无贡献）
  const rows = ((agingData || []) as AgingAnalysisRow[]).filter((r) => r.closingBalance !== 0)

  // 按公司分组（公司升序、组内余额降序），逐组插小计行，表尾插合计行
  const renderRows = useMemo<AgingRenderRow[]>(() => {
    const addAging = (acc: Record<string, number>, r: AgingAnalysisRow) => {
      for (const b of AGING_GROUPS) acc[b] = (acc[b] || 0) + (r.aging[b] || 0)
    }
    const byCompany = new Map<string, AgingAnalysisRow[]>()
    for (const r of rows) {
      if (!byCompany.has(r.companyCode)) byCompany.set(r.companyCode, [])
      byCompany.get(r.companyCode)!.push(r)
    }
    const out: AgingRenderRow[] = []
    const grand: { closingBalance: number; aging: Record<string, number> } = { closingBalance: 0, aging: {} }
    for (const key of [...byCompany.keys()].sort()) {
      const group = byCompany.get(key)!.slice().sort((a, b) => b.closingBalance - a.closingBalance)
      const sub: { closingBalance: number; aging: Record<string, number> } = { closingBalance: 0, aging: {} }
      for (const r of group) {
        out.push({ kind: 'data', row: r })
        sub.closingBalance += r.closingBalance
        addAging(sub.aging, r)
      }
      out.push({ kind: 'subtotal', label: `${getDisplayName(group[0].companyCode, group[0].companyName)} 小计`, closingBalance: sub.closingBalance, aging: sub.aging })
      grand.closingBalance += sub.closingBalance
      for (const b of AGING_GROUPS) grand.aging[b] = (grand.aging[b] || 0) + (sub.aging[b] || 0)
    }
    if (out.length > 0) out.push({ kind: 'total', label: '合计', closingBalance: grand.closingBalance, aging: grand.aging })
    return out
  }, [rows, getDisplayName])

  // 仅显示小计：渲染层过滤（renderRows 计算不变，小计/合计由全量数据聚合，不影响数据完整性）
  const visibleRows = subtotalOnly ? renderRows.filter((r) => r.kind !== 'data') : renderRows
  const hiddenDetailCount = renderRows.filter((r) => r.kind === 'data').length

  // Excel 导出：参数与当前表格查询一致（含小计开关），服务端生成（transactions:export 权限 + 审计）
  const handleExport = async () => {
    if (!period || exporting) return
    setExporting(true)
    setExportProgress(0)
    try {
      const blob = await api.exportTransactionAging({
        companyCode: companyFilter === 'all' ? undefined : companyFilter,
        transactionType: typeFilter || undefined,
        groupBy: effectiveGroupBy,
        period,
        accountCodes: accountFilter.length ? accountFilter.join(',') : undefined,
        partyType: partyFilter === 'all' ? undefined : partyFilter,
        counterpartyKeyword: keyword || undefined,
        subtotalOnly,
      }, setExportProgress)
      // 按需加载 file-saver，避免进入首屏 chunk
      const { saveAs } = await import('file-saver')
      saveAs(blob, `账龄分析_${period}.xlsx`)
    } catch (e) {
      window.alert((e as Error).message || '导出失败，请稍后重试')
    } finally {
      setExporting(false)
    }
  }

  // 小计/合计行标签列合并数：公司+往来类型(+往来对象/科目列)
  const labelColSpan = 2 + (effectiveGroupBy === 'counterparty' || effectiveGroupBy === 'account' ? 1 : 0)

  return (
    <PageContainer title="账龄分析">
      <div className="space-y-4">
        {/* 筛选卡：公司 / 期间 / 类型 / 科目 / 客商 / 分组 / 导出 */}
        <Card className="rounded-card p-4">
        {/* 行 1：核心筛选 + 高频操作 */}
        <div className="flex flex-wrap items-center gap-3">
          <CompanySelect value={companyFilter} onChange={setCompanyFilter} />
          <Select value={period ?? ''} onValueChange={setPeriodFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="期间" />
            </SelectTrigger>
            <SelectContent>
              {(periods || []).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v === 'all' ? '' : v); setAccountFilter([]) }}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="往来类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              {TRANSACTION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={groupBy} onValueChange={setGroupBy}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="分组方式" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="type">按往来类型</SelectItem>
              <SelectItem value="counterparty">按往来对象</SelectItem>
            </SelectContent>
          </Select>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {can('transactions', 'export') && (
              <Button variant="outline" size="sm" disabled={!period || exporting} onClick={handleExport}>
                <Download className="mr-1 h-4 w-4" />
                {exporting ? (exportProgress > 0 ? `导出中 ${exportProgress}%` : '生成中…') : '导出 Excel'}
              </Button>
            )}
            {can('reports', 'create') && (
              <Button
                variant="outline"
                size="sm"
                disabled={!period}
                onClick={() => setAnalysisTarget({
                  transactionType: typeFilter || '',
                  period: period as string,
                  defaultCompanyCode: companyFilter !== 'all' ? companyFilter : undefined,
                })}
              >
                <FileText className="mr-1 h-4 w-4" /> 撰写单项分析
              </Button>
            )}
            {can('reports', 'view') && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/reports/analyses')}
              >
                <Eye className="mr-1 h-4 w-4" /> 查看分析
              </Button>
            )}
          </div>
        </div>
        {/* 行 2：明细筛选 */}
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-dashed border-border pt-3">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">明细筛选</span>
          <AccountMultiSelect value={accountFilter} onChange={setAccountFilter} transactionType={typeFilter || undefined} />
          <PartyTypeSelect value={partyFilter} onChange={setPartyFilter} />
          <Input
            placeholder="搜索往来对象..."
            className="w-[200px]"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <Switch id="aging-subtotal-only" checked={subtotalOnly} onCheckedChange={setSubtotalOnly} disabled={rows.length === 0} />
            <span className="cursor-pointer text-xs text-muted-foreground select-none" onClick={() => setSubtotalOnly(!subtotalOnly)}>仅显示小计</span>
          </div>
        </div>
        </Card>

        {/* 仅显示小计提示：明细行数仍参与小计/合计聚合，仅隐藏展示 */}
        {subtotalOnly && hiddenDetailCount > 0 && (
          <p className="text-xs text-muted-foreground">已隐藏 {hiddenDetailCount} 条明细，仅显示小计/合计</p>
        )}

        {/* 表格卡：账龄明细（含小计/合计行） */}
        <Card className="rounded-card overflow-hidden">
          <div className="border-b px-4 py-2.5">
            <p className="text-xs text-muted-foreground">共 {rows.length} 行（含小计/合计）</p>
          </div>
          <div className="pt-4">
            {isLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>
            ) : rows.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无数据</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ minWidth: 1240 }}>
                  <thead>
                    <tr className="border-b bg-muted/50 text-center text-black">
                      <th className="w-[150px] px-2 py-2 font-medium">公司</th>
                      <th className="w-[90px] px-2 py-2 font-medium">往来类型</th>
                      {effectiveGroupBy === 'counterparty' && <th className="min-w-[140px] px-2 py-2 font-medium">往来对象</th>}
                      {effectiveGroupBy === 'account' && <th className="min-w-[140px] px-2 py-2 font-medium">科目</th>}
                      <th className="w-[92px] px-2 py-2 font-medium whitespace-nowrap">期末余额</th>
                      {AGING_GROUPS.map((b) => (
                        <th key={b} className="w-[92px] px-2 py-2 font-medium whitespace-nowrap">{b}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((rr, idx) => {
                      if (rr.kind === 'data') {
                        const row = rr.row
                        return (
                          <tr key={idx} className="border-b last:border-0 hover:bg-muted/50">
                            <td className="max-w-[150px] truncate px-2 py-2 text-xs" title={row.companyName || row.companyCode}>{getDisplayName(row.companyCode, row.companyName)}</td>
                            <td className="px-2 py-2 text-xs whitespace-nowrap">{row.transactionType}</td>
                            {effectiveGroupBy === 'counterparty' && (
                              <td className="max-w-[200px] px-2 py-2 text-xs">
                                <div className="truncate" title={row.counterpartyName || row.counterpartyCode || '-'}>{row.counterpartyName || row.counterpartyCode || '-'}</div>
                                <PartyTypeTag partyType={row.partyType} />
                              </td>
                            )}
                            {effectiveGroupBy === 'account' && <td className="max-w-[200px] truncate px-2 py-2 text-xs" title={row.accountDesc || row.accountCode || '-'}>{row.accountDesc || row.accountCode || '-'}</td>}
                            <td className="px-2 py-2 text-right font-num font-medium whitespace-nowrap">{row.closingBalance.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                            {AGING_GROUPS.map((b) => {
                              const v = row.aging[b] || 0
                              return (
                                <td key={b} className={cn('px-2 py-2 text-right font-num text-xs whitespace-nowrap', v !== 0 && AGING_CELL_BG[b], b === '3年以上' && v !== 0 && 'font-medium text-destructive')}>
                                  {v !== 0 ? v.toLocaleString('zh-CN', { minimumFractionDigits: 2 }) : '-'}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      }
                      // 小计 / 合计行
                      const isTotal = rr.kind === 'total'
                      return (
                        <tr key={idx} className={cn('border-t font-semibold', isTotal ? 'border-t-2 bg-primary/5' : 'bg-muted/50')}>
                          <td className="px-2 py-2 text-xs" colSpan={labelColSpan}>{rr.label}</td>
                          <td className="px-2 py-2 text-right font-num whitespace-nowrap">{rr.closingBalance.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}</td>
                          {AGING_GROUPS.map((b) => (
                            <td key={b} className="px-2 py-2 text-right font-num text-xs whitespace-nowrap">
                              {(rr.aging[b] || 0) !== 0 ? rr.aging[b].toLocaleString('zh-CN', { minimumFractionDigits: 2 }) : '-'}
                            </td>
                          ))}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>

        {/* 往来单项分析抽屉（入口在筛选行按钮） */}
        <TransactionAnalysisDrawer open={analysisTarget !== null} target={analysisTarget} onClose={() => setAnalysisTarget(null)} />
      </div>
    </PageContainer>
  )
}
