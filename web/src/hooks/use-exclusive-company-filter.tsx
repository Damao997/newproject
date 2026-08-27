import { useCallback, useState } from 'react'
import { FlashMessage } from '@/components/ui/flash-message'
import type { Company } from '@/types'

/**
 * 主体互斥过滤：单体公司与汇总主体不能同时筛选（防止成员公司双重计数）；
 * 汇总主体最多选择一个（多汇总成员可能重叠，且合并抵消口径仅支持单一汇总），新选自动替换。
 * 触发时以轻提示告知（替代三处复制的 window.alert）。
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
    const prev = getPrev()
    const typeOf = (code: string) => companies?.find((c) => c.code === code)?.type
    const added = next.filter((c) => !prev.includes(c))
    if (added.length > 0) {
      const addedType = typeOf(added[added.length - 1])
      if (addedType === 'entity' && next.some((c) => typeOf(c) === 'summary')) {
        setNotice({ text: '单体公司与汇总主体不能同时筛选，已自动取消已选汇总主体。', key: Date.now() })
        setSelected(next.filter((c) => typeOf(c) !== 'summary'))
        return
      }
      if (addedType === 'summary' && next.some((c) => typeOf(c) === 'entity')) {
        setNotice({ text: '单体公司与汇总主体不能同时筛选，已自动取消已选单体公司。', key: Date.now() })
        setSelected(next.filter((c) => typeOf(c) !== 'entity'))
        return
      }
      // 汇总主体最多一个：多汇总成员可能重叠、抵消口径仅支持单一汇总，新选自动替换旧选
      if (addedType === 'summary') {
        const summaries = next.filter((c) => typeOf(c) === 'summary')
        const newest = [...added].reverse().find((c) => typeOf(c) === 'summary')
        if (summaries.length > 1 && newest) {
          const keptName = companies?.find((c) => c.code === newest)?.name ?? newest
          setNotice({ text: `汇总主体仅可选择一个，已切换为「${keptName}」。`, key: Date.now() })
          setSelected(next.filter((c) => typeOf(c) !== 'summary' || c === newest))
          return
        }
      }
    }
    setSelected(next)
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
