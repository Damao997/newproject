import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SubjectTree } from '@/components/subject-tree/subject-tree'
import { filterTree, type FlatSubjectRow } from '@/lib/subject-tree'
import { exportToExcel } from '@/lib/export'
import { Search, ChevronsDownUp, ChevronsUpDown, Download } from 'lucide-react'
import type { SubjectNode } from '@/types'

const dataTypeLabel: Record<SubjectNode['dataType'], string> = {
  data: '数据类',
  calc: '计算类',
  display: '展示类',
}

/** 收集所有含子节点的科目编码（用于展开） */
function collectExpandableCodes(nodes: SubjectNode[]): string[] {
  const codes: string[] = []
  for (const node of nodes) {
    if (node.children.length > 0) {
      codes.push(node.code)
      codes.push(...collectExpandableCodes(node.children))
    }
  }
  return codes
}

interface SubjectTreePanelProps {
  /** 装饰后的科目树 */
  tree: SubjectNode[]
  /** 装饰后的扁平列表（用于计数与导出） */
  flat: FlatSubjectRow[]
  /** 是否显示导出按钮 */
  canExport?: boolean
  /** 导出文件名（不含扩展名） */
  exportFileName?: string
  /** 导出工作表名 */
  exportSheet?: string
  /** 科目计数文案后缀，如「（level0-level4）」 */
  countSuffix?: string
}

/**
 * 通用科目树面板：类别筛选 + 搜索 + 展开/折叠 + 科目树 + 可选导出。
 * 自持状态，默认展开 level0（各类别下 level1 可见）。经营分析与静态科目复用同一面板。
 */
export function SubjectTreePanel({
  tree,
  flat,
  canExport = false,
  exportFileName = '科目层级',
  exportSheet = '科目层级',
  countSuffix = '',
}: SubjectTreePanelProps) {
  const rootCodes = useMemo(() => tree.map((n) => n.code), [tree])
  const allExpandableCodes = useMemo(() => collectExpandableCodes(tree), [tree])

  const [category, setCategory] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(() => new Set(rootCodes))

  const trimmedKeyword = keyword.trim()

  const displayTree = useMemo(() => {
    const base = category === 'all' ? tree : tree.filter((n) => n.name === category)
    return filterTree(base, trimmedKeyword)
  }, [tree, category, trimmedKeyword])

  // 搜索时自动展开过滤后树的全部祖先，确保命中项可见
  const effectiveExpanded = useMemo(
    () => (trimmedKeyword ? new Set(collectExpandableCodes(displayTree)) : expandedCodes),
    [trimmedKeyword, displayTree, expandedCodes],
  )

  const handleToggle = (code: string) => {
    setExpandedCodes((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  const handleExport = async () => {
    await exportToExcel({
      filename: `${exportFileName}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      sheetName: exportSheet,
      columns: [
        { header: '科目编码', key: 'code', width: 12 },
        { header: '科目名称', key: 'name', width: 40 },
        { header: '层级', key: 'level', width: 10 },
        { header: '类别', key: 'category', width: 16 },
        { header: '数据类型', key: 'dataType', width: 12 },
      ],
      rows: flat.map(({ node }) => ({
        code: node.code,
        name: node.name,
        level: `level${node.level}`,
        category: node.category,
        dataType: dataTypeLabel[node.dataType],
      })),
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:space-x-2 sm:space-y-0">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="选择类别" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类别</SelectItem>
            {tree.map((n) => (
              <SelectItem key={n.code} value={n.name}>
                {n.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索科目名称或编码..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="pl-8"
          />
        </div>

        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpandedCodes(new Set(allExpandableCodes))}
            disabled={!!trimmedKeyword}
          >
            <ChevronsUpDown className="mr-2 h-4 w-4" />
            全部展开
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpandedCodes(new Set())}
            disabled={!!trimmedKeyword}
          >
            <ChevronsDownUp className="mr-2 h-4 w-4" />
            全部折叠
          </Button>
          {canExport && (
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="mr-2 h-4 w-4" />
              导出
            </Button>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        共 {flat.length} 个科目{countSuffix}
      </p>

      <SubjectTree
        nodes={displayTree}
        expandedCodes={effectiveExpanded}
        onToggle={handleToggle}
        keyword={trimmedKeyword}
      />
    </div>
  )
}
