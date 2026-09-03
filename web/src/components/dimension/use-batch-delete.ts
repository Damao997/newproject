import { useState } from 'react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import type { BatchOpMessageData } from './batch-rows-dialog'

interface BatchDeleteOptions<T> {
  /** 实体名（用于确认框标题，如「品类配置」） */
  entityLabel: string
  /** 行显示名（确认框列表与失败原因定位） */
  getName: (row: T) => string
  /** 单条删除（复用面板现有 remove mutation） */
  removeOne: (row: T) => Promise<unknown>
}

/**
 * 批量删除 hook（映射管理通用）：受控行选择 + 确认 + 顺序逐条调用单条删除接口，
 * 失败项不中断整体流程，完成后汇总成功/失败明细并清空选择。
 * 无后端批量端点，纯前端循环实现（与 BatchRowsDialog 同一口径）。
 */
export function useBatchDelete<T>({ entityLabel, getName, removeOne }: BatchDeleteOptions<T>) {
  const { confirm } = useConfirm()
  const [selectedKeys, setSelectedKeys] = useState<Set<string | number>>(new Set())
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<BatchOpMessageData | null>(null)

  const runBatchDelete = async (rows: T[]) => {
    if (rows.length === 0 || running) return
    const names = rows.map(getName)
    const preview = names.slice(0, 8).join('、') + (names.length > 8 ? ` 等 ${names.length} 条` : '')
    const ok = await confirm({
      title: `批量删除${entityLabel}`,
      description: `将删除：${preview}。删除后相关看板不再展示对应数据。逐条提交，失败项不影响其余条目。`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    setRunning(true)
    setMessage(null)
    const failures: string[] = []
    for (const row of rows) {
      try {
        await removeOne(row)
      } catch (e: any) {
        failures.push(`「${getName(row)}」：${e?.response?.data?.message ?? e?.message ?? '删除失败'}`)
      }
    }
    const okCount = rows.length - failures.length
    setMessage(
      failures.length === 0
        ? { type: 'success', text: `批量删除完成：成功 ${okCount} 条` }
        : { type: 'warning', text: `批量删除完成：成功 ${okCount} 条，失败 ${failures.length} 条 —— ${failures.join('；')}` },
    )
    setSelectedKeys(new Set())
    setRunning(false)
  }

  return { selectedKeys, setSelectedKeys, runBatchDelete, running, message, clearMessage: () => setMessage(null) }
}
