import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useCompanies, useAggregationMap, useAddAggregationMap, useRemoveAggregationMap } from '@/hooks/api-queries'
import { Plus, Trash2 } from 'lucide-react'
import type { Company, AggregationMap } from '@/types'

interface AggregationMapPanelProps {
  canUpdate?: boolean
}

/**
 * 汇总主体成员维护：选择汇总主体 → 查看/新增/移除其单体成员映射。
 */
export function AggregationMapPanel({ canUpdate = false }: AggregationMapPanelProps) {
  const { data: companiesData } = useCompanies()
  const [summaryCode, setSummaryCode] = useState<string | null>(null)
  const { data: mapData, isLoading } = useAggregationMap(summaryCode)
  const addMap = useAddAggregationMap()
  const removeMap = useRemoveAggregationMap()
  const { confirm, element: confirmElement } = useConfirm()

  const [singleToAdd, setSingleToAdd] = useState('')
  const [elimination, setElimination] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const companies = useMemo(() => (companiesData ?? []) as Company[], [companiesData])
  const summaryCompanies = useMemo(() => companies.filter((c) => c.type === 'summary'), [companies])
  const singleCompanies = useMemo(() => companies.filter((c) => c.type === 'entity'), [companies])

  const rows = useMemo(() => (mapData ?? []) as AggregationMap[], [mapData])
  const memberCodes = useMemo(() => new Set(rows.map((r) => r.singleCompanyCode)), [rows])
  const addableSingles = useMemo(() => singleCompanies.filter((c) => !memberCodes.has(c.code)), [singleCompanies, memberCodes])

  const handleAdd = async () => {
    if (!summaryCode || !singleToAdd) return
    setError(null)
    try {
      await addMap.mutateAsync({ summaryCompanyCode: summaryCode, singleCompanyCode: singleToAdd, isInternalElimination: elimination })
      setSingleToAdd('')
      setElimination(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '新增成员失败')
    }
  }

  const handleRemove = async (row: AggregationMap) => {
    if (!(await confirm({ title: '移除成员', description: `确认将「${row.singleCompanyName}」从「${row.summaryCompanyName}」移除？`, danger: true, confirmText: '移除' }))) return
    setError(null)
    try {
      await removeMap.mutateAsync(row.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : '移除失败')
    }
  }

  const columns: DataTableColumn<AggregationMap>[] = [
    { key: 'singleCompanyCode', header: '单体编码', cellClassName: 'font-mono text-muted-foreground' },
    { key: 'singleCompanyName', header: '单体公司', cellClassName: 'font-medium' },
    {
      key: 'isInternalElimination', header: '内部抵消',
      render: (r) => (r.isInternalElimination ? <Badge variant="warning">抵消</Badge> : <span className="text-muted-foreground">—</span>),
    },
    ...(canUpdate
      ? [{
          key: 'actions', header: '操作', align: 'right' as const,
          render: (r: AggregationMap) => (
            <div className="flex items-center justify-end gap-1">
              <Button variant="ghost" size="sm" onClick={() => handleRemove(r)}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ),
        }]
      : []),
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:space-x-2 sm:space-y-0">
        <span className="text-sm font-medium">汇总主体:</span>
        <Select value={summaryCode ?? ''} onValueChange={(v) => setSummaryCode(v)}>
          <SelectTrigger className="w-full sm:w-[240px]">
            <SelectValue placeholder="选择汇总主体查看成员" />
          </SelectTrigger>
          <SelectContent>
            {summaryCompanies.map((c) => (
              <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!summaryCode ? (
        <p className="py-8 text-center text-sm text-muted-foreground">请选择汇总主体以维护其单体成员</p>
      ) : (
        <>
          {canUpdate && (
            <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3 sm:flex-row sm:items-center">
              <span className="text-sm font-medium">新增成员:</span>
              <Select value={singleToAdd} onValueChange={setSingleToAdd}>
                <SelectTrigger className="w-full sm:w-[240px]">
                  <SelectValue placeholder="选择单体公司" />
                </SelectTrigger>
                <SelectContent className="max-h-[280px]">
                  {addableSingles.map((c) => (
                    <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={elimination} onChange={(e) => setElimination(e.target.checked)} />
                内部抵消
              </label>
              <Button size="sm" onClick={handleAdd} disabled={addMap.isPending || !singleToAdd}>
                <Plus className="mr-1 h-4 w-4" /> 加入
              </Button>
            </div>
          )}

          <p className="text-xs text-muted-foreground">{isLoading ? '加载中...' : `共 ${rows.length} 个单体成员`}</p>
          {error && <p className="text-xs text-destructive">{error}</p>}

          <DataTable columns={columns} data={rows} rowKey={(r) => r.id} emptyText={isLoading ? '加载中...' : '该汇总主体暂无成员'} />
        </>
      )}
      {confirmElement}
    </div>
  )
}
