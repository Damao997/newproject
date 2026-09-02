import { useCallback, useMemo, useState } from 'react'
import { usePermission } from '@/hooks/usePermission'
import { useImports } from '@/hooks/api-queries'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { useImportFlow } from './use-import-flow'
import { UploadZone } from './import-upload-zone'
import { BatchPanel } from './import-batch-panel'
import { ImportCompareDialog } from './import-compare-dialog'
import { TransactionImportDialog } from './transaction-import-dialog'
import { CoverageTab } from '@/pages/transactions/coverage-tab'
import type { BatchFilterValue } from './batch-filter-bar'
import { ChevronDown, ChevronRight, Grid3X3 } from 'lucide-react'

/**
 * 数据导入 + 导入质量概览合并面板（单卡片上下三分区，紧凑布局）。
 *
 * 分区一（导入，canImport 门禁，UploadZone）：模板选择/下载、拖拽/选择上传、预览校验（dry-run）、确认导入；
 * 分区二（质量概览，始终展示，BatchPanel）：跨批次质量统计、批次选择/激活、批次管理、完整性校验、异常明细，
 * 保留折叠能力并沿用原 localStorage 偏好 key；
 * 分区三（往来导入覆盖，CoverageTab）：往来批次覆盖率矩阵（公司×期间×类型）。
 */
export function ImportPanel() {
  const { can } = usePermission()
  const canImport = can('data:import', 'upload')
  // 高危操作（仅 superadmin 持有对应权限码）
  const canArchive = can('data:import', 'archive')
  const canPurgeBatch = can('data:import', 'purge')
  const canViewTransactions = can('transactions', 'view')

  // 批次筛选状态（'all' 哨兵 = 不过滤；四类条件互不影响，重置仅清空筛选）
  const [batchFilterValue, setBatchFilterValue] = useState<BatchFilterValue>({
    module: 'all', status: 'all', startDate: '', endDate: '',
  })
  const handleBatchFilterChange = useCallback((patch: Partial<BatchFilterValue>) => {
    setBatchFilterValue((prev) => ({ ...prev, ...patch }))
  }, [])
  const resetBatchFilters = useCallback(() => {
    setBatchFilterValue({ module: 'all', status: 'all', startDate: '', endDate: '' })
  }, [])
  // 生效筛选项计数（模块/状态/起止日期），用于筛选状态展示与重置按钮
  const batchActiveCount = useMemo(() => {
    let n = 0
    if (batchFilterValue.module !== 'all') n += 1
    if (batchFilterValue.status !== 'all') n += 1
    if (batchFilterValue.startDate) n += 1
    if (batchFilterValue.endDate) n += 1
    return n
  }, [batchFilterValue])

  // 批次列表（导入流状态机据此派生批次选择/质量统计/差异对比候选）；筛选条件变化经 queryKey 触发实时重新请求
  const batchFilterParams = useMemo(
    () => ({
      page: 1 as const,
      pageSize: 50,
      templateType: batchFilterValue.module === 'all' ? undefined : batchFilterValue.module,
      status: batchFilterValue.status === 'all' ? undefined : batchFilterValue.status,
      startDate: batchFilterValue.startDate || undefined,
      endDate: batchFilterValue.endDate || undefined,
    }),
    [batchFilterValue],
  )
  const { data: importsData } = useImports(batchFilterParams)
  const flow = useImportFlow({ importsData })

  return (
    <Card className="border border-border">
      {/* 分区一：数据导入（UploadZone：文件选择/拖放/模板类型/期间/预算覆盖/上传 + 预览结果 + 导入成功条） */}
      <UploadZone
        canImport={canImport}
        templateType={flow.templateType}
        setTemplateType={flow.setTemplateType}
        valueUnit={flow.valueUnit}
        setValueUnit={flow.setValueUnit}
        budgetFiscalYear={flow.budgetFiscalYear}
        setBudgetFyOverride={flow.setBudgetFyOverride}
        fyOptions={flow.fyOptions}
        selectedFile={flow.selectedFile}
        fileError={flow.fileError}
        setFileError={flow.setFileError}
        previewResult={flow.previewResult}
        setPreviewResult={flow.setPreviewResult}
        mergedPreview={flow.mergedPreview}
        previewing={flow.previewing}
        uploading={flow.uploading}
        activating={flow.activating}
        uploadedInfo={flow.uploadedInfo}
        selectedBatch={flow.selectedBatch}
        setImportOpen={flow.setImportOpen}
        onFileSelect={flow.handleFileSelect}
        onDragOver={flow.handleDragOver}
        onDrop={flow.handleDrop}
        onUpload={flow.handleUpload}
        onCancel={flow.handleCancel}
        onPreview={flow.handlePreview}
        onActivate={flow.handleActivate}
      />

      {/* 分区二：导入质量概览 + 完整性验证 + 异常明细（可折叠） */}
      <div className={cn(canImport && 'border-t')}>
        <BatchPanel
          canImport={canImport}
          canArchive={canArchive}
          canPurgeBatch={canPurgeBatch}
          batchFilter={{
            value: batchFilterValue,
            onChange: handleBatchFilterChange,
            activeCount: batchActiveCount,
            onReset: resetBatchFilters,
          }}
          qualityOpen={flow.qualityOpen}
          onQualityOpenChange={flow.handleQualityOpenChange}
          qualityStats={flow.qualityStats}
          recentBatches={flow.recentBatches}
          selectedBatch={flow.selectedBatch}
          selectedBatchId={flow.selectedBatchId}
          setSelectedBatchId={flow.setSelectedBatchId}
          selectedCount={flow.selectedCount}
          selectableIds={flow.selectableIds}
          selectedBatchIds={flow.selectedBatchIds}
          setSelectedBatchIds={flow.setSelectedBatchIds}
          batchActivate={flow.batchActivate}
          activateMsg={flow.activateMsg}
          setActivateMsg={flow.setActivateMsg}
          detailFetching={flow.detailFetching}
          batchErrors={flow.batchErrors}
          activating={flow.activating}
          archiving={flow.archiving}
          purging={flow.purging}
          setCompareSource={flow.setCompareSource}
          onToggleSelect={flow.toggleSelect}
          onActivate={flow.handleActivate}
          onActivateRow={flow.handleRowActivate}
          onBatchActivate={flow.handleBatchActivate}
          onArchive={flow.handleArchive}
          onPurge={flow.handlePurgeBatch}
        />
      </div>

      {/* 分区三：往来导入覆盖（合并自往来分析「数据质量」目录；仅持有往来查看权限的用户可见） */}
      {canViewTransactions && (
        <div className="border-t">
          <Collapsible
            open={flow.coverageOpen}
            onOpenChange={flow.handleCoverageOpenChange}
            trigger={(open) => (
              <span className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
                <span className="flex items-center text-base font-semibold leading-none tracking-tight">
                  <Grid3X3 className="mr-2 h-5 w-5" />
                  往来导入覆盖
                </span>
                <span className="flex items-center gap-3 text-muted-foreground">
                  {!open && <span className="text-sm">往来批次覆盖率矩阵（公司×期间×类型）</span>}
                  <span className="flex items-center gap-1 text-xs">
                    {open ? '收起' : '展开'}
                    {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </span>
                </span>
              </span>
            )}
          >
            <CardContent>
              <CoverageTab />
            </CardContent>
          </Collapsible>
        </div>
      )}
      {flow.confirmElement}
      <ImportCompareDialog
        open={!!flow.compareSource}
        onOpenChange={(v) => { if (!v) flow.setCompareSource(null) }}
        source={flow.compareSource}
        candidates={flow.compareCandidates}
        onRollbackSuccess={(msg) => flow.setActivateMsg(msg)}
      />
      <TransactionImportDialog open={flow.importOpen} onOpenChange={flow.setImportOpen} />
    </Card>
  )
}
