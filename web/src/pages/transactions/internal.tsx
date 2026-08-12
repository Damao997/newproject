import { useCallback, useEffect, useMemo } from 'react'
import { PageContainer } from '@/components/layout/page-container'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { useInternalSummary, useInternalMirrorCheck, useCompanies } from '@/hooks/api-queries'
import { usePageStore } from '@/stores/pageStateStore'
import { CompanySelect } from '@/components/filters/company-select'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { Building2, AlertTriangle } from 'lucide-react'
import type { InternalSummaryRow, InternalMirrorRow } from '@/types'

/**
 * 往来分析 · 内部往来：内部往来汇总表 + 双边镜像校验（AR/AP 抵平差异检查）。
 */

export default function TransactionsInternalPage() {
  // 公司筛选持久化到 pageStateStore（切路由/刷新后恢复）
  const setTransactionsTab = usePageStore((s) => s.setTransactionsTab)
  const companyFilter = usePageStore((s) => s.transactions.internal.company)
  const setCompanyFilter = useCallback((v: string) => setTransactionsTab('internal', { company: v }), [setTransactionsTab])
  const { data: companies } = useCompanies()
  // 持久化公司校验：编码已删除/越权时回退全部
  useEffect(() => {
    if (!companies || companies.length === 0) return
    const valid = new Set(companies.map((c) => c.code))
    const cur = usePageStore.getState().transactions.internal.company
    if (cur !== 'all' && !valid.has(cur)) setCompanyFilter('all')
  }, [companies, setCompanyFilter])
  const companyCode = companyFilter === 'all' ? undefined : companyFilter
  const { data: summaryData, isLoading: summaryLoading } = useInternalSummary(companyCode)
  const { data: mirrorData, isLoading: mirrorLoading } = useInternalMirrorCheck(companyCode)

  const summary = (summaryData || []) as InternalSummaryRow[]
  const mirror = (mirrorData || []) as InternalMirrorRow[]

  const summaryColumns: DataTableColumn<InternalSummaryRow>[] = useMemo(() => [
    { key: 'companyCode', header: '本方公司' },
    { key: 'internalPeerCode', header: '内部对方公司' },
    {
      key: 'direction', header: '方向',
      render: (row) => (
        <span className={cn('rounded px-1.5 py-0.5 text-xs', row.direction === 'AR' ? 'bg-info/10 text-info' : 'bg-destructive/10 text-destructive')}>
          {row.direction}
        </span>
      ),
    },
    { key: 'transactionType', header: '往来类型' },
    { key: 'closingBalance', header: '期末余额', align: 'right', cellClassName: 'font-num', render: (row) => row.closingBalance.toLocaleString('zh-CN', { minimumFractionDigits: 2 }) },
    { key: 'recordCount', header: '笔数', align: 'right' },
  ], [])

  const mirrorColumns: DataTableColumn<InternalMirrorRow>[] = useMemo(() => [
    { key: 'companyA', header: '公司A' },
    { key: 'companyB', header: '公司B' },
    { key: 'arAmount', header: 'AR侧合计', align: 'right', cellClassName: 'font-num', render: (row) => row.arAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2 }) },
    { key: 'apAmount', header: 'AP侧合计', align: 'right', cellClassName: 'font-num', render: (row) => row.apAmount.toLocaleString('zh-CN', { minimumFractionDigits: 2 }) },
    {
      key: 'difference', header: '差额(未抵平)', align: 'right', cellClassName: 'font-num font-medium',
      render: (row) => (
        <span className={Math.abs(row.difference) > 0.01 ? 'text-warning-strong' : 'text-success-strong'}>
          {row.difference.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
        </span>
      ),
    },
  ], [])

  return (
    <PageContainer title="内部往来">
      <div className="space-y-6">
        {/* 筛选卡：公司选择 */}
        <Card className="rounded-card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <CompanySelect value={companyFilter} onChange={setCompanyFilter} />
          </div>
        </Card>

        {/* 内部往来汇总（表格卡） */}
        <Card className="rounded-card overflow-hidden">
          <div className="flex items-center gap-2 border-b px-4 py-2.5">
            <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <Building2 className="h-4 w-4" />
              内部往来汇总
            </h3>
          </div>
          <div className="pt-2">
            {summaryLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
            ) : summary.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无内部往来数据</div>
            ) : (
              <div className="px-2 pb-2">
                <DataTable
                  columns={summaryColumns}
                  data={summary}
                  rowKey={(row, idx) => `${row.companyCode}-${row.internalPeerCode}-${idx}`}
                  density="compact"
                  caption="内部往来汇总"
                />
              </div>
            )}
          </div>
        </Card>

        {/* 双边镜像校验（表格卡） */}
        <Card className="rounded-card overflow-hidden">
          <div className="flex items-center gap-2 border-b px-4 py-2.5">
            <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <AlertTriangle className="h-4 w-4" />
              双边镜像校验
            </h3>
          </div>
          <div className="pt-2">
            {mirrorLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">加载中...</div>
            ) : mirror.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无镜像校验数据</div>
            ) : (
              <div className="px-2 pb-2">
                <DataTable
                  columns={mirrorColumns}
                  data={mirror}
                  rowKey={(row, idx) => `${row.companyA}-${row.companyB}-${idx}`}
                  density="compact"
                  caption="双边镜像校验"
                  rowClassName={(row) => (Math.abs(row.difference) > 0.01 ? 'bg-warning/[0.08]' : undefined)}
                />
              </div>
            )}
          </div>
        </Card>
      </div>
    </PageContainer>
  )
}
