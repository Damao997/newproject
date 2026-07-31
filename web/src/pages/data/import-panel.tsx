import { useCallback, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { usePermission } from '@/hooks/usePermission'
import { useImports, useImport, useUploadImport, useActivateImport, usePreviewImport, useArchiveImport, usePurgeImport } from '@/hooks/api-queries'
import { validateExcelFile } from '@/lib/file-validation'
import { downloadImportTemplate } from '@/lib/import-template'
import { type ImportPreviewResult } from '@/lib/api'
import { formatMoneyWan, cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Collapsible } from '@/components/ui/collapsible'
import { useConfirm } from '@/components/ui/confirm-dialog'
import type { ImportBatch } from '@/types'
import {
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Trash2,
  Archive,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'

/** 批次生命周期状态中文标签 */
const batchStatusLabel: Record<string, string> = {
  draft: '草稿',
  active: '已生效',
  archived: '已归档',
  purged: '已清除',
}

/** 模板类型中文标签 */
const templateTypeLabel: Record<string, string> = {
  operating: '经营数据',
  static: '静态数据',
  budget: '年度预算',
  transaction: '往来明细',
  inventory: '存货数据',
}

/** 导入质量概览折叠偏好的 localStorage key（'1' = 收起） */
const QUALITY_COLLAPSED_KEY = 'data-quality-overview-collapsed'

interface ImportErrorRow {
  row: number
  column: string
  message: string
}

/**
 * 数据导入 + 导入质量概览合并面板（单卡片上下两分区，紧凑布局）。
 *
 * 分区一（导入，canImport 门禁）：模板选择/下载、拖拽/选择上传、预览校验（dry-run）、确认导入；
 * 分区二（质量概览，始终展示）：跨批次质量统计、批次选择/激活、批次管理、完整性校验、异常明细，
 * 保留折叠能力并沿用原 localStorage 偏好 key。
 */
export function ImportPanel() {
  const { can } = usePermission()
  const canImport = can('data:import', 'upload')
  // 高危操作（仅 superadmin 持有对应权限码）
  const canArchive = can('data:import', 'archive')
  const canPurgeBatch = can('data:import', 'purge')
  const { confirm, element: confirmElement } = useConfirm()

  // 导入质量概览折叠偏好：localStorage 持久化（'1' = 收起），读写失败静默降级为展开
  const [qualityOpen, setQualityOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(QUALITY_COLLAPSED_KEY) !== '1'
    } catch {
      return true
    }
  })
  const handleQualityOpenChange = (open: boolean) => {
    setQualityOpen(open)
    try {
      localStorage.setItem(QUALITY_COLLAPSED_KEY, open ? '0' : '1')
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }

  // ---- 导入 ----
  const [templateType, setTemplateType] = useState('operating')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [uploadedInfo, setUploadedInfo] = useState<{ filename: string; detailCount: number; rowCount: number } | null>(null)
  const uploadMutation = useUploadImport()
  const previewMutation = usePreviewImport()
  const [previewResult, setPreviewResult] = useState<ImportPreviewResult | null>(null)

  /** 期间列表友好化：超过 6 个截断并标注总数 */
  const fmtPeriods = (ps: string[]) => (ps.length <= 6 ? ps.join('、') : `${ps.slice(0, 6).join('、')} 等 ${ps.length} 个期间`)

  // ---- 质量概览 ----
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const { data: importsData } = useImports({ page: 1, pageSize: 50 })
  const { data: batchDetail, isFetching: detailFetching } = useImport(selectedBatchId)
  const activateMutation = useActivateImport()
  const archiveMutation = useArchiveImport()
  const purgeMutation = usePurgeImport()
  const [activateMsg, setActivateMsg] = useState<string | null>(null)

  const recentBatches = useMemo(() => importsData?.items ?? [], [importsData])
  const selectedBatch = useMemo(
    () => recentBatches.find((b) => b.id === selectedBatchId) ?? null,
    [recentBatches, selectedBatchId],
  )

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

  // 异常明细表列
  const errorColumns: DataTableColumn<ImportErrorRow>[] = useMemo(() => [
    { key: 'row', header: '行号', align: 'right', cellClassName: 'font-num text-muted-foreground', render: (e) => (e.row > 0 ? e.row : '-') },
    { key: 'column', header: '列', cellClassName: 'font-mono text-muted-foreground' },
    { key: 'message', header: '错误信息', cellClassName: 'text-destructive' },
  ], [])

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
      const batch = await uploadMutation.mutateAsync({ file: selectedFile, templateType })
      setUploadedInfo({ filename: batch.filename, detailCount: batch.detailCount ?? batch.successCount, rowCount: batch.rowCount ?? batch.successCount })
      setSelectedFile(null)
    } catch (err) {
      setFileError(err instanceof Error ? err.message : '导入失败')
    }
  }

  const handleCancel = () => {
    setSelectedFile(null)
    setFileError(null)
    setUploadedInfo(null)
    setPreviewResult(null)
  }

  const handlePreview = async () => {
    if (!selectedFile) return
    setFileError(null)
    setPreviewResult(null)
    try {
      const res = await previewMutation.mutateAsync({ file: selectedFile, templateType })
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

  // 批次管理表列（带权限门禁的行操作）
  const batchColumns: DataTableColumn<ImportBatch>[] = useMemo(() => {
    const cols: DataTableColumn<ImportBatch>[] = [
      { key: 'filename', header: '文件名', cellClassName: 'font-medium' },
      { key: 'templateType', header: '模板类型', render: (b) => templateTypeLabel[b.templateType] ?? b.templateType },
      {
        key: 'status', header: '状态',
        render: (b) => (
          <Badge variant={b.status === 'active' ? 'success' : b.status === 'draft' ? 'default' : 'secondary'}>
            {batchStatusLabel[b.status] ?? b.status}
          </Badge>
        ),
      },
      { key: 'detailCount', header: '入库明细', align: 'right', cellClassName: 'font-num', render: (b) => b.detailCount ?? b.rowCount ?? b.successCount + b.errorCount },
      {
        key: 'quality', header: '成功/异常', align: 'right', cellClassName: 'font-num',
        render: (b) => (
          <span>
            <span className="text-green-700">{b.successCount}</span>
            {' / '}
            <span className={b.errorCount > 0 ? 'text-red-700' : 'text-muted-foreground'}>{b.errorCount}</span>
          </span>
        ),
      },
      { key: 'createdAt', header: '导入时间', render: (b) => new Date(b.createdAt).toLocaleString('zh-CN') },
    ]
    if (canImport || canArchive || canPurgeBatch) {
      cols.push({
        key: 'actions', header: '操作', align: 'right',
        render: (b) => (
          <div className="flex items-center justify-end gap-1">
            {canImport && b.status !== 'active' && b.status !== 'purged' && (
              <Button variant="ghost" size="sm" title="激活生效" disabled={activateMutation.isPending} onClick={() => handleRowActivate(b)}>
                <CheckCircle className="h-4 w-4" />
              </Button>
            )}
            {canArchive && (b.status === 'active' || b.status === 'draft') && (
              <Button variant="ghost" size="sm" title="归档" disabled={archiveMutation.isPending} onClick={() => handleArchive(b)}>
                <Archive className="h-4 w-4" />
              </Button>
            )}
            {canPurgeBatch && (b.status === 'archived' || b.status === 'draft') && (
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" title="清除数据（不可恢复）" disabled={purgeMutation.isPending} onClick={() => handlePurgeBatch(b)}>
                <ShieldAlert className="h-4 w-4" />
              </Button>
            )}
          </div>
        ),
      })
    }
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canImport, canArchive, canPurgeBatch, activateMutation.isPending, archiveMutation.isPending, purgeMutation.isPending])

  return (
    <Card>
      {/* 分区一：数据导入（紧凑布局：标题与模板工具栏同行 + 横向拖拽区） */}
      {canImport && (
        <div className="space-y-3 p-6 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center text-base font-semibold leading-none tracking-tight">
              <FileSpreadsheet className="mr-2 h-5 w-5" />
              数据导入
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">模板类型:</span>
              <Select value={templateType} onValueChange={(v) => { setTemplateType(v); setPreviewResult(null) }}>
                <SelectTrigger className="h-8 w-[160px] max-w-full shrink-0">
                  <SelectValue placeholder="选择模板类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="operating">经营数据</SelectItem>
                  <SelectItem value="static">静态数据</SelectItem>
                  <SelectItem value="budget">年度预算</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="shrink-0" onClick={() => downloadImportTemplate(templateType as 'operating' | 'static' | 'budget')}>
                <Download className="mr-2 h-4 w-4" />
                下载模板
              </Button>
            </span>
          </div>

          <div
            className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-dashed border-muted-foreground/25 p-3 transition-colors hover:border-primary/50 hover:bg-muted/50"
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <Upload className="h-6 w-6 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted-foreground">拖拽 .xlsx 文件到此处，或点击选择文件</p>
              <p className="text-xs text-muted-foreground">支持 .xlsx / .xls，最大 50MB</p>
            </div>
            <input type="file" accept=".xlsx,.xls" className="hidden" id="file-upload" onChange={handleFileSelect} />
            <label htmlFor="file-upload" className="shrink-0">
              <Button variant="outline" size="sm" asChild>
                <span>选择文件</span>
              </Button>
            </label>
          </div>

          {/* 模块边界：往来导入入口在往来分析页（就近维护），批次生命周期统一在下方列表管理 */}
          <p className="text-xs text-muted-foreground">
            往来数据（六大往来账龄报表）请在「往来分析」页的导入入口上传，批次统一在此列表管理。
          </p>

          {fileError && (
            <div className="flex items-center space-x-2 rounded-lg border border-red-200 bg-red-50 p-3">
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="text-sm font-medium text-red-700">{fileError}</span>
            </div>
          )}

          {selectedFile && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/50 p-3">
              <div className="flex min-w-0 flex-1 items-center space-x-3">
                <FileSpreadsheet className="h-6 w-6 shrink-0 text-green-500" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center space-x-2">
                <Button variant="ghost" size="sm" title="移除文件" onClick={handleCancel}>
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={handlePreview} disabled={previewMutation.isPending}>
                  {previewMutation.isPending ? '预览中...' : '预览校验'}
                </Button>
                <Button size="sm" onClick={handleUpload} disabled={uploadMutation.isPending}>
                  {uploadMutation.isPending ? '导入中...' : '确认导入'}
                </Button>
              </div>
            </div>
          )}

          {previewResult && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <p className="text-sm font-medium">预览校验结果（未写入）</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border bg-background p-2">
                  <p className="text-xs text-muted-foreground">数据行数</p>
                  <p className="mt-1 text-xl font-semibold">{previewResult.dataRowCount}</p>
                </div>
                <div className="rounded-lg border bg-background p-2">
                  <p className="text-xs text-muted-foreground">将入库明细{(previewResult.summary?.duplicateCount ?? 0) > 0 ? '（重复已求和合并）' : ''}</p>
                  <p className="mt-1 text-xl font-semibold">{previewResult.operatingCount + previewResult.staticCount + previewResult.budgetCount}</p>
                </div>
                <div className={cn('rounded-lg border p-2', previewResult.errorCount > 0 ? 'border-red-200 bg-red-50' : 'bg-background')}>
                  <p className={cn('text-xs', previewResult.errorCount > 0 ? 'text-red-700' : 'text-muted-foreground')}>异常条数</p>
                  <p className={cn('mt-1 text-xl font-semibold', previewResult.errorCount > 0 && 'text-red-700')}>{previewResult.errorCount}</p>
                </div>
                <div className="rounded-lg border bg-background p-2">
                  <p className="text-xs text-muted-foreground">模板类型</p>
                  <p className="mt-1 text-sm font-medium">{templateType === 'operating' ? '经营数据' : templateType === 'static' ? '静态数据' : '年度预算'}</p>
                </div>
              </div>
              {previewResult.summary && previewResult.summary.companyCount > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border bg-background p-2">
                    <p className="text-xs text-muted-foreground">覆盖公司数</p>
                    <p className="mt-1 text-xl font-semibold">{previewResult.summary.companyCount}</p>
                  </div>
                  <div className="rounded-lg border bg-background p-2">
                    <p className="text-xs text-muted-foreground">覆盖科目数</p>
                    <p className="mt-1 text-xl font-semibold">{previewResult.summary.subjectCount}</p>
                  </div>
                  <div className="rounded-lg border bg-background p-2">
                    <p className="text-xs text-muted-foreground">期间范围</p>
                    <p className="mt-1 text-sm font-semibold">
                      {previewResult.summary.periodRange.min === previewResult.summary.periodRange.max
                        ? previewResult.summary.periodRange.min ?? '-'
                        : `${previewResult.summary.periodRange.min ?? '-'} ~ ${previewResult.summary.periodRange.max ?? '-'}`}
                    </p>
                  </div>
                  <div className="rounded-lg border bg-background p-2">
                    <p className="text-xs text-muted-foreground">金额合计(万)</p>
                    <p className="mt-1 text-sm font-semibold font-num">{formatMoneyWan(previewResult.summary.totalValue)}</p>
                  </div>
                </div>
              )}
              {/* 风险/影响提示区（按严重度排序：重复 > KPI 缺类 > 期间替换 > 期间保留 > 零值） */}
              {previewResult.summary && previewResult.summary.duplicateCount > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-start space-x-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-amber-800">
                        文件内存在 {previewResult.summary.duplicateCount} 条重复记录（同公司+科目+期间），导入时将按科目求和合并入库。
                      </p>
                      {previewResult.summary.duplicateSamples.length > 0 && (
                        <ul className="list-inside list-disc text-xs text-amber-700">
                          {previewResult.summary.duplicateSamples.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {previewResult.kpiCoverage && previewResult.kpiCoverage.missing.length > 0 && (
                <div className="flex items-start space-x-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  <p className="text-sm font-medium text-amber-800">
                    以下看板 KPI 类别无科目数据：{previewResult.kpiCoverage.missing.join('、')}，激活后对应卡片将显示 0。
                  </p>
                </div>
              )}
              {previewResult.activationImpact?.activeBatch && previewResult.activationImpact.overlappingPeriods.length > 0 && (
                <div className="flex items-start space-x-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                  <p className="text-sm text-blue-800">
                    {templateType === 'budget'
                      ? `激活后将替换《${previewResult.activationImpact.activeBatch.filename}》的 ${fmtPeriods(previewResult.activationImpact.overlappingPeriods)} 财年预算。`
                      : `激活后将替换期间 ${fmtPeriods(previewResult.activationImpact.overlappingPeriods)} 的现有数据。`}
                  </p>
                </div>
              )}
              {previewResult.activationImpact?.activeBatch && previewResult.activationImpact.retainedPeriods.length > 0 && templateType !== 'budget' && (
                <div className="flex items-start space-x-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                  <p className="text-sm text-blue-800">
                    当前生效数据中的期间 {fmtPeriods(previewResult.activationImpact.retainedPeriods)} 本文件未包含，激活后将继续保留生效（按期间合并）。
                  </p>
                </div>
              )}
              {previewResult.summary && previewResult.summary.zeroValueCount > 0 && (
                <p className="text-xs text-muted-foreground">包含 {previewResult.summary.zeroValueCount} 条零值记录。</p>
              )}
              {previewResult.sampleRows && previewResult.sampleRows.rows.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">数据抽样预览（{previewResult.sampleRows.rows.length} 行，跨科目/公司分散采样）</p>
                  <div className="max-h-[280px] overflow-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0">
                        <tr className="border-b bg-muted/50">
                          {previewResult.sampleRows.headers.map((h, i) => (
                            <th key={i} className="whitespace-nowrap p-2 text-center font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewResult.sampleRows.rows.map((row, i) => (
                          <tr key={i} className="border-b last:border-0">
                            {row.map((cell, j) => (
                              <td key={j} className="whitespace-nowrap p-2 font-num text-muted-foreground">
                                {typeof cell === 'number' ? cell.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {previewResult.errorCount > 0 && (
                <div className="max-h-[200px] overflow-y-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="p-2 text-center font-medium">行号</th>
                        <th className="p-2 text-center font-medium">列</th>
                        <th className="p-2 text-center font-medium">错误信息</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewResult.errors.slice(0, 50).map((e, i) => (
                        <tr key={`${e.row}-${e.column}-${i}`} className="border-b">
                          <td className="p-2 font-num text-muted-foreground">{e.row > 0 ? e.row : '-'}</td>
                          <td className="p-2 font-mono text-muted-foreground">{e.column}</td>
                          <td className="p-2 text-destructive">{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-muted-foreground">确认无误后点击“确认导入”正式写入。</p>
            </div>
          )}

          {uploadedInfo && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <div className="flex items-start space-x-2">
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                <div className="space-y-2">
                  <span className="text-sm font-medium text-green-800">
                    导入成功：《{uploadedInfo.filename}》，入库 {uploadedInfo.detailCount} 条明细（解析 {uploadedInfo.rowCount} 行）。
                  </span>
                  <p className="text-xs text-green-700">
                    批次已创建为草稿状态。请在下方「批次管理」中选择该批次并点击「激活」，数据将按期间合并生效于看板与指标。
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 分区二：导入质量概览 + 完整性验证 + 异常明细（可折叠） */}
      <div className={cn(canImport && 'border-t')}>
        <Collapsible
          open={qualityOpen}
          onOpenChange={handleQualityOpenChange}
          trigger={(open) => (
            <span className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
              <span className="flex items-center text-base font-semibold leading-none tracking-tight">
                <AlertTriangle className="mr-2 h-5 w-5" />
                导入质量概览
              </span>
              <span className="flex items-center gap-3 text-muted-foreground">
                {/* 收起态摘要：关键质量数字一瞥（异常 > 0 红色强调） */}
                {!open && (
                  <span className="font-num text-sm">
                    {qualityStats.batchCount} 批次 · {qualityStats.totalRows} 条 ·{' '}
                    <span className={cn(qualityStats.errorRows > 0 && 'font-medium text-red-700')}>
                      异常 {qualityStats.errorRows}
                    </span>
                  </span>
                )}
                <span className="flex items-center gap-1 text-xs">
                  {open ? '收起' : '展开'}
                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </span>
              </span>
            </span>
          )}
        >
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border bg-muted/30 p-2">
                <p className="text-xs text-muted-foreground">导入批次</p>
                <p className="mt-1 text-xl font-semibold">{qualityStats.batchCount}</p>
              </div>
              <div className="rounded-lg border bg-muted/30 p-2">
                <p className="text-xs text-muted-foreground">总记录数</p>
                <p className="mt-1 text-xl font-semibold">{qualityStats.totalRows}</p>
              </div>
              <div className="rounded-lg border border-green-200 bg-green-50 p-2">
                <p className="text-xs text-green-700">入库记录</p>
                <p className="mt-1 text-xl font-semibold text-green-700">{qualityStats.successRows}</p>
              </div>
              <div className={cn('rounded-lg border p-2', qualityStats.errorRows > 0 ? 'border-red-200 bg-red-50' : 'bg-muted/30')}>
                <p className={cn('text-xs', qualityStats.errorRows > 0 ? 'text-red-700' : 'text-muted-foreground')}>异常记录</p>
                <p className={cn('mt-1 text-xl font-semibold', qualityStats.errorRows > 0 && 'text-red-700')}>{qualityStats.errorRows}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">选择批次:</span>
              <Select value={selectedBatchId ?? 'none'} onValueChange={(v) => { setSelectedBatchId(v === 'none' ? null : v); setActivateMsg(null) }}>
                <SelectTrigger className="w-[300px] max-w-full shrink-0">
                  <SelectValue placeholder="选择批次查看质量明细" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">请选择批次</SelectItem>
                  {recentBatches.map((batch) => (
                    <SelectItem key={batch.id} value={batch.id}>
                      {batch.filename}（{batchStatusLabel[batch.status] ?? batch.status}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canImport && selectedBatch && selectedBatch.status !== 'active' && (
                <Button size="sm" className="shrink-0" onClick={handleActivate} disabled={activateMutation.isPending}>
                  {activateMutation.isPending ? '激活中...' : '激活批次'}
                </Button>
              )}
              {canImport && selectedBatch && selectedBatch.status === 'active' && (
                <span className="text-xs text-green-700">当前批次已生效</span>
              )}
            </div>
            {activateMsg && <p className="text-xs text-muted-foreground">{activateMsg}</p>}

            {/* 批次管理表：全部批次 + 激活/归档/清除（高危操作按权限显示） */}
            <div className="space-y-2">
              <p className="text-sm font-medium">批次管理</p>
              <DataTable
                columns={batchColumns}
                data={recentBatches}
                rowKey={(b) => b.id}
                dense
                emptyText="暂无导入批次"
              />
            </div>

            {selectedBatch && (
              selectedBatch.errorCount === 0 ? (
                <div className="flex items-center space-x-2 rounded-lg border border-green-200 bg-green-50 p-4">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  <span className="text-sm font-medium text-green-800">
                    完整性校验通过：共 {selectedBatch.detailCount ?? selectedBatch.rowCount ?? selectedBatch.successCount} 条明细均解析成功。
                  </span>
                </div>
              ) : selectedBatch.successCount > 0 ? (
                <div className="flex items-center space-x-2 rounded-lg border border-amber-200 bg-amber-50 p-4">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  <span className="text-sm font-medium text-amber-800">
                    共 {selectedBatch.rowCount ?? selectedBatch.successCount + selectedBatch.errorCount} 行，成功 {selectedBatch.successCount} 行，异常 {selectedBatch.errorCount} 条，请核对下方异常明细。
                  </span>
                </div>
              ) : (
                <div className="flex items-center space-x-2 rounded-lg border border-red-200 bg-red-50 p-4">
                  <XCircle className="h-4 w-4 text-red-500" />
                  <span className="text-sm font-medium text-red-700">
                    全部 {selectedBatch.errorCount} 条解析失败，请检查文件内容与模板类型。
                  </span>
                </div>
              )
            )}

            {selectedBatchId && (
              <div className={cn('transition-opacity duration-200', detailFetching && 'opacity-60')}>
                <DataTable
                  columns={errorColumns}
                  data={batchErrors}
                  rowKey={(e, i) => `${e.row}-${e.column}-${i}`}
                  dense
                  emptyText={detailFetching ? '加载中...' : '该批次无解析异常'}
                />
              </div>
            )}
          </CardContent>
        </Collapsible>
      </div>
      {confirmElement}
    </Card>
  )
}
