import type { SubjectNode } from '@/types'

/**
 * 按 level0 分类编码过滤树：仅保留命中分类的整棵子树（子树原样返回，与 filterTreeKeepSubtree 语义一致）；
 * categoryCodes 为 null 或空数组时返回原树。纯函数，不修改入参。
 */
export function filterByCategories(nodes: SubjectNode[], categoryCodes: string[] | null): SubjectNode[] {
  if (!categoryCodes || categoryCodes.length === 0) return nodes
  const set = new Set(categoryCodes)
  return nodes.filter((n) => set.has(n.code))
}
