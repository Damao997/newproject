import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { AlertTriangle, CheckCircle2, Loader2, Plus, Trash2, XCircle } from 'lucide-react'

/** 单行批量提交状态（随提交进度逐行更新） */
export interface BatchRowStatus {
  state: 'pending' | 'success' | 'error'
  message?: string
}

/** 批量操作结果提示数据 */
export interface BatchOpMessageData {
  type: 'success' | 'warning'
  text: string
}

/** 批量操作结果提示条（成功 / 部分失败） */
export function BatchOpMessage({ message, onDismiss }: { message: BatchOpMessageData | null; onDismiss?: () => void }) {
  if (!message) return null
  const warning = message.type === 'warning'
  return (
    <p
      className={cn(
        'flex items-start gap-1.5 text-xs',
        warning ? 'text-warning-strong' : 'text-success-strong',
      )}
      role="status"
    >
      {warning ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span className="flex-1">{message.text}</span>
      {onDismiss && (
        <button type="button" className="shrink-0 text-muted-foreground hover:text-foreground" onClick={onDismiss}>收起</button>
      )}
    </p>
  )
}

interface BatchRowsDialogProps<T> {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  /** 新建一行的初始值 */
  createEmptyRow: () => T
  /** 单行字段渲染；invalid=true 时字段应呈现错误态（行级错误显示在行尾） */
  renderRowFields: (
    row: T,
    index: number,
    patch: (patch: Partial<T>) => void,
    invalid: boolean,
    submitting: boolean,
  ) => ReactNode
  /** 行级校验：返回错误文案；null 表示通过（allRows 用于行间重复校验） */
  validateRow: (row: T, index: number, allRows: T[]) => string | null
  /** 提交待创建行（建议顺序执行）；返回与入参对齐的行级错误（null=成功） */
  submitRows: (rows: T[]) => Promise<(string | null)[]>
  maxRows?: number
}

const DEFAULT_MAX_ROWS = 50

/**
 * 多行表单批量新增对话框（映射管理通用）：
 * - 动态增/删行，逐行填写 + 行级校验（含行间重复检测）；
 * - 提交时仅提交未成功行（已成功行跳过，便于失败修正后重试）；
 * - 逐行反馈结果（✓ 成功 / ✗ 失败原因），全部成功后自动关闭。
 * 数据层复用各面板现有单条 create 接口（前端循环，无后端批量端点）。
 */
export function BatchRowsDialog<T>({
  open, onOpenChange, title, description, createEmptyRow, renderRowFields, validateRow, submitRows, maxRows = DEFAULT_MAX_ROWS,
}: BatchRowsDialogProps<T>) {
  const [rows, setRows] = useState<T[]>([])
  const [statuses, setStatuses] = useState<BatchRowStatus[]>([])
  const [submitting, setSubmitting] = useState(false)

  // 打开时重置为一行空行（createEmptyRow 由面板内联定义，重置仅依赖 open）
  useEffect(() => {
    if (open) {
      setRows([createEmptyRow()])
      setStatuses([{ state: 'pending' }])
      setSubmitting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在 open 变化时重置
  }, [open])

  const patchRow = (index: number, patch: Partial<T>) => {
    setRows((rs) => rs.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  const addRow = () => {
    if (rows.length >= maxRows) return
    setRows((rs) => [...rs, createEmptyRow()])
    setStatuses((ss) => [...ss, { state: 'pending' }])
  }

  const removeRow = (index: number) => {
    setRows((rs) => rs.filter((_, i) => i !== index))
    setStatuses((ss) => ss.filter((_, i) => i !== index))
  }

  const successCount = statuses.filter((s) => s.state === 'success').length
  const pendingCount = rows.length - successCount

  const handleSubmit = async () => {
    if (submitting || pendingCount === 0) return
    // 校验所有未成功行（已成功行跳过）
    const errors: (string | null)[] = []
    let hasInvalid = false
    rows.forEach((row, index) => {
      if (statuses[index]?.state === 'success') {
        errors.push(null)
        return
      }
      const msg = validateRow(row, index, rows)
      if (msg) hasInvalid = true
      errors.push(msg)
    })
    setStatuses(rows.map((_, i) => (errors[i] ? { state: 'error', message: errors[i]! } : statuses[i])))
    if (hasInvalid) return

    // 顺序提交未成功行
    const submitIdx: number[] = []
    const submitRowsList: T[] = []
    rows.forEach((row, index) => {
      if (statuses[index]?.state !== 'success') {
        submitIdx.push(index)
        submitRowsList.push(row)
      }
    })
    setSubmitting(true)
    try {
      const result = await submitRows(submitRowsList)
      const next = [...statuses]
      submitIdx.forEach((rowIndex, k) => {
        const err = result[k]
        next[rowIndex] = err ? { state: 'error', message: err } : { state: 'success' }
      })
      setStatuses(next)
      // 全部成功 → 自动关闭
      if (next.every((s) => s.state === 'success')) {
        onOpenChange(false)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !submitting) onOpenChange(false) }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
          {rows.map((row, index) => {
            const status = statuses[index] ?? { state: 'pending' as const }
            const invalid = status.state === 'error'
            return (
              <div
                key={index}
                className={cn(
                  'rounded-lg border p-3',
                  invalid ? 'border-destructive/40' : status.state === 'success' ? 'border-success/30 bg-success/5' : 'border-border',
                )}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">第 {index + 1} 条</span>
                  <div className="flex items-center gap-2">
                    {status.state === 'success' && (
                      <span className="inline-flex items-center gap-1 text-xs text-success-strong">
                        <CheckCircle2 className="h-3.5 w-3.5" />已创建
                      </span>
                    )}
                    {status.state === 'error' && (
                      <span className="inline-flex items-center gap-1 max-w-md truncate text-xs text-destructive" title={status.message}>
                        <XCircle className="h-3.5 w-3.5 shrink-0" />{status.message}
                      </span>
                    )}
                    <Button
                      variant="ghost" size="sm" className="h-6 px-1.5 text-destructive hover:text-destructive"
                      onClick={() => removeRow(index)}
                      disabled={submitting || rows.length === 1}
                      title="移除该行"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                {renderRowFields(row, index, (p) => patchRow(index, p), invalid, submitting)}
              </div>
            )
          })}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="outline" size="sm" onClick={addRow} disabled={submitting || rows.length >= maxRows}>
            <Plus className="mr-2 h-4 w-4" />
            添加一行{rows.length >= maxRows ? `（已达上限 ${maxRows}）` : ''}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>取消</Button>
            <Button onClick={handleSubmit} disabled={submitting || pendingCount === 0}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {submitting ? '创建中…' : pendingCount > 0 && successCount > 0 ? `创建剩余 ${pendingCount} 条` : `创建 ${pendingCount} 条`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
