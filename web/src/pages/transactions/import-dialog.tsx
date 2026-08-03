import { useRef, useState } from 'react'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn, formatMoneyWan } from '@/lib/utils'
import { usePreviewTransactionImport, useImportTransactions, useActivateImport } from '@/hooks/api-queries'
import { useBatchActivate, buildActivateConflictDescription } from '@/hooks/use-batch-activate'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { validateExcelFile } from '@/lib/file-validation'
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, XCircle, Loader2 } from 'lucide-react'
import type { TransactionImportPreview, TransactionImportUploadResult } from '@/types'

/**
 * 往来数据导入对话框：多文件选择（六大往来账龄汇总表）→ 预览 → 上传入库 → 逐批激活。
 * 文件为 ERP 导出的 CUX_AR/AP 账龄报表（.xls，SpreadsheetML/BIFF 均支持），按 Sheet 名识别往来类型。
 */

type Step = 'select' | 'preview' | 'result'

/**
 * 往来金额展示：ERP 原值单位为元，按往来模块统一约定换算为万元后走全局千分位格式化
 * （与 transactions/index.tsx、analysis-drawer.tsx 的 `formatMoneyWan(v / 10000)` 口径一致）。
 */
function formatAmount(v: number): string {
  return `${formatMoneyWan(v / 10000)} 万`
}

export function TransactionImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [step, setStep] = useState<Step>('select')
  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<TransactionImportPreview[]>([])
  const [results, setResults] = useState<TransactionImportUploadResult[]>([])
  const [activatedIds, setActivatedIds] = useState<Set<string>>(new Set())
  const [errorMsg, setErrorMsg] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { confirm, element: confirmElement } = useConfirm()
  const batchActivate = useBatchActivate()

  const previewMutation = usePreviewTransactionImport()
  const importMutation = useImportTransactions()
  const activateMutation = useActivateImport()

  const reset = () => {
    setStep('select')
    setFiles([])
    setPreviews([])
    setResults([])
    setActivatedIds(new Set())
    setErrorMsg('')
    batchActivate.clear()
  }

  const handleOpenChange = (v: boolean) => {
    if (!v) reset()
    onOpenChange(v)
  }

  const handleFilesSelected = (list: FileList | null) => {
    if (!list) return
    // 逐文件校验扩展名与大小（>50MB 过滤），与数据导入面板口径一致
    const valid: File[] = []
    const invalidMessages: string[] = []
    for (const f of Array.from(list)) {
      const result = validateExcelFile(f)
      if (result.valid) valid.push(f)
      else invalidMessages.push(`${f.name}：${result.message}`)
    }
    setFiles(valid.slice(0, 12))
    setErrorMsg(
      invalidMessages.length > 0
        ? `${invalidMessages.length} 个文件未通过校验（${invalidMessages.join('；')}）`
        : valid.length === 0
          ? '请选择 .xls/.xlsx 文件'
          : '',
    )
  }

  const handlePreview = async () => {
    setErrorMsg('')
    try {
      const data = await previewMutation.mutateAsync(files)
      setPreviews(data)
      setStep('preview')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '预览失败')
    }
  }

  const handleImport = async () => {
    setErrorMsg('')
    try {
      const data = await importMutation.mutateAsync(files)
      setResults(data)
      setStep('result')
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '导入失败')
    }
  }

  const handleActivate = async (batchId: string) => {
    setErrorMsg('')
    try {
      await activateMutation.mutateAsync(batchId)
      setActivatedIds((prev) => new Set(prev).add(batchId))
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '激活失败')
    }
  }

  /** 全部激活：预检冲突 → 确认覆盖风险 → 串行逐个激活（单批失败不中断） */
  const handleActivateAll = async () => {
    const pending = results.filter((r) => r.batch && !activatedIds.has(r.batch.id))
    const batches = pending.map((r) => ({ id: r.batch!.id, filename: r.filename }))
    if (batches.length === 0) return
    setErrorMsg('')
    try {
      const check = await batchActivate.checkConflicts(batches.map((b) => b.id))
      const desc = buildActivateConflictDescription(check)
      if (desc && !(await confirm({ title: '全部激活确认', description: desc, danger: true, confirmText: '全部激活' }))) return
      const summary = await batchActivate.run(batches)
      // 成功批次计入已激活；失败批次保留待用户重试
      const failIds = new Set(summary.failItems.map((f) => f.id))
      const successIds = batches.filter((b) => !failIds.has(b.id)).map((b) => b.id)
      if (successIds.length > 0) setActivatedIds((prev) => new Set([...prev, ...successIds]))
      if (summary.failCount > 0) {
        setErrorMsg(`激活完成：成功 ${summary.successCount} 个，失败 ${summary.failCount} 个（${summary.failItems.map((f) => `${f.filename}：${f.error}`).join('；')}）`)
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '批量激活失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>导入往来数据</DialogTitle>
          <DialogDescription>
            上传六大往来账龄报表（按账龄汇总表解析），支持多文件；上传后需逐批激活生效
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: 选择文件 */}
        {step === 'select' && (
          <div className="space-y-3">
            <div
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed py-10 text-center hover:bg-muted/50"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
              <p className="text-sm">点击选择账龄报表文件（.xls/.xlsx，最多 12 个）</p>
              <p className="mt-1 text-xs text-muted-foreground">按 Sheet 名自动识别 应收/其他应收/预收/应付/其他应付/预付</p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".xls,.xlsx"
                className="hidden"
                onChange={(e) => handleFilesSelected(e.target.files)}
              />
            </div>
            {files.length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                {files.map((f) => (
                  <li key={f.name} className="flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4 shrink-0 text-success" />
                    <span className="truncate">{f.name}</span>
                    <span className="ml-auto shrink-0 text-xs text-muted-foreground">{(f.size / 1024).toFixed(0)} KB</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Step 2: 预览 */}
        {step === 'preview' && (
          <div className="space-y-3">
            {previews.map((p) => (
              <div key={p.filename} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center gap-2 font-medium">
                  {p.errorCount > 0 ? <AlertTriangle className="h-4 w-4 text-warning" /> : <CheckCircle2 className="h-4 w-4 text-success" />}
                  <span className="truncate">{p.filename}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>期间: {p.summary.periods.join(', ') || '-'}</span>
                  <span>公司: {p.summary.companies.join(', ') || '-'}</span>
                  <span>记录: {p.recordCount}</span>
                  <span>客商: {p.summary.counterpartyCount}</span>
                  <span>期末余额合计: {formatAmount(p.summary.totalClosingBalance)}</span>
                  {p.summary.internalCount > 0 && <span>内部往来: {p.summary.internalCount}</span>}
                  {p.summary.duplicateCount > 0 && <span className="text-warning-strong">文件内重复合并: {p.summary.duplicateCount}</span>}
                </div>
                {p.sheets.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.sheets.map((s) => (
                      <span key={s.sheetName} className={cn('rounded px-1.5 py-0.5 text-xs', s.direction === 'AR' ? 'bg-info/10 text-info' : 'bg-destructive/10 text-destructive')}>
                        {s.transactionType} · {s.recordCount} 条{s.cutoffDate ? ` · 截止 ${s.cutoffDate}` : ''}
                      </span>
                    ))}
                  </div>
                )}
                {/* 空模板状态：格式正确但无数据行，激活后将按申报范围标记该期该类型为「无往来数据」 */}
                {p.recordCount === 0 && p.errorCount === 0 && (
                  <p className="mt-2 rounded bg-info/10 px-2 py-1 text-xs text-info">
                    空模板：格式正确但无数据行，激活后将申报覆盖该 公司×期间×往来类型 为「无往来数据」
                  </p>
                )}
                {p.errorCount > 0 && (
                  <div className="mt-2 rounded bg-warning/[0.08] p-2 text-xs text-warning-strong">
                    <p className="font-medium">解析错误 {p.errorCount} 条（错误行将跳过）：</p>
                    <ul className="mt-1 max-h-24 space-y-0.5 overflow-y-auto">
                      {p.errors.slice(0, 10).map((e, i) => (
                        <li key={i}>{e.sheet} 第{e.row}行 {e.column}列: {e.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {p.warningCount > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">另有 {p.warningCount} 条一致性警告（账龄与期末余额差异），不影响入库</p>
                )}
                {/* 激活影响预告：新增/替换的 公司×期间×类型 组合 */}
                {p.activationImpact && (p.activationImpact.newKeys.length > 0 || p.activationImpact.overlappingKeys.length > 0) && (
                  <div className="mt-2 space-y-1 text-xs">
                    {p.activationImpact.newKeys.length > 0 && (
                      <p className="text-muted-foreground">激活后新增 {p.activationImpact.newKeys.length} 个组合：{p.activationImpact.newKeys.slice(0, 3).map((k) => `${k.companyCode} ${k.period} ${k.transactionType}`).join('、')}{p.activationImpact.newKeys.length > 3 ? ' 等' : ''}</p>
                    )}
                    {p.activationImpact.overlappingKeys.length > 0 && (
                      <p className="font-medium text-warning-strong">
                        激活后将替换 {p.activationImpact.overlappingKeys.length} 个已生效组合：
                        {p.activationImpact.overlappingKeys.slice(0, 3).map((k) => `${k.companyCode} ${k.period} ${k.transactionType}(现有${k.existingCount}条)`).join('、')}
                        {p.activationImpact.overlappingKeys.length > 3 ? ' 等' : ''}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Step 3: 上传结果 + 激活 */}
        {step === 'result' && (
          <div className="space-y-2">
            {(() => {
              const pendingCount = results.filter((r) => r.batch && !activatedIds.has(r.batch.id)).length
              const doneCount = [...batchActivate.results.values()].filter((r) => r.status === 'success').length
              const failCount = batchActivate.results.size - doneCount
              return (pendingCount > 0 || batchActivate.isBusy || batchActivate.results.size > 0) && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                  <Button size="sm" className="shrink-0" disabled={batchActivate.isBusy || activateMutation.isPending || pendingCount === 0} onClick={handleActivateAll}>
                    {batchActivate.isBusy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle2 className="mr-1 h-3 w-3" />}
                    全部激活{pendingCount > 0 ? `（${pendingCount}）` : ''}
                  </Button>
                  {batchActivate.progress && (
                    <span className="text-xs text-muted-foreground">
                      正在激活 {batchActivate.progress.done}/{batchActivate.progress.total}：{batchActivate.progress.currentFilename || '-'}
                    </span>
                  )}
                  {!batchActivate.isBusy && batchActivate.results.size > 0 && (
                    <span className="text-xs text-muted-foreground">完成：成功 {doneCount} 个，失败 {failCount} 个</span>
                  )}
                </div>
              )
            })()}
            {results.map((r) => (
              <div key={r.filename} className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                {r.error ? <XCircle className="h-4 w-4 shrink-0 text-destructive" /> : <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate">{r.filename}</p>
                  {r.error ? (
                    <p className="text-xs text-destructive">{r.error}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">入库 {r.batch?.detailCount ?? 0} 条{(r.batch?.errorCount ?? 0) > 0 ? `，错误 ${r.batch?.errorCount} 条` : ''}</p>
                  )}
                </div>
                {r.batch && (() => {
                  const batchResult = batchActivate.results.get(r.batch!.id)
                  const batchActivating = batchActivate.isBusy && batchActivate.progress?.currentId === r.batch!.id
                  if (activatedIds.has(r.batch!.id) || batchResult?.status === 'success') {
                    return <span className="shrink-0 rounded bg-success/10 px-2 py-0.5 text-xs text-success-strong">已激活</span>
                  }
                  if (batchResult?.status === 'failed') {
                    return <span className="shrink-0 max-w-[200px] truncate text-xs text-destructive" title={batchResult.error}>激活失败：{batchResult.error}</span>
                  }
                  return (
                    <Button size="sm" variant="outline" className="shrink-0" disabled={batchActivate.isBusy || activateMutation.isPending} onClick={() => handleActivate(r.batch!.id)}>
                      {batchActivating || (activateMutation.isPending && !batchActivate.isBusy) ? <Loader2 className="h-3 w-3 animate-spin" /> : '激活'}
                    </Button>
                  )
                })()}
              </div>
            ))}
            <p className="text-xs text-muted-foreground">激活后按 公司 × 期间 × 往来类型 替换旧生效数据；未激活批次不参与分析，可稍后在「导入覆盖」Tab 中查看并激活。</p>
          </div>
        )}

        {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}

        {confirmElement}

        <DialogFooter>
          {step === 'select' && (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>取消</Button>
              <Button disabled={files.length === 0 || previewMutation.isPending} onClick={handlePreview}>
                {previewMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                解析预览
              </Button>
            </>
          )}
          {step === 'preview' && (
            <>
              <Button variant="outline" onClick={() => setStep('select')}>上一步</Button>
              <Button disabled={importMutation.isPending} onClick={handleImport}>
                {importMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
                确认导入
              </Button>
            </>
          )}
          {step === 'result' && (
            <Button onClick={() => handleOpenChange(false)}>完成</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
