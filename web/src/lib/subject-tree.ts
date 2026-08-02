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
 * 前序遍历装饰原始树：为每个节点赋级联编码（level0 用段位表如 OP_02，子级 = 父码 + 2 位序号如 OP_0201）、
 * level（= 深度）、category（= level0 根名）。
 */

/**
 * level0 科目段位表（名称 → 2 位段位，会计大类分段）。
 * 与 server/prisma/seed-data/subject-trees.ts 的 SUBJECT_SEGMENT_MAP 保持一致（同一编码体系）。
 * 经营科目 01-08；静态科目按 资产 10-15 / 负债 20-24 / 权益 30-31 / 比率 40-44。
 */
export const SUBJECT_SEGMENT_MAP: Record<string, string> = {
  // 经营科目
  '回款': '01',
  '收入': '02',
  '成本': '03',
  '毛利': '04',
  '费用': '05',
  '经营指标': '06',
  '财务指标': '07',
  '现金流指标': '08',
  // 静态科目（资产）
  '总资产': '10',
  '银行存款': '11',
  '应收账款': '12',
  '存货': '13',
  '固定资产净值': '14',
  '在建工程': '15',
  // 静态科目（负债）
  '总负债': '20',
  '预收账款': '21',
  '应付账款': '22',
  '内部往来': '23',
  '应付股利': '24',
  // 静态科目（权益）
  '权益净资产': '30',
  '累计未分配利润(万元)': '31',
  // 静态科目（比率）
  '总资产报酬率（ROA,%）': '40',
  '资产负债率(%)': '41',
  '净资产回报率（ROE,%）': '42',
  '存货周转天数': '43',
  '应收账款周转天数': '44',
}

/** level0 编码：前缀 + 段位表登记段位（未登记抛错，强制维护） */
function rootSubjectCodeOf(prefix: string, name: string): string {
  const segment = SUBJECT_SEGMENT_MAP[name]
  if (!segment) throw new Error(`科目未登记 level0 段位：${name}（请向 SUBJECT_SEGMENT_MAP 补充）`)
  return `${prefix}_${segment}`
}

/** 子级编码：父码数字段 + 2 位序号 */
function childSubjectCodeOf(parentCode: string, seq: number): string {
  return `${parentCode}${String(seq).padStart(2, '0')}`
}

/** 前序遍历装饰原始树：级联赋码（level0 段位 + 子级父码拼接）、level=深度、category=level0 根名 */
export function decorateTree(raw: RawSubjectNode[], prefix = 'OP'): SubjectNode[] {
  const walk = (nodes: RawSubjectNode[], level: number, parentCode: string | null, category: string): SubjectNode[] => {
    // 本级序号：同一父节点下从 1 递增（level0 用段位表，不使用序号）
    let seq = 0
    return nodes.map((n) => {
      const code = level === 0 ? rootSubjectCodeOf(prefix, n.name) : childSubjectCodeOf(parentCode as string, ++seq)
      // level0 节点自身即类别根
      const rootCategory = level === 0 ? n.name : category
      const decorated: SubjectNode = {
        code,
        name: n.name,
        level,
        category: rootCategory,
        dataType: n.dataType,
        children: [],
      }
      decorated.children = n.children ? walk(n.children, level + 1, code, rootCategory) : []
      return decorated
    })
  }

  return walk(raw, 0, null, '')
}

/** 由后端扁平列表（含 parentCode/dataType）按 parentCode 构树，根为 parentCode 为空者 */
export interface FlatSubjectItem {
  code: string
  name: string
  level: number
  parentCode: string | null
  category: string
  dataType: 'data' | 'calc' | 'display'
  valueType?: 'amount' | 'quantity' | 'ratio'
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
      valueType: item.valueType,
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
