import type { SubjectNode } from '@/types'
import { rawOperatingAnalysis } from '@/mock/operating-analysis'
import { rawStaticAnalysis } from '@/mock/static-analysis'

/** 原始科目节点（仅名称 + 数据类型 + 子节点），编码/层级/类别由 decorateTree 生成 */
export interface RawSubjectNode {
  name: string
  dataType: 'data' | 'calc' | 'display'
  children?: RawSubjectNode[]
}

/** 展开后的行：节点 + 深度 */
export interface FlatSubjectRow {
  node: SubjectNode
  depth: number
}

/**
 * 前序遍历装饰原始树：为每个节点赋 code（`${prefix}_` + 3 位序号）、level（= 深度）、category（= level0 根名）。
 */
export function decorateTree(raw: RawSubjectNode[], prefix = 'OP'): SubjectNode[] {
  let seq = 0
  const nextCode = () => `${prefix}_${String(++seq).padStart(3, '0')}`

  const walk = (nodes: RawSubjectNode[], level: number, category: string): SubjectNode[] =>
    nodes.map((n) => {
      // level0 节点自身即类别根
      const rootCategory = level === 0 ? n.name : category
      const decorated: SubjectNode = {
        code: nextCode(),
        name: n.name,
        level,
        category: rootCategory,
        dataType: n.dataType,
        children: [],
      }
      decorated.children = n.children ? walk(n.children, level + 1, rootCategory) : []
      return decorated
    })

  return walk(raw, 0, '')
}

/** 由后端扁平列表（含 parentCode/dataType）按 parentCode 构树，根为 parentCode 为空者 */
export interface FlatSubjectItem {
  code: string
  name: string
  level: number
  parentCode: string | null
  category: string
  dataType: 'data' | 'calc' | 'display'
}

export function buildSubjectTree(flat: FlatSubjectItem[]): SubjectNode[] {
  const map = new Map<string, SubjectNode>()
  for (const item of flat) {
    map.set(item.code, {
      code: item.code,
      name: item.name,
      level: item.level,
      category: item.category,
      dataType: item.dataType,
      children: [],
    })
  }
  const roots: SubjectNode[] = []
  for (const item of flat) {
    const node = map.get(item.code)!
    if (item.parentCode && map.has(item.parentCode)) {
      map.get(item.parentCode)!.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

/** 前序展开为扁平行列表 */
export function flattenTree(tree: SubjectNode[], depth = 0): FlatSubjectRow[] {
  const rows: FlatSubjectRow[] = []
  for (const node of tree) {
    rows.push({ node, depth })
    if (node.children.length > 0) {
      rows.push(...flattenTree(node.children, depth + 1))
    }
  }
  return rows
}

/**
 * 按关键字过滤树：保留名称或编码命中的节点，并保留其祖先链（祖先只要有命中后代即保留）。
 * 关键字为空时返回原树。
 */
export function filterTree(tree: SubjectNode[], keyword: string): SubjectNode[] {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return tree

  const filterNodes = (nodes: SubjectNode[]): SubjectNode[] => {
    const result: SubjectNode[] = []
    for (const node of nodes) {
      const selfMatch =
        node.name.toLowerCase().includes(kw) || node.code.toLowerCase().includes(kw)
      const children = filterNodes(node.children)
      if (selfMatch || children.length > 0) {
        result.push({ ...node, children })
      }
    }
    return result
  }

  return filterNodes(tree)
}

/** 装饰后的完整经营分析树 */
export const operatingAnalysisTree = decorateTree(rawOperatingAnalysis, 'OP')

/** 装饰后的经营分析扁平列表（供导出、统计） */
export const operatingAnalysisFlat = flattenTree(operatingAnalysisTree)

/** 装饰后的完整静态指标树 */
export const staticAnalysisTree = decorateTree(rawStaticAnalysis, 'ST')

/** 装饰后的静态指标扁平列表 */
export const staticAnalysisFlat = flattenTree(staticAnalysisTree)
