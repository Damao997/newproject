import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { usePageStore } from '@/stores/pageStateStore'
import { usePeriodStore } from '@/stores/periodStore'
import { useUploadImport, usePreviewImport, useActivateImport, useArchiveImport, usePurgeImport, useAvailablePeriods, useImport } from '@/hooks/api-queries'
import { useBatchActivate, buildActivateConflictDescription } from '@/hooks/use-batch-activate'
import { validateExcelFile } from '@/lib/file-validation'
import { api, type ImportPreviewResult, type MergedPreviewResult } from '@/lib/api'
import { useConfirm } from '@/components/ui/confirm-dialog'
import type { DataTableColumn } from '@/components/data-table/data-table'
import type { ImportBatch, PaginatedResponse } from '@/types'

/** 批次生命周期状态中文标签 */
export const batchStatusLabel: Record<string, string> = {
  draft: '草稿',
  active: '已生效',
  archived: '已归档',
  purged: '已清除',
}

/** 模板类型中文标签 */
export const templateTypeLabel: Record<string, string> = {
  operating: '经营数据',
  static: '静态数据',
  cashflow: '现金流量数据',
  budget: '年度预算',
  transaction: '往来明细',
  inventory: '存货数据',
  merged: '多表合并',
}

export interface ImportErrorRow {
  row: number
  column: string
  message: string
}

/** 异常明细表列 */
export const errorColumns: DataTableColumn<ImportErrorRow>[] = [
  { key: 'row', header: '行号', align: 'right', cellClassName: 'font-num text-muted-foreground', render: (e) => (e.row > 0 ? e.row : '-') },
  { key: 'column', header: '列', cellClassName: 'font-mono text-muted-foreground' },
  { key: 'message', header: '错误信息', cellClassName: 'text-destructive' },
]

/**
 * 导入流状态机：上传→预览→激活 全链路状态与 handler（从 import-panel.tsx 原样搬迁，零逻辑变更）。
 */
export function useImportFlow(opts: { importsData: PaginatedResponse<ImportBatch> | undefined }) {
  const { importsData } = opts
  const { confirm, element: confirmElement } = useConfirm()
  const queryClient = useQueryClient()

  // 导入质量概览折叠偏好：pageStateStore 持久化（切换子页/刷新后恢复）
  const qualityOpen = !usePageStore((s) => s.dataImport.qualityCollapsed)
  const setDataImport = usePageStore((s) => s.setDataImport)
  const handleQualityOpenChange = (open: boolean) => {
    setDataImport({ qualityCollapsed: !open })
  }

  // 往来导入覆盖折叠偏好：pageStateStore 持久化
  const coverageOpen = !usePageStore((s) => s.dataImport.coverageCollapsed)
  const handleCoverageOpenChange = (open: boolean) => {
    setDataImport({ coverageCollapsed: !open })
  }

  // ---- 导入 ----
  const [templateType, setTemplateType] = useState('operating')
  // 往来账龄报表专用多文件导入对话框（模板类型选「往来明细」时打开）
  const [importOpen, setImportOpen] = useState(false)
  // 文件金额单位：系统存储口径为万元，选「元」时后端解析期自动 ÷10000 转换（默认元）
  const [valueUnit, setValueUnit] = useState('yuan')
  // ---- 目标财年（仅 budget：预算文件归属单一财年，导入时指定而非读文件内财年；operating/static 财年逐期推导无需指定）----
  const { data: periodsData } = useAvailablePeriods()
  const globalFiscalYear = usePeriodStore((s) => s.fiscalYear)
  const [budgetFyOverride, setBudgetFyOverride] = useState<string | null>(null)
  // 当前财年按当前日期与财年起始月推导（与后端 fyLabelOfDate 同口径，避免缺省时被动回退服务器当前财年）
  const currentFy = useMemo(() => {
    const startMonth = periodsData?.fiscalStartMonth ?? 1
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    return `FY${m >= startMonth ? y : y - 1}`
  }, [periodsData?.fiscalStartMonth])
  // 候选财年：上一年至后三年共 5 个（降序），全局选中财年超出范围时一并纳入
  const fyOptions = useMemo(() => {
    const base = Number(currentFy.replace(/^FY/, ''))
    const years = new Set([base + 1, base, base - 1, base - 2, base - 3])
    const g = globalFiscalYear ? Number(globalFiscalYear.replace(/^FY/, '')) : NaN
    if (Number.isFinite(g)) years.add(g)
    return [...years].sort((a, b) => b - a).map((y) => `FY${y}`)
  }, [currentFy, globalFiscalYear])
  // 生效目标财年：用户显式选择 > 全局财年选择器 > 当前财年
  const budgetFiscalYear = budgetFyOverride ?? globalFiscalYear ?? currentFy
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [uploadedInfo, setUploadedInfo] = useState<{ batchId: string; filename: string; detailCount: number; rowCount: number } | null>(null)
  const uploadMutation = useUploadImport()
  const previewMutation = usePreviewImport()
  const [previewResult, setPreviewResult] = useState<ImportPreviewResult | null>(null)
  // 多表合并预览结果（templateType === 'merged' 时使用，按类型分桶）
  const [mergedPreview, setMergedPreview] = useState<MergedPreviewResult | null>(null)

  // ---- 质量概览 ----
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const { data: batchDetail, isFetching: detailFetching } = useImport(selectedBatchId)
  const activateMutation = useActivateImport()
  const archiveMutation = useArchiveImport()
  const purgeMutation = usePurgeImport()
  const [activateMsg, setActivateMsg] = useState<string | null>(null)
  const batchActivate = useBatchActivate()

  const recentBatches = useMemo(() => importsData?.items ?? [], [importsData])
  const selectedBatch = useMemo(
    () => recentBatches.find((b) => b.id === selectedBatchId) ?? null,
    [recentBatches, selectedBatchId],
  )

  // ---- 批次多选（仅 draft 可勾选，用于批量激活） ----
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set())
  const selectableIds = useMemo(() => recentBatches.filter((b) => b.status === 'draft').map((b) => b.id), [recentBatches])
  const selectedCount = useMemo(() => selectableIds.filter((id) => selectedBatchIds.has(id)).length, [selectableIds, selectedBatchIds])
  const toggleSelect = useCallback((id: string) => {
    setSelectedBatchIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  // 导入质量概览：跨批次聚合关键指标（按入库明细数统计）
  const qualityStats = useMemo(() => {
    let totalRows = 0
    let successRows = 0
    let errorRows = 0
    for (const b of recentBatches) {
      const rows = b.detailCount ?? b.rowCount ?? b.successCount + b.errorCount
      totalRows += rows
      successRows += rows
      errorRows += b.errorCount
    }
    return { batchCount: recentBatches.length, totalRows, successRows, errorRows }
  }, [recentBatches])

  const batchErrors = (batchDetail?.errors ?? []) as ImportErrorRow[]

  const acceptFile = (file: File) => {
    const result = validateExcelFile(file)
    if (!result.valid) {
      setFileError(result.message ?? '文件校验失败')
      setSelectedFile(null)
      return
    }
    setFileError(null)
    setSelectedFile(file)
    setUploadedInfo(null)
    setPreviewResult(null)
  }

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) acceptFile(file)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => e.preventDefault(), [])
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) acceptFile(file)
  }, [])

  const handleUpload = async () => {
    if (!selectedFile) return
    setFileError(null)
    try {
      if (templateType === 'merged') {
        // 多表合并：按 Sheet 类型各建 draft 批次，自动勾选新批次提示批量激活
        const res = await api.uploadMergedImport(selectedFile, valueUnit)
        // 刷新批次列表（merged 分支直接调 api，未走 mutation 的 onSuccess 失效逻辑）
        queryClient.invalidateQueries({ queryKey: ['data', 'imports'] })
        setSelectedBatchIds(new Set(res.items.map((b) => b.id)))
        setActivateMsg(`已创建 ${res.items.length} 个批次（${res.items.map((b) => templateTypeLabel[b.templateType] ?? b.templateType).join('、')}），请在下方「导入质量概览」勾选后批量激活。`)
        setSelectedFile(null)
        setMergedPreview(null)
        setPreviewResult(null)
        // 导入→激活闭环：强制展开质量概览
        setDataImport({ qualityCollapsed: false })
        return
      }
      const batch = await uploadMutation.mutateAsync({ file: selectedFile, templateType, valueUnit, ...(templateType === 'budget' ? { fiscalYear: budgetFiscalYear } : {}) })
      setUploadedInfo({ batchId: batch.id, filename: batch.filename, detailCount: batch.detailCount ?? batch.successCount, rowCount: batch.rowCount ?? batch.successCount })
      setSelectedFile(null)
      // 导入→激活闭环：强制展开质量概览并自动选中新批次，完整性校验/异常明细直接就绪
      setDataImport({ qualityCollapsed: false })
      setSelectedBatchId(batch.id)
      setActivateMsg(null)
    } catch (err) {
      setFileError(err instanceof Error ? err.message : '导入失败')
    }
  }

  const handleCancel = () => {
    setSelectedFile(null)
    setFileError(null)
    setUploadedInfo(null)
    setPreviewResult(null)
    setMergedPreview(null)
  }

  const handlePreview = async () => {
    if (!selectedFile) return
    setFileError(null)
    setPreviewResult(null)
    setMergedPreview(null)
    try {
      if (templateType === 'merged') {
        const res = await api.previewMergedImport(selectedFile, valueUnit)
        setMergedPreview(res)
        return
      }
      const res = await previewMutation.mutateAsync({ file: selectedFile, templateType, valueUnit, ...(templateType === 'budget' ? { fiscalYear: budgetFiscalYear } : {}) })
      setPreviewResult(res)
    } catch (err) {
      setFileError(err instanceof Error ? err.message : '预览失败')
    }
  }

  const handleActivate = async () => {
    if (!selectedBatch) return
    setActivateMsg(null)
    try {
      await activateMutation.mutateAsync(selectedBatch.id)
      setActivateMsg(`批次《${selectedBatch.filename}》已激活生效。`)
    } catch (err) {
      setActivateMsg(err instanceof Error ? err.message : '激活失败')
    }
  }

  // ---- 批次管理（激活/归档/清除）----
  const handleRowActivate = async (b: ImportBatch) => {
    setActivateMsg(null)
    try {
      await activateMutation.mutateAsync(b.id)
      setActivateMsg(`批次《${b.filename}》已激活生效。`)
    } catch (err) {
      setActivateMsg(err instanceof Error ? err.message : '激活失败')
    }
  }

  /** 批量激活：预检冲突 → 确认覆盖风险 → 串行逐个激活（单批失败不中断，失败项保留勾选便于重试） */
  const handleBatchActivate = async () => {
    const targets = recentBatches.filter((b) => selectedBatchIds.has(b.id) && b.status === 'draft')
    if (targets.length === 0) return
    const batches = targets.map((b) => ({ id: b.id, filename: b.filename }))
    setActivateMsg(null)
    try {
      const check = await batchActivate.checkConflicts(batches.map((b) => b.id))
      const desc = buildActivateConflictDescription(check)
      if (desc && !(await confirm({ title: '批量激活确认', description: desc, danger: true, confirmText: '继续激活' }))) return
      const summary = await batchActivate.run(batches)
      const failIds = new Set(summary.failItems.map((f) => f.id))
      // 成功项移出勾选（失败项保留便于重试）
      setSelectedBatchIds((prev) => new Set([...prev].filter((id) => failIds.has(id))))
      setActivateMsg(
        summary.failCount === 0
          ? `批量激活完成：${summary.successCount} 个批次已全部激活生效。`
          : `批量激活完成：成功 ${summary.successCount} 个，失败 ${summary.failCount} 个。失败批次已保留勾选，可处理后重试。`,
      )
    } catch (err) {
      setActivateMsg(err instanceof Error ? err.message : '批量激活失败')
    }
  }

  const handleArchive = async (b: ImportBatch) => {
    const isActive = b.status === 'active'
    if (!(await confirm({
      title: '归档批次',
      description: isActive
        ? `批次《${b.filename}》当前生效中，归档后该模板类型将无生效数据，看板与指标将不再展示对应数据。确认归档？`
        : `确认归档批次《${b.filename}》？`,
      danger: isActive,
      confirmText: '归档',
    }))) return
    setActivateMsg(null)
    try {
      await archiveMutation.mutateAsync(b.id)
      setActivateMsg(`批次《${b.filename}》已归档。`)
    } catch (err) {
      setActivateMsg(err instanceof Error ? err.message : '归档失败')
    }
  }

  const handlePurgeBatch = async (b: ImportBatch) => {
    if (!(await confirm({
      title: '清除批次数据',
      description: `将物理删除批次《${b.filename}》的全部明细数据，此操作不可恢复！批次记录将保留为“已清除”状态留痕。`,
      danger: true,
      confirmText: '清除数据',
      requireInput: b.filename,
    }))) return
    setActivateMsg(null)
    try {
      await purgeMutation.mutateAsync(b.id)
      setActivateMsg(`批次《${b.filename}》明细数据已清除。`)
    } catch (err) {
      setActivateMsg(err instanceof Error ? err.message : '清除失败')
    }
  }

  // ---- 批次差异对比（US-03）：仅 operating/static/budget 可对比（transaction/inventory v1 不支持） ----
  const [compareSource, setCompareSource] = useState<ImportBatch | null>(null)
  const compareCandidates = useMemo(() => {
    if (!compareSource) return []
    return recentBatches
      .filter((b) => b.templateType === compareSource.templateType && b.id !== compareSource.id && b.status !== 'purged')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [compareSource, recentBatches])

  return {
    // 折叠偏好（pageStateStore 持久化）
    qualityOpen,
    handleQualityOpenChange,
    coverageOpen,
    handleCoverageOpenChange,
    // 上传区（UploadZone）
    templateType,
    setTemplateType,
    valueUnit,
    setValueUnit,
    importOpen,
    setImportOpen,
    budgetFiscalYear,
    setBudgetFyOverride,
    fyOptions,
    selectedFile,
    fileError,
    setFileError,
    uploadedInfo,
    previewResult,
    setPreviewResult,
    mergedPreview,
    previewing: previewMutation.isPending,
    uploading: uploadMutation.isPending,
    // 质量概览区（BatchPanel）
    selectedBatchId,
    setSelectedBatchId,
    selectedBatch,
    recentBatches,
    selectedBatchIds,
    setSelectedBatchIds,
    selectableIds,
    selectedCount,
    toggleSelect,
    qualityStats,
    batchErrors,
    detailFetching,
    activateMsg,
    setActivateMsg,
    batchActivate,
    activating: activateMutation.isPending,
    archiving: archiveMutation.isPending,
    purging: purgeMutation.isPending,
    // 批次差异对比（ImportCompareDialog）
    compareSource,
    setCompareSource,
    compareCandidates,
    // 确认对话框元素（主文件挂载）
    confirmElement,
    // handlers（UploadZone/BatchPanel 接线）
    handleFileSelect,
    handleDragOver,
    handleDrop,
    handleUpload,
    handleCancel,
    handlePreview,
    handleActivate,
    handleRowActivate,
    handleBatchActivate,
    handleArchive,
    handlePurgeBatch,
  }
}
