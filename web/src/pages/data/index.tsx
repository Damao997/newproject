import { useState, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageContainer } from '@/components/layout/page-container'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { Pagination } from '@/components/data-table/pagination'
import { usePermission } from '@/hooks/usePermission'
import { validateExcelFile } from '@/lib/file-validation'
import { exportToExcel } from '@/lib/export'
import { formatMoney } from '@/lib/utils'
import { PAGINATION } from '@/lib/constants'
import { 
  Upload, 
  Download, 
  FileSpreadsheet, 
  CheckCircle, 
  XCircle,
  AlertTriangle,
  Trash2
} from 'lucide-react'
import { mockImportBatches, mockCompanies } from '@/mock/data'
import type { ImportError } from '@/types'
import { SubjectTreePanel } from '@/components/subject-tree/subject-tree-panel'
import { FormulaMaintenance } from './formula-maintenance'
import {
  operatingAnalysisTree,
  operatingAnalysisFlat,
  staticAnalysisTree,
  staticAnalysisFlat,
} from '@/lib/subject-tree'

// Mock 数据浏览明细
const mockBrowseData = [
  { id: 1, company: '杭州分公司', companyCode: 'EN330059', account: '灶具收入', accountCode: 'OP_025', period: '2025-06', value: 120000 },
  { id: 2, company: '宁波分公司', companyCode: 'EN330060', account: '灶具收入', accountCode: 'OP_025', period: '2025-06', value: 95000 },
  { id: 3, company: '温州分公司', companyCode: 'EN330061', account: '灶具收入', accountCode: 'OP_025', period: '2025-06', value: 85000 },
  { id: 4, company: '杭州分公司', companyCode: 'EN330059', account: '主营业务成本', accountCode: 'OP_030', period: '2025-06', value: 80000 },
  { id: 5, company: '宁波分公司', companyCode: 'EN330060', account: '主营业务成本', accountCode: 'OP_030', period: '2025-06', value: 62000 },
  { id: 6, company: '温州分公司', companyCode: 'EN330061', account: '主营业务成本', accountCode: 'OP_030', period: '2025-06', value: 55000 },
  { id: 7, company: '广州分公司', companyCode: 'EN330062', account: '灶具收入', accountCode: 'OP_025', period: '2025-06', value: 110000 },
  { id: 8, company: '深圳分公司', companyCode: 'EN330063', account: '灶具收入', accountCode: 'OP_025', period: '2025-06', value: 98000 },
]

type BrowseRow = (typeof mockBrowseData)[number]

const BROWSE_PAGE_SIZE = PAGINATION.DEFAULT_PAGE_SIZE

export default function DataPage() {
  const { can } = usePermission()
  const canImport = can('data:import', 'upload')
  const canExport = can('data', 'export')
  const canManageMetric =
    can('data:metric', 'create') || can('data:metric', 'update') || can('data:metric', 'delete')

  const [activeTab, setActiveTab] = useState(canImport ? 'import' : 'browse')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [previewData, setPreviewData] = useState<any[]>([])
  const [validationResult, setValidationResult] = useState<{
    success: number
    errors: ImportError[]
  } | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadSuccess, setUploadSuccess] = useState(false)

  // 数据浏览筛选与分页
  const [browseCompany, setBrowseCompany] = useState('all')
  const [browsePage, setBrowsePage] = useState(1)

  const filteredBrowseData = useMemo(
    () =>
      mockBrowseData.filter((row) => browseCompany === 'all' || row.companyCode === browseCompany),
    [browseCompany],
  )
  const pagedBrowseData = filteredBrowseData.slice(
    (browsePage - 1) * BROWSE_PAGE_SIZE,
    browsePage * BROWSE_PAGE_SIZE,
  )

  const browseColumns: DataTableColumn<BrowseRow>[] = [
    { key: 'company', header: '公司', cellClassName: 'font-medium' },
    { key: 'account', header: '科目' },
    { key: 'accountCode', header: '科目编码', cellClassName: 'font-mono text-muted-foreground' },
    { key: 'period', header: '期间', cellClassName: 'text-muted-foreground' },
    { key: 'value', header: '金额', align: 'right', cellClassName: 'font-mono', render: (r) => formatMoney(r.value / 10000) },
  ]

  // 从选中文件生成预览与校验结果（mock）
  const applyMockPreview = () => {
    setPreviewData([
      { id: 1, company: '杭州壹品慧', period: '2025-06', OP_025: 120000, OP_030: 80000 },
      { id: 2, company: '宁波壹品慧', period: '2025-06', OP_025: 95000, OP_030: 62000 },
      { id: 3, company: '温州壹品慧', period: '2025-06', OP_025: 85000, OP_030: 55000 },
    ])
    setValidationResult({
      success: 140,
      errors: [
        { row: 45, column: '本月收入', message: "值非数字 'N/A'" },
        { row: 92, column: '公司名', message: "公司编码未找到 '未知公司'" },
      ],
    })
  }

  const acceptFile = (file: File) => {
    const result = validateExcelFile(file)
    if (!result.valid) {
      setFileError(result.message ?? '文件校验失败')
      setSelectedFile(null)
      setPreviewData([])
      setValidationResult(null)
      return
    }
    setFileError(null)
    setSelectedFile(file)
    applyMockPreview()
  }

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) acceptFile(file)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) acceptFile(file)
  }, [])

  const handleUpload = async () => {
    setIsUploading(true)
    // 模拟上传延迟
    await new Promise(resolve => setTimeout(resolve, 2000))
    setIsUploading(false)
    setUploadSuccess(true)
  }

  const handleCancel = () => {
    setSelectedFile(null)
    setFileError(null)
    setPreviewData([])
    setValidationResult(null)
    setUploadSuccess(false)
  }

  const handleDownloadTemplate = (type: string) => {
    console.log('下载模板:', type)
  }

  const handleBrowseExport = async () => {
    await exportToExcel({
      filename: `数据明细_${new Date().toISOString().slice(0, 10)}.xlsx`,
      sheetName: '数据明细',
      columns: [
        { header: '公司', key: 'company', width: 16 },
        { header: '科目', key: 'account', width: 16 },
        { header: '科目编码', key: 'accountCode', width: 14 },
        { header: '期间', key: 'period', width: 12 },
        { header: '金额(万)', key: 'value', width: 16 },
      ],
      rows: filteredBrowseData.map((r) => ({
        company: r.company,
        account: r.account,
        accountCode: r.accountCode,
        period: r.period,
        value: Number((r.value / 10000).toFixed(2)),
      })),
    })
  }

  return (
    <PageContainer
      title="数据管理"
      description="管理Excel导入、数据浏览、维度科目维护"
    >
      <Tabs value={activeTab} onValueChange={setActiveTab} className="animate-fade-in">
        <TabsList>
          {canImport && <TabsTrigger value="import">数据导入</TabsTrigger>}
          <TabsTrigger value="browse">数据浏览</TabsTrigger>
          <TabsTrigger value="dimensions">维度/科目体系</TabsTrigger>
          <TabsTrigger value="formulas">公式维护</TabsTrigger>
        </TabsList>

        {canImport && (
        <TabsContent value="import" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center">
                  <FileSpreadsheet className="mr-2 h-5 w-5" />
                  数据导入
                </CardTitle>
                <div className="flex items-center space-x-2">
                  <Button variant="outline" size="sm" onClick={() => handleDownloadTemplate('operating')}>
                    <Download className="mr-2 h-4 w-4" />
                    下载模板
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 模板类型选择 */}
              <div className="flex items-center space-x-4">
                <span className="text-sm font-medium">模板类型:</span>
                <Select defaultValue="operating">
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="选择模板类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="operating">经营数据</SelectItem>
                    <SelectItem value="static">静态数据</SelectItem>
                    <SelectItem value="budget">年度预算</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 拖拽上传区 */}
              <div
                className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 p-8 transition-colors hover:border-primary/50 hover:bg-muted/50"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              >
                <Upload className="mb-4 h-12 w-12 text-muted-foreground" />
                <p className="mb-2 text-sm text-muted-foreground">
                  拖拽 .xlsx 文件到此处，或点击选择文件
                </p>
                <p className="mb-4 text-xs text-muted-foreground">
                  支持 .xlsx / .xls，最大 50MB
                </p>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  id="file-upload"
                  onChange={handleFileSelect}
                />
                <label htmlFor="file-upload">
                  <Button variant="outline" size="sm" asChild>
                    <span>选择文件</span>
                  </Button>
                </label>
              </div>

              {/* 文件校验错误 */}
              {fileError && (
                <div className="flex items-center space-x-2 rounded-lg border border-red-200 bg-red-50 p-4">
                  <XCircle className="h-4 w-4 text-red-500" />
                  <span className="text-sm font-medium text-red-700">{fileError}</span>
                </div>
              )}

              {/* 文件信息 */}
              {selectedFile && (
                <div className="flex items-center justify-between rounded-lg border bg-muted/50 p-4">
                  <div className="flex items-center space-x-3">
                    <FileSpreadsheet className="h-8 w-8 text-green-500" />
                    <div>
                      <p className="text-sm font-medium">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                      </p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm" onClick={handleCancel}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}

              {/* 数据预览 */}
              {previewData.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">数据预览（首 100 行）</h4>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="p-2 text-left font-medium">#</th>
                          <th className="p-2 text-left font-medium">公司名</th>
                          <th className="p-2 text-left font-medium">月份</th>
                          <th className="p-2 text-right font-medium">OP_025 收入</th>
                          <th className="p-2 text-right font-medium">OP_030 成本</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.map((row) => (
                          <tr key={row.id} className="border-b">
                            <td className="p-2">{row.id}</td>
                            <td className="p-2">{row.company}</td>
                            <td className="p-2">{row.period}</td>
                            <td className="p-2 text-right font-mono">{row.OP_025.toLocaleString()}</td>
                            <td className="p-2 text-right font-mono">{row.OP_030.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* 校验结果 */}
              {validationResult && (
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium">
                      校验结果: {validationResult.success} 行通过
                    </span>
                    {validationResult.errors.length > 0 && (
                      <>
                        <XCircle className="h-4 w-4 text-red-500" />
                        <span className="text-sm font-medium text-red-500">
                          {validationResult.errors.length} 行错误
                        </span>
                      </>
                    )}
                  </div>

                  {validationResult.errors.length > 0 && (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                      <h4 className="mb-2 text-sm font-medium text-red-800">错误详情</h4>
                      <div className="space-y-2">
                        {validationResult.errors.map((error, index) => (
                          <div key={index} className="flex items-start space-x-2 text-sm">
                            <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5" />
                            <span className="text-red-700">
                              第 {error.row} 行 "{error.column}" 列: {error.message}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 操作按钮 */}
              {selectedFile && (
                <div className="flex items-center justify-end space-x-2">
                  <Button variant="outline" onClick={handleCancel}>
                    取消
                  </Button>
                  <Button 
                    onClick={handleUpload} 
                    disabled={isUploading || validationResult?.errors.length === 0}
                  >
                    {isUploading ? '导入中...' : '确认导入'}
                  </Button>
                </div>
              )}

              {/* 上传成功提示 */}
              {uploadSuccess && (
                <div className="rounded-lg border border-green-200 bg-green-50 p-4">
                  <div className="flex items-center space-x-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm font-medium text-green-800">
                      导入成功！已导入 {validationResult?.success} 行数据
                    </span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        )}

        <TabsContent value="browse" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>数据浏览</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-4">
                  <Select defaultValue="all">
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="选择批次" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部批次</SelectItem>
                      {mockImportBatches.filter(b => b.status === 'active').map(batch => (
                        <SelectItem key={batch.id} value={batch.id}>
                          {batch.filename}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={browseCompany}
                    onValueChange={(v) => { setBrowseCompany(v); setBrowsePage(1) }}
                  >
                    <SelectTrigger className="w-[180px]">
                      <SelectValue placeholder="选择公司" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部公司</SelectItem>
                      {mockCompanies.filter(c => c.type === 'entity').map(company => (
                        <SelectItem key={company.code} value={company.code}>
                          {company.name}
                        </SelectItem>
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
              <DataTable
                columns={browseColumns}
                data={pagedBrowseData}
                rowKey={(r) => r.id}
                emptyText="暂无数据"
              />
              <div className="mt-4">
                <Pagination
                  page={browsePage}
                  pageSize={BROWSE_PAGE_SIZE}
                  total={filteredBrowseData.length}
                  onPageChange={setBrowsePage}
                />
              </div>
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
                </TabsList>
                <TabsContent value="operating">
                  <SubjectTreePanel
                    tree={operatingAnalysisTree}
                    flat={operatingAnalysisFlat}
                    canExport={canExport}
                    exportFileName="经营分析科目"
                    exportSheet="经营分析科目"
                    countSuffix="（level0-level4）"
                  />
                </TabsContent>
                <TabsContent value="static">
                  <SubjectTreePanel
                    tree={staticAnalysisTree}
                    flat={staticAnalysisFlat}
                    canExport={canExport}
                    exportFileName="静态科目"
                    exportSheet="静态科目"
                    countSuffix="（level0-level1）"
                  />
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
              <FormulaMaintenance canManage={canManageMetric} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
