import { useCallback, useState } from 'react'
import { FlashMessage } from '@/components/ui/flash-message'
import type { Company } from '@/types'

/**
 * 主体互斥规则核心（纯函数）：单体公司与汇总主体不能同时筛选（防止成员公司双重计数）；
 * 汇总主体最多选择一个（多汇总成员可能重叠，且合并抵消口径仅支持单一汇总），新选自动替换。
 * 返回修剪后的选择结果与提示文案（无冲突时 notice 为 null）；
 * 由 useExclusiveCompanyFilter（FlashMessage 形态）与 Header CompanyPill（antd message 形态）复用。
 */
export function resolveExclusiveCompanies(opts: {
  companies: Company[] | undefined
  prev: string[]
  next: string[]
}): { next: string[]; notice: string | null } {
  const { companies, prev, next } = opts
  const typeOf = (code: string) => companies?.find((c) => c.code === code)?.type
  const added = next.filter((c) => !prev.includes(c))
  if (added.length > 0) {
    const addedType = typeOf(added[added.length - 1])
    if (addedType === 'entity' && next.some((c) => typeOf(c) === 'summary')) {
      return {
        next: next.filter((c) => typeOf(c) !== 'summary'),
        notice: '单体公司与汇总主体不能同时筛选，已自动取消已选汇总主体。',
      }
    }
    if (addedType === 'summary' && next.some((c) => typeOf(c) === 'entity')) {
      return {
        next: next.filter((c) => typeOf(c) !== 'entity'),
        notice: '单体公司与汇总主体不能同时筛选，已自动取消已选单体公司。',
      }
    }
    // 汇总主体最多一个：多汇总成员可能重叠、抵消口径仅支持单一汇总，新选自动替换旧选
    if (addedType === 'summary') {
      const summaries = next.filter((c) => typeOf(c) === 'summary')
      const newest = [...added].reverse().find((c) => typeOf(c) === 'summary')
      if (summaries.length > 1 && newest) {
        const keptName = companies?.find((c) => c.code === newest)?.name ?? newest
        return {
          next: next.filter((c) => typeOf(c) !== 'summary' || c === newest),
          notice: `汇总主体仅可选择一个，已切换为「${keptName}」。`,
        }
      }
    }
  }
  return { next, notice: null }
}

/**
 * 主体互斥过滤 hook（FlashMessage 形态提示）：
 * getPrev 由调用方提供（各页持久化 store 路径不同）。
 */
export function useExclusiveCompanyFilter(opts: {
  companies: Company[] | undefined
  getPrev: () => string[]
  setSelected: (codes: string[]) => void
}) {
  const { companies, getPrev, setSelected } = opts
  // 对象 + key：同文案重复触发时 key 变化强制 FlashMessage 重挂载，4s 计时随之重置
  const [notice, setNotice] = useState<{ text: string; key: number } | null>(null)

  const handleCompaniesChange = useCallback((next: string[]) => {
    const result = resolveExclusiveCompanies({ companies, prev: getPrev(), next })
    if (result.notice) setNotice({ text: result.notice, key: Date.now() })
    setSelected(result.next)
  }, [companies, getPrev, setSelected])

  // clearNotice 稳定引用：避免无关重渲染导致 FlashMessage 计时顺延的隐式耦合
  const clearNotice = useCallback(() => setNotice(null), [])

  const noticeElement = notice ? (
    <FlashMessage key={notice.key} type="info" autoHideMs={4000} onAutoHide={clearNotice} className="mt-2">
      {notice.text}
    </FlashMessage>
  ) : null

  return { handleCompaniesChange, noticeElement }
}
