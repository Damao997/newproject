/**
 * 列维度（矩阵模式）纯逻辑：与后端 analysisQuerySchema 的 colDim/colCodes 语义对齐。
 *   colCodes 空数组 = 全部成员（缺省）；
 *   勾选/取消在「显式全集」上操作 —— 缺省全选态首次交互时用成员全集补齐，
 *   避免「看似全选、实际只勾了一个」的空数组歧义。
 */

export type ColDimLike = 'product' | 'category' | 'expense' | 'subject' | 'company'

/** 单个成员勾选/取消后的 colCodes（入参 current 为空数组表示全选态） */
export function nextColCodes(current: string[], allCodes: string[], code: string, checked: boolean): string[] {
  const base = current.length > 0 ? [...current] : [...allCodes]
  const next = checked ? Array.from(new Set([...base, code])) : base.filter((c) => c !== code)
  return next
}

/** 全选/清空：on = 显式全集；off = 空数组（回退全部成员） */
export function allColCodes(allCodes: string[], on: boolean): string[] {
  return on ? [...allCodes] : []
}

/** 列成员触发按钮文案（与 ColDimPicker 内渲染一致，供测试与复用） */
export function colDimTriggerLabel(dimLabel: string, colCodes: string[], total: number): string {
  if (colCodes.length === 0) return `${dimLabel} · 全部 ${total} 成员`
  return `${dimLabel} · 已选 ${colCodes.length}/${total}`
}

/** 列维度候选剔除行维度（后端 schema 层拒绝行列同维，前端不给犯错入口） */
export function colDimOptions<T extends { value: string }>(dims: T[], rowDim: string): T[] {
  return dims.filter((d) => d.value !== rowDim)
}
