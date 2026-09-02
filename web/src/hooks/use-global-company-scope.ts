import { useEffect, useRef } from 'react'
import { message } from 'antd'
import { usePeriodStore } from '@/stores/periodStore'

/**
 * 全局公司口径 → 单公司接口的降级解析（指标/催收/业务员等仅支持 companyCode 单公司参数的页面共用）：
 * - 全局未选（companyCodes 为 null 或空数组，= 全部公司）→ 返回 undefined（不传参数，后端按全部/权限范围汇总）；
 * - 全局选中集合 → 取第一个编码；集合内多家时以 antd message 轻提示降级口径（同一集合仅提示一次）。
 *
 * 说明：指标 / 客商台账 / 业务员管理等接口（api.ts）公司参数均为 `companyCode?: string` 单公司形态，
 * 不支持多公司数组，故多选时按「首个选择」降级；汇总主体编码亦可作为 companyCode 传入（后端按主体口径汇总）。
 */
export function useGlobalCompanyScope(pageLabel: string): {
  /** 生效公司编码（全局未选时为 undefined = 全部公司） */
  companyCode: string | undefined
  /** 全局是否显式选择了公司（用于空态提示等场景） */
  hasSelection: boolean
} {
  const companyCodes = usePeriodStore((s) => s.companyCodes)
  const hasSelection = !!companyCodes && companyCodes.length > 0
  // 内容级去重：同一集合（persist 恢复/引用变化）不重复提示
  const lastNoticeKey = useRef('')
  const globalKey = hasSelection ? companyCodes.join(',') : ''

  useEffect(() => {
    if (companyCodes && companyCodes.length > 1 && lastNoticeKey.current !== globalKey) {
      lastNoticeKey.current = globalKey
      message.info(`${pageLabel}仅支持单公司查看，已应用首个选择`)
    }
  }, [companyCodes, globalKey, pageLabel])

  return { companyCode: hasSelection ? companyCodes[0] : undefined, hasSelection }
}
