import { useCallback, useMemo, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { usePermission } from '@/hooks/usePermission'
import { useImports, useImport, useUploadImport, useActivateImport, usePreviewImport, useArchiveImport, usePurgeImport, useAvailablePeriods } from '@/hooks/api-queries'
import { useBatchActivate, buildActivateConflictDescription } from '@/hooks/use-batch-activate'
import { usePeriodStore } from '@/stores/periodStore'
import { validateExcelFile } from '@/lib/file-validation'
import { downloadImportTemplate } from '@/lib/import-template'
import { type ImportPreviewResult } from '@/lib/api'
import { formatMoneyWan, cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible } from '@/components/ui/collapsible'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { ImportCompareDialog } from './import-compare-dialog'
import { TransactionImportDialog } from './transaction-import-dialog'
import { CoverageTab } from '@/pages/transactions/coverage-tab'
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
  Loader2,
  GitCompareArrows,
  Grid3X3,
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
/** 往来导入覆盖折叠偏好的 localStorage key（'1' = 收起） */
const COVERAGE_COLLAPSED_KEY = 'data-import-coverage-collapsed'

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
  const canViewTransactions = can('transactions', 'view')
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

  // 往来导入覆盖折叠偏好：localStorage 持久化（'1' = 收起），读写失败静默降级为展开
  const [coverageOpen, setCoverageOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COVERAGE_COLLAPSED_KEY) !== '1'
    } catch {
      return true
    }
  })
  const handleCoverageOpenChange = (open: boolean) => {
    setCoverageOpen(open)
    try {
      localStorage.setItem(COVERAGE_COLLAPSED_KEY, open ? '0' : '1')
    } catch {
      /* 隐私模式等场景忽略 */
    }
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

  // 异常明细表列
  const errorColumns: DataTableColumn<ImportErrorRow>[] = useMemo(() => [
    { key: 'row', header: '行号', align: 'right', cellClassName: 'font-num text-muted-foreground', render: (e) => (e.row > 0 ? e.row : '-') },
    { key: 'column', header: '列', cellClassName: 'font-mono text-muted-foreground' },
    { key: 'message', header: '错误信息', cellClassName: 'text-destructive' },
  ], [])

  // 抽样预览表列（动态列：表头来自服务端文件表头，单元格统一 font-num 数字字体）
  const sampleColumns: DataTableColumn<(string | number)[]>[] = useMemo(() => {
    if (!previewResult?.sampleRows) return []
    return previewResult.sampleRows.headers.map((h, i) => ({
      key: `col-${i}`,
      header: h,
      cellClassName: 'font-num text-muted-foreground',
      render: (row) => (typeof row[i] === 'number' ? (row[i] as number).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : row[i]),
    }))
  }, [previewResult?.sampleRows])

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
      const batch = await uploadMutation.mutateAsync({ file: selectedFile, templateType, valueUnit, ...(templateType === 'budget' ? { fiscalYear: budgetFiscalYear } : {}) })
      setUploadedInfo({ batchId: batch.id, filename: batch.filename, detailCount: batch.detailCount ?? batch.successCount, rowCount: batch.rowCount ?? batch.successCount })
      setSelectedFile(null)
      // 导入→激活闭环：强制展开质量概览并自动选中新批次，完整性校验/异常明细直接就绪
      handleQualityOpenChange(true)
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
  }

  const handlePreview = async () => {
    if (!selectedFile) return
    setFileError(null)
    setPreviewResult(null)
    try {
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

  // 批次管理表列（带权限门禁的行操作）
  const batchColumns: DataTableColumn<ImportBatch>[] = useMemo(() => {
    const cols: DataTableColumn<ImportBatch>[] = []
    // 多选列（仅 draft 可勾选，供批量激活；无导入权限不展示）
    if (canImport) {
      cols.push({
        key: 'select',
        header: (
          <Checkbox
            aria-label="全选批次"
            checked={selectedCount > 0 ? (selectedCount === selectableIds.length ? true : 'indeterminate') : false}
            disabled={selectableIds.length === 0 || batchActivate.isBusy}
            onCheckedChange={(checked) => setSelectedBatchIds(checked === true ? new Set(selectableIds) : new Set())}
          />
        ),
        align: 'center',
        render: (b) => (
          <Checkbox
            aria-label={`选择批次 ${b.filename}`}
            checked={selectedBatchIds.has(b.id)}
            disabled={b.status !== 'draft' || batchActivate.isBusy}
            onCheckedChange={() => toggleSelect(b.id)}
          />
        ),
      })
    }
    cols.push(
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
            <span className="text-success-strong">{b.successCount}</span>
            {' / '}
            <span className={b.errorCount > 0 ? 'text-destructive' : 'text-muted-foreground'}>{b.errorCount}</span>
          </span>
        ),
      },
      { key: 'createdAt', header: '导入时间', render: (b) => new Date(b.createdAt).toLocaleString('zh-CN') },
    )
    if (canImport || canArchive || canPurgeBatch) {
      cols.push({
        key: 'actions', header: '操作', align: 'right',
        render: (b) => (
          <div className="flex items-center justify-end gap-1">
            {(b.templateType === 'operating' || b.templateType === 'static' || b.templateType === 'budget') && (
              <Button variant="ghost" size="sm" title="差异对比" onClick={() => setCompareSource(b)}>
                <GitCompareArrows className="h-4 w-4" />
              </Button>
            )}
            {canImport && b.status !== 'active' && b.status !== 'purged' && (
              <Button variant="ghost" size="sm" title="激活生效" disabled={activateMutation.isPending || batchActivate.isBusy} onClick={() => handleRowActivate(b)}>
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
  }, [canImport, canArchive, canPurgeBatch, activateMutation.isPending, archiveMutation.isPending, purgeMutation.isPending, selectedBatchIds, selectableIds, selectedCount, batchActivate.isBusy])

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
                  <SelectItem value="transaction">往来明细</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm font-medium">数值单位:</span>
              <Select value={valueUnit} onValueChange={(v) => { setValueUnit(v); setPreviewResult(null) }}>
                <SelectTrigger className="h-8 w-[110px] max-w-full shrink-0">
                  <SelectValue placeholder="数值单位" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yuan">元</SelectItem>
                  <SelectItem value="wan">万元</SelectItem>
                </SelectContent>
              </Select>
              {templateType === 'budget' && (
                <>
                  <span className="text-sm font-medium">目标财年:</span>
                  <Select value={budgetFiscalYear} onValueChange={(v) => { setBudgetFyOverride(v); setPreviewResult(null) }}>
                    <SelectTrigger className="h-8 w-[110px] max-w-full shrink-0">
                      <SelectValue placeholder="选择财年" />
                    </SelectTrigger>
                    <SelectContent>
                      {fyOptions.map((fy) => (
                        <SelectItem key={fy} value={fy}>{fy}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </>
              )}
              {templateType !== 'transaction' && (
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => {
                  downloadImportTemplate(templateType as 'operating' | 'static' | 'budget').catch((e) => {
                    setFileError(e instanceof Error ? e.message : '模板下载失败')
                  })
                }}>
                  <Download className="mr-2 h-4 w-4" />
                  下载模板
                </Button>
              )}
            </span>
          </div>

          {templateType === 'transaction' ? (
            /* 往来明细：专用多文件上传区（ERP 账龄报表无标准模板，走对话框内预览/激活影响预告/导入闭环） */
            <div className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-dashed border-muted-foreground/25 p-3 transition-colors hover:border-primary/50 hover:bg-muted/50">
              <Upload className="h-6 w-6 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted-foreground">上传六大往来账龄报表（按账龄汇总表解析，支持多文件，最多 12 个）</p>
                <p className="text-xs text-muted-foreground">ERP 导出的 CUX_AR/AP 账龄报表（.xls/.xlsx），按 Sheet 名自动识别 应收/其他应收/预收/应付/其他应付/预付</p>
              </div>
              <Button size="sm" className="shrink-0" onClick={() => setImportOpen(true)}>
                <Upload className="mr-2 h-4 w-4" />
                选择文件上传
              </Button>
            </div>
          ) : (
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
          )}

          {/* 模块边界：往来批次与经营/静态/预算批次统一在本页管理，激活入口两处任一可用 */}
          <p className="text-xs text-muted-foreground">
            文件金额单位为「元」时入库自动 ÷10000 转换为万元存储（往来账龄报表为 ERP 原值，默认按元存储）；往来批次与经营/静态/预算批次统一在下方「导入质量概览」列表管理，可在本页或往来分析「导入覆盖」页激活。
          </p>

          {fileError && (
            <div className="flex items-center space-x-2 rounded-lg border border-destructive/25 bg-destructive/[0.06] p-3">
              <XCircle className="h-4 w-4 text-destructive" />
              <span className="text-sm font-medium text-destructive">{fileError}</span>
            </div>
          )}

          {selectedFile && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/50 p-3">
              <div className="flex min-w-0 flex-1 items-center space-x-3">
                <FileSpreadsheet className="h-6 w-6 shrink-0 text-success" />
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
              {templateType === 'budget' && (
                <p className="text-xs text-muted-foreground">
                  本文件年度预算将按「{budgetFiscalYear}」财年入库，激活后将替换该财年已生效预算。
                </p>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border bg-background p-2">
                  <p className="text-xs text-muted-foreground">数据行数</p>
                  <p className="mt-1 text-xl font-semibold">{previewResult.dataRowCount}</p>
                </div>
                <div className="rounded-lg border bg-background p-2">
                  <p className="text-xs text-muted-foreground">将入库明细{(previewResult.summary?.duplicateCount ?? 0) > 0 ? '（重复已求和合并）' : ''}</p>
                  <p className="mt-1 text-xl font-semibold">{previewResult.operatingCount + previewResult.staticCount + previewResult.budgetCount}</p>
                </div>
                <div className={cn('rounded-lg border p-2', previewResult.errorCount > 0 ? 'border-destructive/25 bg-destructive/[0.06]' : 'bg-background')}>
                  <p className={cn('text-xs', previewResult.errorCount > 0 ? 'text-destructive' : 'text-muted-foreground')}>异常条数</p>
                  <p className={cn('mt-1 text-xl font-semibold', previewResult.errorCount > 0 && 'text-destructive')}>{previewResult.errorCount}</p>
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
                <div className="rounded-lg border border-warning/30 bg-warning/[0.08] p-3">
                  <div className="flex items-start space-x-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-warning-strong">
                        文件内存在 {previewResult.summary.duplicateCount} 条重复记录（同公司+科目+期间），导入时将按科目求和合并入库。
                      </p>
                      {previewResult.summary.duplicateSamples.length > 0 && (
                        <ul className="list-inside list-disc text-xs text-warning-strong">
                          {previewResult.summary.duplicateSamples.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              )}
              {previewResult.kpiCoverage && previewResult.kpiCoverage.missing.length > 0 && (
                <div className="flex items-start space-x-2 rounded-lg border border-warning/30 bg-warning/[0.08] p-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <p className="text-sm font-medium text-warning-strong">
                    以下看板 KPI 类别无科目数据：{previewResult.kpiCoverage.missing.join('、')}，激活后对应卡片将显示 0。
                  </p>
                </div>
              )}
              {previewResult.budgetWarnings && previewResult.budgetWarnings.missingProfitLeaves.length > 0 && (
                <div className="rounded-lg border border-warning/30 bg-warning/[0.08] p-3">
                  <div className="flex items-start space-x-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-warning-strong">
                        预算文件未包含以下毛利直导科目的预算行，激活后其预算金额为 0（品类预算达成分析毛利列将出现无预算）：
                      </p>
                      <ul className="list-inside list-disc text-xs text-warning-strong">
                        {previewResult.budgetWarnings.missingProfitLeaves.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
              {previewResult.budgetWarnings && previewResult.budgetWarnings.typeFormulaMismatch.length > 0 && (
                <div className="rounded-lg border border-destructive/25 bg-destructive/[0.06] p-3">
                  <div className="flex items-start space-x-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-destructive">
                        以下毛利科目类型与公式不一致（数据类残留公式），导入值不会按公式重算。请先在「指标维护」中将它们恢复为计算类后再导入预算：
                      </p>
                      <ul className="list-inside list-disc text-xs text-destructive">
                        {previewResult.budgetWarnings.typeFormulaMismatch.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
              {previewResult.budgetWarnings && (previewResult.budgetWarnings.recalcSubjects.length > 0 || previewResult.budgetWarnings.parentSubjects.length > 0) && (
                <div className="flex items-start space-x-2 rounded-lg border border-info/25 bg-info/10 p-3">
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-info" />
                  <p className="text-sm text-info">
                    {[
                      previewResult.budgetWarnings.recalcSubjects.length > 0
                        ? `计算类科目（${previewResult.budgetWarnings.recalcSubjects.join('、')}）的导入值将被公式重算（毛利=收入-成本）`
                        : '',
                      previewResult.budgetWarnings.parentSubjects.length > 0
                        ? `父级科目（${previewResult.budgetWarnings.parentSubjects.join('、')}）的导入值将被子级求和覆盖`
                        : '',
                    ].filter(Boolean).join('；')}。
                  </p>
                </div>
              )}
              {previewResult.activationImpact?.activeBatch && previewResult.activationImpact.overlappingPeriods.length > 0 && (
                <div className="flex items-start space-x-2 rounded-lg border border-info/25 bg-info/10 p-3">
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-info" />
                  <p className="text-sm text-info">
                    {templateType === 'budget'
                      ? `激活后将替换《${previewResult.activationImpact.activeBatch.filename}》的 ${fmtPeriods(previewResult.activationImpact.overlappingPeriods)} 财年预算。`
                      : `激活后将替换期间 ${fmtPeriods(previewResult.activationImpact.overlappingPeriods)} 的现有数据。`}
                  </p>
                </div>
              )}
              {previewResult.activationImpact?.activeBatch && previewResult.activationImpact.retainedPeriods.length > 0 && templateType !== 'budget' && (
                <div className="flex items-start space-x-2 rounded-lg border border-info/25 bg-info/10 p-3">
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-info" />
                  <p className="text-sm text-info">
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
                  <DataTable
                    columns={sampleColumns}
                    data={previewResult.sampleRows.rows}
                    rowKey={(_, i) => i}
                    density="compact"
                    maxHeight="280px"
                    emptyText="无预览数据"
                    caption="导入数据抽样预览"
                  />
                </div>
              )}
              {previewResult.errorCount > 0 && (
                <DataTable
                  columns={errorColumns}
                  data={previewResult.errors.slice(0, 50)}
                  rowKey={(e, i) => `${e.row}-${e.column}-${i}`}
                  density="compact"
                  maxHeight="200px"
                  emptyText="暂无解析错误"
                  caption="导入校验错误明细"
                />
              )}
              <p className="text-xs text-muted-foreground">确认无误后点击“确认导入”正式写入。</p>
            </div>
          )}

          {uploadedInfo && (
            <div className="rounded-lg border border-success/25 bg-success/10 p-4">
              <div className="flex items-start space-x-2">
                <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <div className="space-y-2">
                  <span className="text-sm font-medium text-success-strong">
                    导入成功：《{uploadedInfo.filename}》，入库 {uploadedInfo.detailCount} 条明细（解析 {uploadedInfo.rowCount} 行）。
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedBatch && selectedBatch.id === uploadedInfo.batchId && selectedBatch.status !== 'active' ? (
                      <Button size="sm" onClick={handleActivate} disabled={activateMutation.isPending}>
                        {activateMutation.isPending ? '激活中...' : '立即激活该批次'}
                      </Button>
                    ) : selectedBatch && selectedBatch.id === uploadedInfo.batchId && selectedBatch.status === 'active' ? (
                      <span className="text-xs text-success-strong">该批次已激活生效，数据已合并应用于看板与指标。</span>
                    ) : (
                      <p className="text-xs text-success-strong">
                        批次已创建为草稿状态。请在下方「批次管理」中点击该批次行并「激活」，数据将按期间合并生效于看板与指标。
                      </p>
                    )}
                  </div>
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
                    <span className={cn(qualityStats.errorRows > 0 && 'font-medium text-destructive')}>
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
              <div className="rounded-lg border border-success/25 bg-success/10 p-2">
                <p className="text-xs text-success-strong">入库记录</p>
                <p className="mt-1 text-xl font-semibold text-success-strong">{qualityStats.successRows}</p>
              </div>
              <div className={cn('rounded-lg border p-2', qualityStats.errorRows > 0 ? 'border-destructive/25 bg-destructive/[0.06]' : 'bg-muted/30')}>
                <p className={cn('text-xs', qualityStats.errorRows > 0 ? 'text-destructive' : 'text-muted-foreground')}>异常记录</p>
                <p className={cn('mt-1 text-xl font-semibold', qualityStats.errorRows > 0 && 'text-destructive')}>{qualityStats.errorRows}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">批次管理</p>
              <span className="text-xs text-muted-foreground">点击批次行查看质量明细{canImport && selectedBatch && selectedBatch.status !== 'active' ? '，可直接激活' : ''}</span>
              {canImport && selectedBatch && selectedBatch.status !== 'active' && (
                <Button size="sm" className="shrink-0" onClick={handleActivate} disabled={activateMutation.isPending}>
                  {activateMutation.isPending ? '激活中...' : '激活批次'}
                </Button>
              )}
              {canImport && selectedBatch && selectedBatch.status === 'active' && (
                <span className="text-xs text-success-strong">当前批次已生效</span>
              )}
              {canImport && selectedCount > 0 && (
                <Button size="sm" className="shrink-0" disabled={batchActivate.isBusy || activateMutation.isPending} onClick={handleBatchActivate}>
                  {batchActivate.isBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle className="mr-1 h-3 w-3" />}
                  批量激活（{selectedCount}）
                </Button>
              )}
              {batchActivate.progress && (
                <span className="text-xs text-muted-foreground">
                  正在激活 {batchActivate.progress.done}/{batchActivate.progress.total}：{batchActivate.progress.currentFilename || '-'}
                </span>
              )}
              {!batchActivate.isBusy && batchActivate.results.size > 0 && (
                <span className="text-xs text-muted-foreground">
                  完成：成功 {[...batchActivate.results.values()].filter((r) => r.status === 'success').length} 个，失败 {[...batchActivate.results.values()].filter((r) => r.status === 'failed').length} 个
                </span>
              )}
            </div>
            {activateMsg && <p className="text-xs text-muted-foreground">{activateMsg}</p>}

            <DataTable
              columns={batchColumns}
              data={recentBatches}
              rowKey={(b) => b.id}
              dense
              maxHeight="320px"
              emptyText="暂无导入批次"
              onRowClick={(b) => { setSelectedBatchId((prev) => (prev === b.id ? null : b.id)); setActivateMsg(null) }}
              rowClassName={(b) => (b.id === selectedBatchId ? 'bg-muted/60' : undefined)}
            />
            {/* 批量激活失败明细（成功项随列表刷新消失，失败项保留展示原因） */}
            {!batchActivate.isBusy && [...batchActivate.results.entries()].some(([, r]) => r.status === 'failed') && (
              <ul className="space-y-0.5 rounded-lg border border-destructive/25 bg-destructive/[0.06] p-2 text-xs text-destructive">
                {[...batchActivate.results.entries()].filter(([, r]) => r.status === 'failed').map(([id, r]) => (
                  <li key={id}>{recentBatches.find((b) => b.id === id)?.filename ?? id}：{r.error}</li>
                ))}
              </ul>
            )}

            {selectedBatch && (
              selectedBatch.errorCount === 0 ? (
                <div className="flex items-center space-x-2 rounded-lg border border-success/25 bg-success/10 p-4">
                  <CheckCircle className="h-4 w-4 text-success" />
                  <span className="text-sm font-medium text-success-strong">
                    完整性校验通过：共 {selectedBatch.detailCount ?? selectedBatch.rowCount ?? selectedBatch.successCount} 条明细均解析成功。
                  </span>
                </div>
              ) : selectedBatch.successCount > 0 ? (
                <div className="flex items-center space-x-2 rounded-lg border border-warning/30 bg-warning/[0.08] p-4">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <span className="text-sm font-medium text-warning-strong">
                    共 {selectedBatch.rowCount ?? selectedBatch.successCount + selectedBatch.errorCount} 行，成功 {selectedBatch.successCount} 行，异常 {selectedBatch.errorCount} 条，请核对下方异常明细。
                  </span>
                </div>
              ) : (
                <div className="flex items-center space-x-2 rounded-lg border border-destructive/25 bg-destructive/[0.06] p-4">
                  <XCircle className="h-4 w-4 text-destructive" />
                  <span className="text-sm font-medium text-destructive">
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
                  maxHeight="280px"
                  emptyText={detailFetching ? '加载中…' : '该批次无解析异常'}
                />
              </div>
            )}
          </CardContent>
        </Collapsible>
      </div>

      {/* 分区三：往来导入覆盖（合并自往来分析「数据质量」目录；仅持有往来查看权限的用户可见） */}
      {canViewTransactions && (
        <div className="border-t">
          <Collapsible
            open={coverageOpen}
            onOpenChange={handleCoverageOpenChange}
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
      {confirmElement}
      <ImportCompareDialog
        open={!!compareSource}
        onOpenChange={(v) => { if (!v) setCompareSource(null) }}
        source={compareSource}
        candidates={compareCandidates}
        onRollbackSuccess={(msg) => setActivateMsg(msg)}
      />
      <TransactionImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </Card>
  )
}
