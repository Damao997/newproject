import type { SubjectNode } from '@/types'

/** 展开后的行：节点 + 深度 */
export interface FlatSubjectRow {
  node: SubjectNode
  depth: number
}

/**
 * level0 科目段位表（名称 → 2 位段位）。
 * 与 server/prisma/seed-data/subject-trees.ts 的 SUBJECT_SEGMENT_MAP 保持一致（同一编码体系）。
 * 经营科目（PL_）01-08；静态科目（BS_）01-04（总资产/总负债/权益净资产/静态指标）；现金流（CF_）01-03。
 */
export const SUBJECT_SEGMENT_MAP: Record<string, string> = {
  // 经营科目
  '壹品慧回款': '01',
  '壹品慧收入': '02',
  '壹品慧成本': '03',
  '壹品慧毛利': '04',
  '壹品慧费用': '05',
  '经营成果': '06',
  '壹品慧毛利率': '07',
  '经营指标': '08',
  // 静态科目
  '总资产': '01',
  '总负债': '02',
  '权益净资产': '03',
  '静态指标': '04',
  // 现金流科目
  '经营活动产生的现金流量': '01',
  '投资活动产生的现金流量': '02',
  '筹资活动产生的现金流量': '03',
}

/** 段位表名称 → 所属前缀（三套体系段位独立编号，需据此校验段位归属） */
export const SUBJECT_PREFIX_MAP: Record<string, 'PL' | 'BS' | 'CF'> = {
  // 经营（PL_）
  '壹品慧回款': 'PL', '壹品慧收入': 'PL', '壹品慧成本': 'PL', '壹品慧毛利': 'PL',
  '壹品慧费用': 'PL', '经营成果': 'PL', '壹品慧毛利率': 'PL', '经营指标': 'PL',
  // 静态（BS_）
  '总资产': 'BS', '总负债': 'BS', '权益净资产': 'BS', '静态指标': 'BS',
  // 现金流（CF_）
  '经营活动产生的现金流量': 'CF', '投资活动产生的现金流量': 'CF', '筹资活动产生的现金流量': 'CF',
}

/** 子级编码：父码数字段 + 2 位序号 */
function childSubjectCodeOf(parentCode: string, seq: number): string {
  return `${parentCode}${String(seq).padStart(2, '0')}`
}

/** 解析 父码+2位序号 编码的尾部序号；非规则编码视为 0 */
function subjectSeqOf(code: string, parentCode: string): number {
  const esc = parentCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = code.match(new RegExp(`^${esc}(\\d{2})$`))
  return m ? Number(m[1]) : 0
}

/** 该类型段位表登记值（三套体系段位独立编号，按 SUBJECT_PREFIX_MAP 归属过滤） */
function registeredSegmentsOf(prefix: 'PL' | 'BS' | 'CF'): number[] {
  return Object.entries(SUBJECT_SEGMENT_MAP)
    .filter(([name]) => SUBJECT_PREFIX_MAP[name] === prefix)
    .map(([, s]) => Number(s))
}

/** 编码预览所需的最小科目结构（兼容 FlatSubjectItem / SubjectTreeItem / AccountSubject） */
export interface CodePreviewSubject {
  code: string
  parentCode?: string | null
  level: number
}

/** 新增子科目编码预览：父码 + 同级最大序号 + 1（与后端生成规则一致；>99 返回 null 由调用方提示上限） */
export function nextChildSubjectCode(parentCode: string, flat: CodePreviewSubject[]): string | null {
  const maxSeq = Math.max(0, ...flat.filter((f) => f.parentCode === parentCode).map((f) => subjectSeqOf(f.code, parentCode)))
  const seq = maxSeq + 1
  return seq > 99 ? null : childSubjectCodeOf(parentCode, seq)
}

/** 新增根科目编码预览：名称命中段位表（且段位归属该前缀）用登记段位；未命中自动分配该类型下一未用段位；>99 返回 null */
export function nextRootSubjectCode(prefix: 'PL' | 'BS' | 'CF', name: string, flat: CodePreviewSubject[]): { code: string | null; registered: boolean } {
  const registered = SUBJECT_SEGMENT_MAP[name]
  if (registered && SUBJECT_PREFIX_MAP[name] === prefix) return { code: `${prefix}${registered}`, registered: true }
  const usedSegs = flat.filter((f) => f.level === 0).map((f) => Number(f.code.slice(prefix.length))).filter((n) => Number.isFinite(n))
  const regs = registeredSegmentsOf(prefix)
  const base = regs.length > 0 || usedSegs.length > 0 ? Math.max(...regs, ...usedSegs) : 0
  let next = base + 1
  while (usedSegs.includes(next)) next++
  if (next > 99) return { code: null, registered: false }
  return { code: `${prefix}${String(next).padStart(2, '0')}`, registered: false }
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

/**
 * 按关键字过滤树（命中保留整棵子树）：名称或编码命中的节点保留其全部后代（子树原样返回），
 * 未命中但含命中后代的节点保留为祖先链（children 为过滤后结果）；关键字为空返回原树。
 * 与 filterTree（命中仅保留过滤后子树）的差异：用于科目树"命中即展示该组全部明细"的场景。
 */
export function filterTreeKeepSubtree(tree: SubjectNode[], keyword: string): SubjectNode[] {
  const q = keyword.trim().toLowerCase()
  if (!q) return tree
  const hit = (n: SubjectNode) => n.name.toLowerCase().includes(q) || n.code.toLowerCase().includes(q)
  const walk = (ns: SubjectNode[]): SubjectNode[] =>
    ns.flatMap((n) => {
      if (hit(n)) return [{ ...n }]
      const children = walk(n.children)
      return children.length > 0 ? [{ ...n, children }] : []
    })
  return walk(tree)
}
