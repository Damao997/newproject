import { useCallback, useState } from 'react'
import { FlashMessage } from '@/components/ui/flash-message'
import type { Company } from '@/types'

/**
 * 主体互斥过滤：单体公司与汇总主体不能同时筛选（防止成员公司双重计数）。
 * 新增勾选某一类时自动取消另一类，并以轻提示告知（替代三处复制的 window.alert）。
 * getPrev 由调用方提供（各页持久化 store 路径不同）。
 */
export function useExclusiveCompanyFilter(opts: {
  companies: Company[] | undefined
  getPrev: () => string[]
  setSelected: (codes: string[]) => void
}) {
  const { companies, getPrev, setSelected } = opts
  const [notice, setNotice] = useState<string | null>(null)

  const handleCompaniesChange = useCallback((next: string[]) => {
    const prev = getPrev()
    const typeOf = (code: string) => companies?.find((c) => c.code === code)?.type
    const added = next.filter((c) => !prev.includes(c))
    if (added.length > 0) {
      const addedType = typeOf(added[added.length - 1])
      if (addedType === 'entity' && next.some((c) => typeOf(c) === 'summary')) {
        setNotice('单体公司与汇总主体不能同时筛选，已自动取消已选汇总主体。')
        setSelected(next.filter((c) => typeOf(c) !== 'summary'))
        return
      }
      if (addedType === 'summary' && next.some((c) => typeOf(c) === 'entity')) {
        setNotice('单体公司与汇总主体不能同时筛选，已自动取消已选单体公司。')
        setSelected(next.filter((c) => typeOf(c) !== 'entity'))
        return
      }
    }
    setSelected(next)
  }, [companies, getPrev, setSelected])

  const noticeElement = notice ? (
    <FlashMessage type="info" autoHideMs={4000} onAutoHide={() => setNotice(null)} className="mt-2">
      {notice}
    </FlashMessage>
  ) : null

  return { handleCompaniesChange, noticeElement }
}
