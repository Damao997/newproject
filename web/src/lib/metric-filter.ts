import type { SubjectNode } from '@/types'

/**
 * 按 level0 分类编码过滤树：仅保留命中分类的整棵子树（返回原始节点引用，命中子树原样保留；
 * 语义类似 filterTreeKeepSubtree，但后者命中节点为浅拷贝，本函数直接返回原节点）；
 * categoryCodes 为 null 时返回原树（全部）；空数组表示无分类（返回空数组，表格显示空态）。
 * 纯函数，不修改入参。
 */
export function filterByCategories(nodes: SubjectNode[], categoryCodes: string[] | null): SubjectNode[] {
  if (categoryCodes === null) return nodes
  const set = new Set(categoryCodes)
  return nodes.filter((n) => set.has(n.code))
}
