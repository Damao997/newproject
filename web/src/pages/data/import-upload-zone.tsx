import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { downloadImportTemplate } from '@/lib/import-template'
import { formatMoneyWan, cn } from '@/lib/utils'
import { errorColumns, templateTypeLabel } from './use-import-flow'
import type { ImportPreviewResult, MergedPreviewResult } from '@/lib/api'
import type { ImportBatch } from '@/types'
import {
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Trash2,
} from 'lucide-react'

/** 期间列表友好化：超过 6 个截断并标注总数 */
const fmtPeriods = (ps: string[]) => (ps.length <= 6 ? ps.join('、') : `${ps.slice(0, 6).join('、')} 等 ${ps.length} 个期间`)

interface UploadZoneProps {
  canImport: boolean
  // 模板类型/数值单位/目标财年（来自 useImportFlow）
  templateType: string
  setTemplateType: (v: string) => void
  valueUnit: string
  setValueUnit: (v: string) => void
  budgetFiscalYear: string
  setBudgetFyOverride: (v: string | null) => void
  fyOptions: string[]
  // 文件/预览/导入结果状态
  selectedFile: File | null
  fileError: string | null
  setFileError: (v: string | null) => void
  previewResult: ImportPreviewResult | null
  setPreviewResult: (v: ImportPreviewResult | null) => void
  mergedPreview: MergedPreviewResult | null
  previewing: boolean
  uploading: boolean
  activating: boolean
  uploadedInfo: { batchId: string; filename: string; detailCount: number; rowCount: number } | null
  selectedBatch: ImportBatch | null
  // 往来明细专用多文件导入对话框（主文件挂载）
  setImportOpen: (open: boolean) => void
  // handlers（来自 useImportFlow）
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onUpload: () => Promise<void>
  onCancel: () => void
  onPreview: () => Promise<void>
  onActivate: () => Promise<void>
}

/** 上传与预览区：文件选择/拖放/模板类型/期间/预算覆盖/上传 + 预览结果（警告/抽样/错误/确认导入）+ 导入成功条（从 import-panel.tsx 分区一原样搬迁） */
export function UploadZone(props: UploadZoneProps) {
  const {
    canImport,
    templateType,
    setTemplateType,
    valueUnit,
    setValueUnit,
    budgetFiscalYear,
    setBudgetFyOverride,
    fyOptions,
    selectedFile,
    fileError,
    setFileError,
    previewResult,
    setPreviewResult,
    mergedPreview,
    previewing,
    uploading,
    activating,
    uploadedInfo,
    selectedBatch,
    setImportOpen,
    onFileSelect,
    onDragOver,
    onDrop,
    onUpload,
    onCancel,
    onPreview,
    onActivate,
  } = props

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

  return (
    <>
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
                  <SelectItem value="cashflow">现金流量数据</SelectItem>
                  <SelectItem value="budget">年度预算</SelectItem>
                  <SelectItem value="merged">多表合并（经营/静态/现金流）</SelectItem>
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
              {templateType !== 'transaction' && templateType !== 'merged' && (
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => {
                  downloadImportTemplate(templateType as 'operating' | 'static' | 'cashflow' | 'budget').catch((e) => {
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
              onDragOver={onDragOver}
              onDrop={onDrop}
            >
              <Upload className="h-6 w-6 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-muted-foreground">拖拽 .xlsx 文件到此处，或点击选择文件</p>
                <p className="text-xs text-muted-foreground">支持 .xlsx / .xls，最大 50MB</p>
              </div>
              <input type="file" accept=".xlsx,.xls" className="hidden" id="file-upload" onChange={onFileSelect} />
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
                <Button variant="ghost" size="sm" title="移除文件" onClick={onCancel}>
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="sm" onClick={onPreview} disabled={previewing}>
                  {previewing ? '预览中...' : '预览校验'}
                </Button>
                <Button size="sm" onClick={onUpload} disabled={uploading}>
                  {uploading ? '导入中...' : '确认导入'}
                </Button>
              </div>
            </div>
          )}

          {templateType === 'merged' && mergedPreview && (
            <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <p className="text-sm font-medium">多表合并预览校验结果（未写入，按 Sheet 类型分桶）</p>
              {mergedPreview.ignoredSheets.length > 0 && (
                <p className="text-xs text-warning-strong">
                  未识别 Sheet（已忽略）：{mergedPreview.ignoredSheets.join('、')}。识别规则：Sheet 名须为「经营数据/静态数据/现金流量数据」或以「经营/静态/现金流」开头。
                </p>
              )}
              {(['operating', 'static', 'cashflow'] as const).map((t) => {
                const r = mergedPreview.perType[t]
                if (!r) return null
                return (
                  <div key={t} className="space-y-2 rounded-lg border bg-background p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">{templateTypeLabel[t] ?? t}</Badge>
                      <span className="text-xs text-muted-foreground">
                        数据行 {r.dataRowCount} · 将入库 {r.detailCount} · 异常 {r.errorCount}
                        {r.summary.periodRange.min ? ` · 期间 ${r.summary.periodRange.min} ~ ${r.summary.periodRange.max}` : ''}
                      </span>
                      {r.activationImpact.overlappingPeriods.length > 0 && (
                        <span className="text-xs text-warning-strong">覆盖期间：{fmtPeriods(r.activationImpact.overlappingPeriods)}</span>
                      )}
                    </div>
                    {r.errors.length > 0 && (
                      <p className="text-xs text-destructive">前 {Math.min(r.errors.length, 3)} 条错误：{r.errors.slice(0, 3).map((e) => `第${e.row}行 ${e.message}`).join('；')}</p>
                    )}
                  </div>
                )
              })}
              {Object.keys(mergedPreview.perType).length === 0 && (
                <p className="text-sm text-destructive">未识别到 经营数据/静态数据/现金流量数据 任一 Sheet，请检查文件。</p>
              )}
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
                  <p className="mt-1 text-sm font-medium">{templateTypeLabel[templateType] ?? templateType}</p>
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
                      <Button size="sm" onClick={onActivate} disabled={activating}>
                        {activating ? '激活中...' : '立即激活该批次'}
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
    </>
  )
}
