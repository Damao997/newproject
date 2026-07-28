import { useCallback, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MonthPicker } from '@/components/ui/month-picker'
import { PageContainer } from '@/components/layout/page-container'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { usePermission } from '@/hooks/usePermission'
import { useCompanies, useImports, useImport, useCrossTable, useUploadImport, useActivateImport, usePreviewImport, useArchiveImport, usePurgeImport, useAvailablePeriods } from '@/hooks/api-queries'
import { validateExcelFile } from '@/lib/file-validation'
import { exportToExcel } from '@/lib/export'
import { downloadImportTemplate } from '@/lib/import-template'
import { type ImportPreviewResult } from '@/lib/api'
import { formatMoneyWan, formatMetricValue, cn } from '@/lib/utils'
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
import { SubjectTreePanel } from '@/components/subject-tree/subject-tree-panel'
import { CompanyPanel } from '@/components/dimension/company-panel'
import { AggregationMapPanel } from '@/components/dimension/aggregation-map-panel'
import { FormulaMaintenance } from './formula-maintenance'

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

interface ImportErrorRow {
  row: number
  column: string
  message: string
}

export default function DataPage() {
  const { can } = usePermission()
  const canImport = can('data:import', 'upload')
  const canExport = can('data', 'export')
  // 高危操作（仅 superadmin 持有对应权限码）
  const canArchive = can('data:import', 'archive')
  const canPurgeBatch = can('data:import', 'purge')
  const canPurgeMetric = can('data:metric', 'purge')
  const canApproveMetric = can('data:metric', 'approve')
  const { confirm, element: confirmElement } = useConfirm()

  const [activeTab, setActiveTab] = useState(canImport ? 'import' : 'browse')

  // 导入质量概览折叠偏好：localStorage 持久化（'1' = 收起），读写失败静默降级为展开
  const QUALITY_COLLAPSED_KEY = 'data-quality-overview-collapsed'
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

  // ---- 数据浏览（交叉表：指标 × 公司）----
  // 公司多选：空数组语义为「全部公司」
  const [browseCompanies, setBrowseCompanies] = useState<string[]>([])
  const [browsePeriod, setBrowsePeriod] = useState('')
  const [browseSubjectType, setBrowseSubjectType] = useState<'operating' | 'static'>('operating')
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const { data: companies } = useCompanies()
  const { data: importsData } = useImports({ page: 1, pageSize: 50 })
  const { data: dynamicPeriods } = useAvailablePeriods()
  const crossParams = useMemo(() => ({
    ...(browsePeriod ? { period: browsePeriod } : {}),
    subjectType: browseSubjectType,
  }), [browsePeriod, browseSubjectType])
  const { data: crossTable, isLoading: crossLoading, isFetching: crossFetching } = useCrossTable(crossParams)
  const { data: batchDetail, isFetching: detailFetching } = useImport(selectedBatchId)
  const activateMutation = useActivateImport()
  const archiveMutation = useArchiveImport()
  const purgeMutation = usePurgeImport()
  const [activateMsg, setActivateMsg] = useState<string | null>(null)

  const entityCompanies = useMemo(() => (companies ?? []).filter((c) => c.type === 'entity'), [companies])
  const companyNameMap = useMemo(() => new Map((companies ?? []).map((c) => [c.code, c.name])), [companies])
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

  // 交叉表列：未勾选时展示全部公司，否则按交叉表返回顺序过滤已选公司
  const visibleCompanyCodes = useMemo(() => {
    const all = crossTable?.companies ?? []
    return browseCompanies.length === 0 ? all : all.filter((c) => browseCompanies.includes(c))
  }, [crossTable, browseCompanies])

  // 公司多选触发按钮文案：全部 / 单选名称 / 首选名称 等 N 家
  const companyTriggerLabel = useMemo(() => {
    if (browseCompanies.length === 0) return '全部公司'
    const firstName = companyNameMap.get(browseCompanies[0]) ?? browseCompanies[0]
    return browseCompanies.length === 1 ? firstName : `${firstName} 等 ${browseCompanies.length} 家`
  }, [browseCompanies, companyNameMap])

  const toggleBrowseCompany = (code: string, checked: boolean) => {
    setBrowseCompanies((prev) => (checked ? [...prev, code] : prev.filter((c) => c !== code)))
  }

  type CrossRow = { code: string; name: string; valueType?: 'amount' | 'quantity' | 'ratio'; values: Record<string, number> }
  const browseColumns: DataTableColumn<CrossRow>[] = useMemo(() => {
    const cols: DataTableColumn<CrossRow>[] = [
      { key: 'name', header: '指标', cellClassName: 'font-medium', sticky: true },
    ]
    for (const code of visibleCompanyCodes) {
      cols.push({
        key: code,
        header: companyNameMap.get(code) ?? code,
        align: 'right',
        cellClassName: 'font-num',
        // 按科目值类型渲染：金额千分位 / 数量整数 / 比率百分比
        render: (r) => formatMetricValue(r.values[code] ?? 0, r.valueType),
      })
    }
    return cols
  }, [visibleCompanyCodes, companyNameMap])

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

  const handleBrowseExport = async () => {
    const rows = (crossTable?.rows ?? []).map((r) => {
      const row: Record<string, unknown> = { name: r.name }
      for (const code of visibleCompanyCodes) row[code] = Number((r.values[code] ?? 0).toFixed(2))
      return row
    })
    await exportToExcel({
      filename: `数据明细_${new Date().toISOString().slice(0, 10)}.xlsx`,
      sheetName: '数据明细',
      columns: [
        { header: '指标', key: 'name', width: 20 },
        ...visibleCompanyCodes.map((code) => ({ header: companyNameMap.get(code) ?? code, key: code, width: 16 })),
      ],
      rows,
    })
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
    <PageContainer title="数据管理" description="管理Excel导入、数据浏览、维度科目维护">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="animate-fade-in">
        <TabsList>
          {canImport && <TabsTrigger value="import">数据导入</TabsTrigger>}
          <TabsTrigger value="browse">数据预览</TabsTrigger>
          <TabsTrigger value="dimensions">维度/科目体系</TabsTrigger>
          <TabsTrigger value="formulas">公式维护</TabsTrigger>
        </TabsList>

        {canImport && (
          <TabsContent value="import" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <FileSpreadsheet className="mr-2 h-5 w-5" />
                  数据导入
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium">模板类型:</span>
                  <Select value={templateType} onValueChange={(v) => { setTemplateType(v); setPreviewResult(null) }}>
                    <SelectTrigger className="w-[200px] max-w-full shrink-0">
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
                </div>

                <div
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 transition-colors hover:border-primary/50 hover:bg-muted/50"
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                >
                  <Upload className="mb-4 h-12 w-12 text-muted-foreground" />
                  <p className="mb-2 text-sm text-muted-foreground">拖拽 .xlsx 文件到此处，或点击选择文件</p>
                  <p className="mb-4 text-xs text-muted-foreground">支持 .xlsx / .xls，最大 50MB</p>
                  <input type="file" accept=".xlsx,.xls" className="hidden" id="file-upload" onChange={handleFileSelect} />
                  <label htmlFor="file-upload">
                    <Button variant="outline" size="sm" asChild>
                      <span>选择文件</span>
                    </Button>
                  </label>
                </div>

                {fileError && (
                  <div className="flex items-center space-x-2 rounded-lg border border-red-200 bg-red-50 p-4">
                    <XCircle className="h-4 w-4 text-red-500" />
                    <span className="text-sm font-medium text-red-700">{fileError}</span>
                  </div>
                )}

                {selectedFile && (
                  <div className="flex items-center justify-between rounded-lg border bg-muted/50 p-4">
                    <div className="flex items-center space-x-3">
                      <FileSpreadsheet className="h-8 w-8 text-green-500" />
                      <div>
                        <p className="text-sm font-medium">{selectedFile.name}</p>
                        <p className="text-xs text-muted-foreground">{(selectedFile.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={handleCancel}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}

                {selectedFile && (
                  <div className="flex items-center justify-end space-x-2">
                    <Button variant="outline" onClick={handleCancel}>取消</Button>
                    <Button variant="outline" onClick={handlePreview} disabled={previewMutation.isPending}>
                      {previewMutation.isPending ? '预览中...' : '预览校验'}
                    </Button>
                    <Button onClick={handleUpload} disabled={uploadMutation.isPending}>
                      {uploadMutation.isPending ? '导入中...' : '确认导入'}
                    </Button>
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
                        <p className="text-xs text-muted-foreground">将入库明细{(previewResult.summary?.duplicateCount ?? 0) > 0 ? '（去重后）' : ''}</p>
                        <p className="mt-1 text-xl font-semibold">{previewResult.operatingCount + previewResult.staticCount + previewResult.budgetCount - (previewResult.summary?.duplicateCount ?? 0)}</p>
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
                    {/* 风险/影响提示区（按严重度排序：重复 > KPI 缺类 > 期间消失 > 期间替换 > 零值） */}
                    {previewResult.summary && previewResult.summary.duplicateCount > 0 && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <div className="flex items-start space-x-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-amber-800">
                              文件内存在 {previewResult.summary.duplicateCount} 条重复记录（同公司+科目+期间），入库时将自动跳过。
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
                    {previewResult.activationImpact?.activeBatch && previewResult.activationImpact.vanishingPeriods.length > 0 && (
                      <div className="flex items-start space-x-2 rounded-lg border border-red-200 bg-red-50 p-3">
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                        <p className="text-sm font-medium text-red-700">
                          当前生效批次《{previewResult.activationImpact.activeBatch.filename}》包含期间 {fmtPeriods(previewResult.activationImpact.vanishingPeriods)}，本文件未包含；激活后这些期间将从看板与指标中消失。
                        </p>
                      </div>
                    )}
                    {previewResult.activationImpact?.activeBatch && previewResult.activationImpact.overlappingPeriods.length > 0 && (
                      <div className="flex items-start space-x-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
                        <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                        <p className="text-sm text-blue-800">
                          {templateType === 'budget'
                            ? `激活后将替换《${previewResult.activationImpact.activeBatch.filename}》的 ${fmtPeriods(previewResult.activationImpact.overlappingPeriods)} 财年预算。`
                            : `激活后将替换《${previewResult.activationImpact.activeBatch.filename}》中期间 ${fmtPeriods(previewResult.activationImpact.overlappingPeriods)} 的数据。`}
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
                                  <th key={i} className="whitespace-nowrap p-2 text-left font-medium">{h}</th>
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
                              <th className="p-2 text-left font-medium">行号</th>
                              <th className="p-2 text-left font-medium">列</th>
                              <th className="p-2 text-left font-medium">错误信息</th>
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
                          批次已创建为草稿状态。请前往「数据预览」标签页 → 选择该批次 → 点击「激活批次」使数据在看板和指标中生效。
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="mt-1 border-green-300 text-green-800 hover:bg-green-100"
                          onClick={() => setActiveTab('browse')}
                        >
                          前往数据预览
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="browse" className="space-y-4">
          {/* 导入质量概览 + 完整性验证 + 异常明细 */}
          <Card>
            <Collapsible
              open={qualityOpen}
              onOpenChange={handleQualityOpenChange}
              trigger={(open) => (
                <span className="flex flex-wrap items-center justify-between gap-2 p-6">
                  <span className="flex items-center text-2xl font-semibold leading-none tracking-tight">
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
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">导入批次</p>
                  <p className="mt-1 text-2xl font-semibold">{qualityStats.batchCount}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">总记录数</p>
                  <p className="mt-1 text-2xl font-semibold">{qualityStats.totalRows}</p>
                </div>
                <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                  <p className="text-xs text-green-700">入库记录</p>
                  <p className="mt-1 text-2xl font-semibold text-green-700">{qualityStats.successRows}</p>
                </div>
                <div className={cn('rounded-lg border p-3', qualityStats.errorRows > 0 ? 'border-red-200 bg-red-50' : 'bg-muted/30')}>
                  <p className={cn('text-xs', qualityStats.errorRows > 0 ? 'text-red-700' : 'text-muted-foreground')}>异常记录</p>
                  <p className={cn('mt-1 text-2xl font-semibold', qualityStats.errorRows > 0 && 'text-red-700')}>{qualityStats.errorRows}</p>
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
          </Card>

          {/* 数据预览交叉表 */}
          <Card>
            <CardHeader>
              <CardTitle>数据预览（{browseSubjectType === 'operating' ? '经营指标' : '静态指标'} × 公司{crossTable?.period ? ` · ${crossTable.period}` : ''}）</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Select value={browseSubjectType} onValueChange={(v) => setBrowseSubjectType(v as 'operating' | 'static')}>
                    <SelectTrigger className="w-[140px] max-w-full shrink-0">
                      <SelectValue placeholder="指标类型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="operating">经营指标</SelectItem>
                      <SelectItem value="static">静态指标</SelectItem>
                    </SelectContent>
                  </Select>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" className="h-9 w-[200px] max-w-full shrink-0 justify-between px-3 font-normal">
                        <span className="truncate">{companyTriggerLabel}</span>
                        <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="max-h-[320px] w-[220px] overflow-y-auto">
                      <DropdownMenuItem
                        className="text-xs text-muted-foreground"
                        onSelect={(e) => { e.preventDefault(); setBrowseCompanies(entityCompanies.map((c) => c.code)) }}
                      >
                        全选
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-xs text-muted-foreground"
                        onSelect={(e) => { e.preventDefault(); setBrowseCompanies([]) }}
                      >
                        清空（全部公司）
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {entityCompanies.map((company) => (
                        <DropdownMenuCheckboxItem
                          key={company.code}
                          checked={browseCompanies.includes(company.code)}
                          onCheckedChange={(checked) => toggleBrowseCompany(company.code, checked === true)}
                          onSelect={(e) => e.preventDefault()}
                        >
                          {company.name}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div className="flex shrink-0 items-center space-x-2">
                    <span className="text-sm text-muted-foreground">月份:</span>
                    <MonthPicker value={browsePeriod} onChange={setBrowsePeriod} availablePeriods={dynamicPeriods ?? []} />
                  </div>
                </div>
                {canExport && (
                  <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={handleBrowseExport}>
                    <Download className="mr-2 h-4 w-4" />
                    导出
                  </Button>
                )}
              </div>
              {crossLoading ? (
                <div className="min-h-[320px] py-12 text-center text-sm text-muted-foreground">数据加载中...</div>
              ) : (
                <div className={cn('min-h-[320px] transition-opacity duration-200', crossFetching && 'opacity-60')}>
                  <DataTable
                    columns={browseColumns}
                    data={(crossTable?.rows ?? []) as CrossRow[]}
                    rowKey={(r) => r.code}
                    dense
                    maxHeight="60vh"
                    emptyText="暂无数据"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dimensions" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>维度/科目体系</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="operating" className="space-y-4">
                <TabsList>
                  <TabsTrigger value="operating">经营分析科目</TabsTrigger>
                  <TabsTrigger value="static">静态科目</TabsTrigger>
                  <TabsTrigger value="company">公司</TabsTrigger>
                  <TabsTrigger value="summary">汇总主体</TabsTrigger>
                </TabsList>
                <TabsContent value="operating">
                  <SubjectTreePanel
                    type="operating"
                    canCreate={can('data:subject', 'create')}
                    canUpdate={can('data:subject', 'update')}
                    canDelete={can('data:subject', 'delete')}
                    canExport={canExport}
                    exportFileName="经营分析科目"
                    exportSheet="经营分析科目"
                    countSuffix="（level0-level4）"
                  />
                </TabsContent>
                <TabsContent value="static">
                  <SubjectTreePanel
                    type="static"
                    canCreate={can('data:subject', 'create')}
                    canUpdate={can('data:subject', 'update')}
                    canDelete={can('data:subject', 'delete')}
                    canExport={canExport}
                    exportFileName="静态科目"
                    exportSheet="静态科目"
                    countSuffix="（level0-level1）"
                  />
                </TabsContent>
                <TabsContent value="company">
                  <CompanyPanel
                    canCreate={can('data:company', 'create')}
                    canUpdate={can('data:company', 'update')}
                    canDelete={can('data:company', 'delete')}
                  />
                </TabsContent>
                <TabsContent value="summary">
                  <AggregationMapPanel canUpdate={can('data:company', 'update')} />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="formulas" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>公式维护</CardTitle>
            </CardHeader>
            <CardContent>
              <FormulaMaintenance
                canCreate={can('data:metric', 'create')}
                canUpdate={can('data:metric', 'update')}
                canDelete={can('data:metric', 'delete')}
                canManageRule={can('data:formula-rule', 'manage')}
                canApprove={canApproveMetric}
                canPurge={canPurgeMetric}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      {confirmElement}
    </PageContainer>
  )
}
