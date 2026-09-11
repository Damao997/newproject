import { useCallback, useState } from 'react'
import { useActivateImport, useBatchActivateCheck } from './api-queries'
import type { ActivateConflict } from '@/types'

/** 批量激活进行中的进度快照 */
export interface BatchActivateProgress {
  done: number
  total: number
  currentId: string
  currentFilename: string
}

/** 单批次激活结果 */
export interface BatchActivateResult {
  status: 'success' | 'failed'
  error?: string
}

/** 批量激活完成汇总 */
export interface BatchActivateSummary {
  successCount: number
  failCount: number
  failItems: { id: string; filename: string; error: string }[]
}

/** 批量激活预检摘要（供冲突确认弹窗展示） */
export interface BatchActivateCheckSummary {
  /** 激活后将替换的已生效组合总数 */
  conflictCount: number
  /** 选中批次之间互相重叠的三元组数（后激活覆盖先激活） */
  crossCount: number
  /** 冲突示例文案（最多 3 条） */
  samples: string[]
}

function conflictText(c: ActivateConflict): string {
  return c.label ?? [c.companyCode, c.period, c.transactionType].filter(Boolean).join(' ')
}

/** 构建冲突确认弹窗描述：无冲突返回空串（调用方可直接跳过确认） */
export function buildActivateConflictDescription(check: BatchActivateCheckSummary): string {
  const parts: string[] = []
  if (check.conflictCount > 0) {
    const samples = check.samples.map((s) => `「${s}」`).join('、')
    parts.push(`本次激活将替换 ${check.conflictCount} 个已生效组合${samples ? `（如 ${samples}${check.conflictCount > 3 ? ' 等' : ''}）` : ''}。`)
  }
  if (check.crossCount > 0) {
    parts.push(`所选批次间存在 ${check.crossCount} 个重叠组合，激活顺序靠后的批次将覆盖先激活的数据。`)
  }
  return parts.length > 0 ? `${parts.join('')}确认继续？` : ''
}

/**
 * 批量激活编排（往来导入三界面复用）：
 * - checkConflicts(ids)：只读预检各批次激活后将替换的已生效组合，供激活前确认覆盖风险；
 * - run(batches)：串行逐个激活（后激活批次按三元组覆盖先激活批次，与单批激活语义一致），
 *   每批更新进度与结果，单批失败不中断其余，返回成功/失败汇总。
 */
export function useBatchActivate() {
  const checkMutation = useBatchActivateCheck()
  const activateMutation = useActivateImport()
  const [progress, setProgress] = useState<BatchActivateProgress | null>(null)
  const [results, setResults] = useState<Map<string, BatchActivateResult>>(new Map())

  const isBusy = checkMutation.isPending || activateMutation.isPending

  const checkConflicts = useCallback(async (ids: string[]): Promise<BatchActivateCheckSummary> => {
    const { results: items } = await checkMutation.mutateAsync(ids)
    const all = items.flatMap((it) => it.conflicts)
    return {
      conflictCount: all.length,
      crossCount: items.reduce((s, it) => s + it.crossBatchConflictCount, 0),
      samples: all.slice(0, 3).map(conflictText),
    }
  }, [checkMutation])

  const run = useCallback(async (batches: { id: string; filename: string }[]): Promise<BatchActivateSummary> => {
    setResults(new Map())
    setProgress({ done: 0, total: batches.length, currentId: '', currentFilename: '' })
    const nextResults = new Map<string, BatchActivateResult>()
    const failItems: { id: string; filename: string; error: string }[] = []
    for (let i = 0; i < batches.length; i++) {
      const { id, filename } = batches[i]
      setProgress({ done: i, total: batches.length, currentId: id, currentFilename: filename })
      try {
        await activateMutation.mutateAsync(id)
        nextResults.set(id, { status: 'success' })
      } catch (e) {
        const error = e instanceof Error ? e.message : '激活失败'
        nextResults.set(id, { status: 'failed', error })
        failItems.push({ id, filename, error })
      }
      setResults(new Map(nextResults))
      setProgress({ done: i + 1, total: batches.length, currentId: id, currentFilename: filename })
    }
    return { successCount: batches.length - failItems.length, failCount: failItems.length, failItems }
  }, [activateMutation])

  const clear = useCallback(() => {
    setProgress(null)
    setResults(new Map())
  }, [])

  return { progress, results, isBusy, checkConflicts, run, clear }
}
