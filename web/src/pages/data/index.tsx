import { useCallback, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageContainer } from '@/components/layout/page-container'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { usePermission } from '@/hooks/usePermission'
import { useCompanies, useImports, useImport, useCrossTable, useUploadImport, useActivateImport, usePreviewImport } from '@/hooks/api-queries'
import { validateExcelFile } from '@/lib/file-validation'
import { exportToExcel } from '@/lib/export'
import { downloadImportTemplate } from '@/lib/import-template'
import { formatMoney, cn } from '@/lib/utils'
import {
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Trash2,
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

interface ImportErrorRow {
  row: number
  column: string
  message: string
}

export default function DataPage() {
  const { can } = usePermission()
  const canImport = can('data:import', 'upload')
  const canExport = can('data', 'export')

  const [activeTab, setActiveTab] = useState(canImport ? 'import' : 'browse')

  // ---- 导入 ----
  const [templateType, setTemplateType] = useState('operating')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [uploadedInfo, setUploadedInfo] = useState<{ filename: string; successCount: number } | null>(null)
  const uploadMutation = useUploadImport()
  const previewMutation = usePreviewImport()
  const [previewResult, setPreviewResult] = useState<{ dataRowCount: number; errorCount: number; operatingCount: number; staticCount: number; budgetCount: number; errors: { row: number; column: string; message: string }[] } | null>(null)

  // ---- 数据浏览（交叉表：指标 × 公司）----
  const [browseCompany, setBrowseCompany] = useState('all')
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null)
  const { data: companies } = useCompanies()
  const { data: importsData } = useImports({ page: 1, pageSize: 50 })
  const { data: crossTable, isLoading: crossLoading, isFetching: crossFetching } = useCrossTable({})
  const { data: batchDetail, isFetching: detailFetching } = useImport(selectedBatchId)
  const activateMutation = useActivateImport()
  const [activateMsg, setActivateMsg] = useState<string | null>(null)

  const entityCompanies = useMemo(() => (companies ?? []).filter((c) => c.type === 'entity'), [companies])
  const companyNameMap = useMemo(() => new Map((companies ?? []).map((c) => [c.code, c.name])), [companies])
  const recentBatches = useMemo(() => importsData?.items ?? [], [importsData])
  const selectedBatch = useMemo(
    () => recentBatches.find((b) => b.id === selectedBatchId) ?? null,
    [recentBatches, selectedBatchId],
  )

  // 导入质量概览：跨批次聚合关键指标
  const qualityStats = useMemo(() => {
    let totalRows = 0
    let successRows = 0
    let errorRows = 0
    for (const b of recentBatches) {
      const rows = b.rowCount ?? b.successCount + b.errorCount
      totalRows += rows
      successRows += b.successCount
      errorRows += b.errorCount
    }
    return { batchCount: recentBatches.length, totalRows, successRows, errorRows }
  }, [recentBatches])

  // 交叉表列：全部公司或单选公司
  const visibleCompanyCodes = useMemo(() => {
    const all = crossTable?.companies ?? []
    return browseCompany === 'all' ? all : all.filter((c) => c === browseCompany)
  }, [crossTable, browseCompany])

  type CrossRow = { code: string; name: string; values: Record<string, number> }
  const browseColumns: DataTableColumn<CrossRow>[] = useMemo(() => {
    const cols: DataTableColumn<CrossRow>[] = [
      { key: 'name', header: '指标', cellClassName: 'font-medium' },
    ]
    for (const code of visibleCompanyCodes) {
      cols.push({
        key: code,
        header: companyNameMap.get(code) ?? code,
        align: 'right',
        cellClassName: 'font-mono',
        render: (r) => formatMoney(r.values[code] ?? 0),
      })
    }
    return cols
  }, [visibleCompanyCodes, companyNameMap])

  // 异常明细表列
  const errorColumns: DataTableColumn<ImportErrorRow>[] = useMemo(() => [
    { key: 'row', header: '行号', align: 'right', cellClassName: 'font-mono text-muted-foreground', render: (e) => (e.row > 0 ? e.row : '-') },
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
      setUploadedInfo({ filename: batch.filename, successCount: batch.successCount })
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
                <div className="flex items-center space-x-4">
                  <span className="text-sm font-medium">模板类型:</span>
                  <Select value={templateType} onValueChange={(v) => { setTemplateType(v); setPreviewResult(null) }}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue placeholder="选择模板类型" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="operating">经营数据</SelectItem>
                      <SelectItem value="static">静态数据</SelectItem>
                      <SelectItem value="budget">年度预算</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" size="sm" onClick={() => downloadImportTemplate(templateType as 'operating' | 'static' | 'budget')}>
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
                        <p className="text-xs text-muted-foreground">将入库明细</p>
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
                                <td className="p-2 font-mono text-muted-foreground">{e.row > 0 ? e.row : '-'}</td>
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
                    <div className="flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <span className="text-sm font-medium text-green-800">
                        导入成功：《{uploadedInfo.filename}》，解析 {uploadedInfo.successCount} 行（批次已创建为草稿，可在数据浏览激活）
                      </span>
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
            <CardHeader>
              <CardTitle className="flex items-center">
                <AlertTriangle className="mr-2 h-5 w-5" />
                导入质量概览
              </CardTitle>
            </CardHeader>
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
                  <p className="text-xs text-green-700">成功记录</p>
                  <p className="mt-1 text-2xl font-semibold text-green-700">{qualityStats.successRows}</p>
                </div>
                <div className={cn('rounded-lg border p-3', qualityStats.errorRows > 0 ? 'border-red-200 bg-red-50' : 'bg-muted/30')}>
                  <p className={cn('text-xs', qualityStats.errorRows > 0 ? 'text-red-700' : 'text-muted-foreground')}>异常记录</p>
                  <p className={cn('mt-1 text-2xl font-semibold', qualityStats.errorRows > 0 && 'text-red-700')}>{qualityStats.errorRows}</p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium">选择批次:</span>
                <Select value={selectedBatchId ?? 'none'} onValueChange={(v) => { setSelectedBatchId(v === 'none' ? null : v); setActivateMsg(null) }}>
                  <SelectTrigger className="w-[300px]">
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
                  <Button size="sm" onClick={handleActivate} disabled={activateMutation.isPending}>
                    {activateMutation.isPending ? '激活中...' : '激活批次'}
                  </Button>
                )}
                {canImport && selectedBatch && selectedBatch.status === 'active' && (
                  <span className="text-xs text-green-700">当前批次已生效</span>
                )}
              </div>
              {activateMsg && <p className="text-xs text-muted-foreground">{activateMsg}</p>}

              {selectedBatch && (
                selectedBatch.errorCount === 0 ? (
                  <div className="flex items-center space-x-2 rounded-lg border border-green-200 bg-green-50 p-4">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium text-green-800">
                      完整性校验通过：共 {selectedBatch.rowCount ?? selectedBatch.successCount} 行数据均解析成功。
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
                    emptyText={detailFetching ? '加载中...' : '该批次无解析异常'}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* 数据预览交叉表 */}
          <Card>
            <CardHeader>
              <CardTitle>数据预览（指标 × 公司 · 本月实际）</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-4">
                  <Select value={browseCompany} onValueChange={setBrowseCompany}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="选择公司" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部公司</SelectItem>
                      {entityCompanies.map((company) => (
                        <SelectItem key={company.code} value={company.code}>{company.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {canExport && (
                  <Button variant="outline" size="sm" onClick={handleBrowseExport}>
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
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
