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
import { FlashMessage } from '@/components/ui/flash-message'
import { Collapsible } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { TRANSACTION_DETAIL_TABS } from '@/components/layout/module-tabs'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { useExclusiveCompanyFilter } from '@/hooks/use-exclusive-company-filter'
import { TABLE_HEADER_STICKY } from '@/components/data-table/styles'
import { useTransactionAging, useTransactionPeriods, useCompanies, useAvailablePeriods } from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { usePageStore } from '@/stores/pageStateStore'
import { usePeriodStore, filterPeriodsByFiscalYear } from '@/stores/periodStore'
import { CompanyMultiSelect } from '@/components/filters/company-select'
import { usePermission } from '@/hooks/usePermission'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Download, FileText, Eye, ChevronDown, ChevronUp, MoreHorizontal, ArrowLeft } from 'lucide-react'
import { TransactionAnalysisDrawer, type TransactionAnalysisTarget } from './analysis-drawer'
import { AccountMultiSelect, PartyTypeSelect, PartyTypeTag, AGING_GROUPS, TRANSACTION_TYPES, buildDetailSummary, useDefaultCompanyCode } from './shared'
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
  // 从往来总览卡片钻取进入时显示「返回总览」按钮（sessionStorage 标记，点击返回或重新跳转时更新；刷新后仍保留）
  const [fromOverview] = useState(() => sessionStorage.getItem('transactions.aging.fromOverview') === '1')
  const handleBackToOverview = useCallback(() => {
    sessionStorage.removeItem('transactions.aging.fromOverview')
    navigate('/transactions/overview')
  }, [navigate])
  // 吸顶测量：标题区 + 筛选卡高度实时测量，驱动筛选卡/表格容器吸顶偏移
  const { headerRef, filterRef, headerHeight, filterHeight } = useStickyHeader()
  const stickyTop = headerHeight + filterHeight
  // 抽屉目标为瞬时状态
  const [analysisTarget, setAnalysisTarget] = useState<TransactionAnalysisTarget | null>(null)
  // 筛选与分组持久化到 pageStateStore（切路由/刷新后恢复）
  const setTransactionsTab = usePageStore((s) => s.setTransactionsTab)
  // 公司多选（空数组 = 全部公司），默认浙江省公司汇总（ET0001，后端按汇总映射展开为成员合并口径）
  const selectedCompanies = usePageStore((s) => s.transactions.aging.companies)
  const defaultCode = useDefaultCompanyCode()
  const setCompanyFilter = useCallback((v: string[]) => setTransactionsTab('aging', { companies: v }), [setTransactionsTab])
  const setPeriodFilter = useCallback((v: string) => setTransactionsTab('aging', { period: v }), [setTransactionsTab])
  const setTypeFilter = useCallback((v: string) => setTransactionsTab('aging', { type: v }), [setTransactionsTab])
  const setAccountFilter = useCallback((v: string[]) => setTransactionsTab('aging', { accounts: v }), [setTransactionsTab])
  const setPartyFilter = useCallback((v: string[]) => setTransactionsTab('aging', { party: v }), [setTransactionsTab])
  const keyword = usePageStore((s) => s.transactions.aging.keyword)
  const setKeyword = useCallback((v: string) => setTransactionsTab('aging', { keyword: v }), [setTransactionsTab])
  const setGroupBy = useCallback((v: string) => setTransactionsTab('aging', { groupBy: v }), [setTransactionsTab])
  const subtotalOnly = usePageStore((s) => s.transactions.aging.subtotalOnly)
  const setSubtotalOnly = useCallback((v: boolean) => setTransactionsTab('aging', { subtotalOnly: v }), [setTransactionsTab])
  // 导出状态：exporting 期间显示生成/下载进度（响应头未达时 total 为 undefined，仅显示"生成中…"）
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  // 导出结果轻提示：替代原生 window.alert（失败展示错误信息；成功分支暂无 flash 需求，预留 success 类型）
  const [exportFlash, setExportFlash] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  // 明细筛选折叠：本地 state 默认折叠（全尺寸），行 1「展开/收起筛选条件」按钮控制；不写 pageStateStore
  const DETAIL_QUERY = '(min-width: 1024px)'
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(DETAIL_QUERY).matches,
  )
  const [detailOpen, setDetailOpen] = useState(false)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(DETAIL_QUERY)
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  // 持久化公司多选校验：编码已删除/越权时过滤，全部失效则回退默认主体（候选加载后生效，用户手动切换后不再覆盖）
  const { data: companies } = useCompanies()
  // 主体互斥业务规则：单体公司与汇总主体不能同时筛选；逻辑与轻提示收敛于共享 hook
  const { handleCompaniesChange, noticeElement } = useExclusiveCompanyFilter({
    companies,
    getPrev: () => usePageStore.getState().transactions.aging.companies,
    setSelected: setCompanyFilter,
  })
  useEffect(() => {
    if (!companies || companies.length === 0) return
    const valid = new Set(companies.map((c) => c.code))
    const cur = usePageStore.getState().transactions.aging.companies
    if (cur.length === 0) return
    const filtered = cur.filter((c) => valid.has(c))
    if (filtered.length > 0) {
      if (filtered.length !== cur.length) setCompanyFilter(filtered)
    } else if (defaultCode) {
      setCompanyFilter([defaultCode])
    }
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
    companyCode: selectedCompanies.length ? selectedCompanies.join(',') : undefined,
    transactionType: typeFilter || undefined,
    groupBy: effectiveGroupBy,
    period,
    accountCodes: accountFilter.length ? accountFilter.join(',') : undefined,
    partyType: partyFilter.length ? partyFilter.join(',') : undefined,
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
  // 明细筛选生效条件摘要（折叠 trigger 展示）
  const detailSummary = buildDetailSummary(accountFilter, partyFilter, keyword, subtotalOnly)

  // 撰写单项分析：以当前筛选快照为分析目标（平铺按钮与操作下拉共用）
  const openAnalysis = useCallback(() => {
    setAnalysisTarget({
      transactionType: typeFilter || '',
      period: period as string,
      defaultCompanyCode: selectedCompanies.length === 1 ? selectedCompanies[0] : undefined,
    })
  }, [setAnalysisTarget, typeFilter, period, selectedCompanies])

  // Excel 导出：参数与当前表格查询一致（含小计开关），服务端生成（transactions:export 权限 + 审计）
  const handleExport = async () => {
    if (!period || exporting) return
    setExporting(true)
    setExportProgress(0)
    try {
      // 每次导出开始时清除上一次的结果（成功/失败均不残留；null 时 no-op）
      setExportFlash(null)
      const blob = await api.exportTransactionAging({
        companyCode: selectedCompanies.length ? selectedCompanies.join(',') : undefined,
        transactionType: typeFilter || undefined,
        groupBy: effectiveGroupBy,
        period,
        accountCodes: accountFilter.length ? accountFilter.join(',') : undefined,
        partyType: partyFilter.length ? partyFilter.join(',') : undefined,
        counterpartyKeyword: keyword || undefined,
        subtotalOnly,
      }, setExportProgress)
      // 按需加载 file-saver，避免进入首屏 chunk
      const { saveAs } = await import('file-saver')
      saveAs(blob, `账龄分析_${period}.xlsx`)
    } catch (e) {
      setExportFlash({ type: 'error', text: (e as Error).message || '导出失败，请稍后重试' })
    } finally {
      setExporting(false)
    }
  }

  // 小计/合计行标签列合并数：公司+往来类型(+往来对象/科目列)
  const labelColSpan = 2 + (effectiveGroupBy === 'counterparty' || effectiveGroupBy === 'account' ? 1 : 0)

  return (
    <PageContainer
      title={(
        <span className="flex items-center gap-1">
          {fromOverview && (
            <Button variant="ghost" size="icon" className="-ml-2 h-8 w-8" onClick={handleBackToOverview} aria-label="返回总览">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          账龄分析
        </span>
      )}
      className="flex h-[calc(100dvh-104px)] flex-col lg:h-[calc(100dvh-112px)]"
      // 视口撑满布局（对齐财务指标页）：main 可视高 = 100dvh - Header(56px) - main pt-6(24px) - pb-6(24px)；
      // lg 断点 pb-8=32px → 112px。页面恒一屏、无全局滚动条，表格高度由 flex 链撑满；
      // 104/112 需与 main-layout.tsx 的 Header 高与 pt/pb 同步
      stickyHeader headerRef={headerRef}>
      {/* 页内 Tab：账龄分析（默认）/ 科目过滤 / 催收计划 */}
      <SubPageTabs items={TRANSACTION_DETAIL_TABS} />
      <div className="flex min-h-0 flex-1 flex-col space-y-4">
        {/* 筛选卡：公司 / 期间 / 类型 / 科目 / 客商 / 分组 / 导出（吸顶） */}
        <Card ref={filterRef} className="sticky z-10 shrink-0 rounded-card p-4" style={{ top: headerHeight }}>
        {/* 行 1：核心筛选 + 高频操作（flex-nowrap 强制单行：小屏时下拉收缩省略号，按钮组恒完整） */}
        <div className="flex flex-nowrap items-center gap-2">
          <CompanyMultiSelect value={selectedCompanies} onChange={handleCompaniesChange} selectAllType="entity" className="w-[150px]" />
          <Select value={period ?? ''} onValueChange={setPeriodFilter}>
            {/* 期间 YYYY-MM 共 7 字符（约 54px 文本 + 24px 内边距 + 16px 箭头） */}
            <SelectTrigger className="w-[94px] min-w-0">
              <SelectValue placeholder="期间" />
            </SelectTrigger>
            <SelectContent>
              {(periods || []).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v === 'all' ? '' : v); setAccountFilter([]) }}>
            {/* 宽度刚好容纳最长选项「其他应收款」等 5 字（70px 文本 + 24px 内边距 + 16px 箭头） */}
            <SelectTrigger className="w-[110px] min-w-0">
              <SelectValue placeholder="往来类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              {TRANSACTION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={groupBy} onValueChange={(v) => { setGroupBy(v); if (v !== 'counterparty') setKeyword('') }}>
            {/* 选项已精简为 3 字，宽度随之收窄（42px 文本 + 24px 内边距 + 16px 箭头） */}
            <SelectTrigger className="w-[84px] min-w-0">
              <SelectValue placeholder="分组方式" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="type">按类型</SelectItem>
              <SelectItem value="counterparty">按对象</SelectItem>
            </SelectContent>
          </Select>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {/* 明细筛选折叠开关：全尺寸默认折叠，点击切换；<640px 纵向两行（图标在上文字在下）保持触达性 */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDetailOpen((o) => !o)}
              aria-expanded={detailOpen}
              className="h-auto flex-col gap-0.5 px-2 text-muted-foreground hover:text-foreground sm:flex-row sm:gap-1"
            >
              {detailOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              <span>{detailOpen ? '收起筛选条件' : '展开筛选条件'}</span>
            </Button>
            {/* ≥lg 三按钮平铺；<lg 收缩为「操作」下拉，节省筛选条宽度 */}
            {isDesktop ? (
              <>
                {can('reports', 'create') && (
                  <Button size="sm" disabled={!period} onClick={openAnalysis}>
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
                {can('transactions', 'export') && (
                  <Button variant="outline" size="sm" disabled={!period || exporting} onClick={handleExport}>
                    <Download className="mr-1 h-4 w-4" />
                    {exporting ? (exportProgress > 0 ? `导出中 ${exportProgress}%` : '生成中…') : '导出 Excel'}
                  </Button>
                )}
              </>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <MoreHorizontal className="mr-1 h-4 w-4" /> 操作
                    <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {can('reports', 'create') && (
                    <DropdownMenuItem disabled={!period} onSelect={openAnalysis}>
                      <FileText className="mr-2 h-4 w-4" /> 撰写单项分析
                    </DropdownMenuItem>
                  )}
                  {can('reports', 'view') && (
                    <DropdownMenuItem onSelect={() => navigate('/reports/analyses')}>
                      <Eye className="mr-2 h-4 w-4" /> 查看分析
                    </DropdownMenuItem>
                  )}
                  {can('transactions', 'export') && (
                    <DropdownMenuItem disabled={!period || exporting} onSelect={handleExport}>
                      <Download className="mr-2 h-4 w-4" />
                      {exporting ? (exportProgress > 0 ? `导出中 ${exportProgress}%` : '生成中…') : '导出 Excel'}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
        {/* 行 2：明细筛选（科目/客商/关键词/仅小计），默认折叠，由行 1 按钮控制显隐 */}
        <Collapsible open={detailOpen} onOpenChange={setDetailOpen}>
          <div className="mt-1 flex flex-wrap items-center gap-3 border-t border-dashed border-border pt-1">
            <AccountMultiSelect value={accountFilter} onChange={(v) => { setAccountFilter(v); if (v.length > 0) setKeyword('') }} transactionType={typeFilter || undefined} />
            <PartyTypeSelect value={partyFilter} onChange={setPartyFilter} />
            {/* 搜索框仅在按往来对象分组时展示（按科目展开时无往来对象列，避免隐藏筛选残留） */}
            {effectiveGroupBy === 'counterparty' && (
              <Input
                placeholder="搜索往来对象..."
                className="w-full sm:w-[200px]"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            )}
            <div className="flex items-center gap-2">
              <Switch id="aging-subtotal-only" checked={subtotalOnly} onCheckedChange={setSubtotalOnly} disabled={rows.length === 0} />
              <span className="cursor-pointer text-xs text-muted-foreground select-none" onClick={() => setSubtotalOnly(!subtotalOnly)}>仅显示小计</span>
            </div>
          </div>
        </Collapsible>
        {/* 折叠态摘要：生效条件一瞥（科目/客商/关键词/仅小计），无前缀文字 */}
        {!detailOpen && detailSummary.length > 0 && (
          <p className="mt-2 truncate text-xs text-muted-foreground">{detailSummary.join(' · ')}</p>
        )}
        {noticeElement}
        {exportFlash && (
          <FlashMessage type={exportFlash.type} className="mt-2 max-w-xl truncate">{exportFlash.text}</FlashMessage>
        )}
        </Card>

        {/* 仅显示小计提示：明细行数仍参与小计/合计聚合，仅隐藏展示 */}
        {subtotalOnly && hiddenDetailCount > 0 && (
          <p className="shrink-0 text-xs text-muted-foreground">已隐藏 {hiddenDetailCount} 条明细，仅显示小计/合计</p>
        )}

        {/* 表格卡：账龄明细（含小计/合计行，表格容器吸顶） */}
        <Card className="flex min-h-0 flex-1 flex-col rounded-card border border-border">
          <div className="flex min-h-0 flex-1 flex-col pt-4">
            {isLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>
            ) : rows.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无数据</div>
            ) : (
              <div
                className="sticky min-h-0 flex-1 overflow-auto rounded-card bg-background"
                style={{ top: stickyTop, maxHeight: `calc(100dvh - ${stickyTop}px - 24px)` }}
              >
                <table className="w-full text-sm" style={{ minWidth: 1240 }}>
                  <thead>
                    <tr className={cn('border-b bg-muted text-center text-foreground', TABLE_HEADER_STICKY)}>
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
