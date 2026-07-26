import { useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SubjectTree } from '@/components/subject-tree/subject-tree'
import { SubjectDialog } from '@/components/subject-tree/subject-dialog'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { filterTree, buildSubjectTree, flattenTree } from '@/lib/subject-tree'
import { exportToExcel } from '@/lib/export'
import { useSubjectTree, useSubjects, useDeleteSubject, usePurgeSubject, type SubjectTreeItem } from '@/hooks/api-queries'
import { Search, ChevronsDownUp, ChevronsUpDown, Download, Plus, Pencil, Trash2, ShieldAlert } from 'lucide-react'
import type { SubjectNode } from '@/types'

const dataTypeLabel: Record<SubjectNode['dataType'], string> = {
  data: '数据类',
  calc: '计算类',
  display: '展示类',
}

/** 收集所有含子节点的科目编码（用于展开） */
function collectExpandableCodes(nodes: SubjectNode[]): string[] {
  const codes: string[] = []
  const walk = (list: SubjectNode[]) => {
    for (const node of list) {
      if (node.children.length > 0) {
        codes.push(node.code)
        walk(node.children)
      }
    }
  }
  walk(nodes)
  return codes
}

interface SubjectTreePanelProps {
  /** 科目类型 */
  type: 'operating' | 'static'
  canCreate?: boolean
  canUpdate?: boolean
  canDelete?: boolean
  /** 彻底删除已停用科目（物理删除，仅 superadmin） */
  canPurge?: boolean
  /** 是否显示导出按钮 */
  canExport?: boolean
  /** 导出文件名（不含扩展名） */
  exportFileName?: string
  /** 导出工作表名 */
  exportSheet?: string
  /** 科目计数文案后缀 */
  countSuffix?: string
}

/**
 * 通用科目树面板（读后端真实科目）：类别筛选 + 搜索 + 展开/折叠 + 科目树 + 新增/编辑/停用 + 导出。
 * 经营分析与静态科目复用同一面板（按 type 取数）。
 * canPurge 时额外展示「已停用科目」区，支持彻底删除（物理删除，不可恢复，仅 superadmin）。
 */
export function SubjectTreePanel({
  type,
  canCreate = false,
  canUpdate = false,
  canDelete = false,
  canPurge = false,
  canExport = false,
  exportFileName = '科目层级',
  exportSheet = '科目层级',
  countSuffix = '',
}: SubjectTreePanelProps) {
  const { data, isLoading } = useSubjectTree(type)
  const deleteSubject = useDeleteSubject()
  const purgeSubject = usePurgeSubject()
  // 仅 superadmin 需要已停用科目列表（树接口只返回 active）
  const { data: allSubjects } = useSubjects({ type, pageSize: 1000 }, { enabled: canPurge })
  const inactiveSubjects = useMemo(
    () => (canPurge ? (allSubjects?.items ?? []).filter((s) => s.status === 'inactive') : []),
    [canPurge, allSubjects],
  )
  const { confirm, element: confirmElement } = useConfirm()
  const [actionError, setActionError] = useState<string | null>(null)
  const flat = useMemo(() => (data ?? []) as SubjectTreeItem[], [data])
  const tree = useMemo(() => buildSubjectTree(flat), [flat])

  const rootCodes = useMemo(() => tree.map((n) => n.code), [tree])
  const allExpandableCodes = useMemo(() => collectExpandableCodes(tree), [tree])

  const [category, setCategory] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [expandedCodes, setExpandedCodes] = useState<Set<string>>(() => new Set(rootCodes))
  const [dialog, setDialog] = useState<{ open: boolean; mode: 'create' | 'edit'; subject: SubjectTreeItem | null }>({ open: false, mode: 'create', subject: null })

  const trimmedKeyword = keyword.trim()

  const displayTree = useMemo(() => {
    const base = category === 'all' ? tree : tree.filter((n) => n.name === category)
    return filterTree(base, trimmedKeyword)
  }, [tree, category, trimmedKeyword])

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

  const handleDisable = async (node: SubjectNode) => {
    const item = flat.find((f) => f.code === node.code)
    if (!item) return
    if (!(await confirm({ title: '停用科目', description: `确认停用科目「${node.name}」？`, danger: true, confirmText: '停用' }))) return
    setActionError(null)
    try {
      await deleteSubject.mutateAsync(item.id)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '停用失败')
    }
  }

  const handlePurge = async (s: { id: string; code: string; name: string }) => {
    if (!(await confirm({ title: '彻底删除科目', description: `将物理删除科目「${s.name}」（${s.code}），此操作不可恢复！被事实数据/公式引用或存在下级科目时将被拒绝。`, danger: true, confirmText: '彻底删除' }))) return
    setActionError(null)
    try {
      await purgeSubject.mutateAsync(s.id)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '彻底删除失败')
    }
  }

  const handleExport = async () => {
    const rows = flattenTree(tree).map(({ node, depth }) => ({
      code: node.code,
      name: `${'　'.repeat(depth)}${node.name}`,
      level: `level${node.level}`,
      category: node.category,
      dataType: dataTypeLabel[node.dataType],
    }))
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
      rows,
    })
  }

  const hasActions = canUpdate || canDelete

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
          {canCreate && (
            <Button variant="outline" size="sm" onClick={() => setDialog({ open: true, mode: 'create', subject: null })}>
              <Plus className="mr-2 h-4 w-4" />
              新增科目
            </Button>
          )}
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
        {isLoading ? '加载中...' : `共 ${flattenTree(tree).length} 个科目${countSuffix}`}
      </p>

      {actionError && <p className="text-xs text-destructive">{actionError}</p>}

      <SubjectTree
        nodes={displayTree}
        expandedCodes={effectiveExpanded}
        onToggle={handleToggle}
        keyword={trimmedKeyword}
        emptyText={isLoading ? '加载中...' : '暂无科目'}
        actions={
          hasActions
            ? (node) => (
                <>
                  {canUpdate && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDialog({ open: true, mode: 'edit', subject: flat.find((f) => f.code === node.code) ?? null })}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                  {canDelete && (
                    <Button variant="ghost" size="sm" onClick={() => handleDisable(node)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </>
              )
            : undefined
        }
      />

      <SubjectDialog
        open={dialog.open}
        mode={dialog.mode}
        type={type}
        subject={dialog.subject}
        flat={flat}
        onClose={() => setDialog((d) => ({ ...d, open: false }))}
      />

      {canPurge && inactiveSubjects.length > 0 && (
        <div className="space-y-2 rounded-lg border border-destructive/30 p-3">
          <p className="text-sm font-medium text-destructive">已停用科目（{inactiveSubjects.length}）——可彻底删除，操作不可恢复</p>
          <ul className="space-y-1">
            {inactiveSubjects.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1 text-sm">
                <span>
                  <span className="font-mono text-xs text-muted-foreground mr-2">{s.code}</span>
                  {s.name}
                </span>
                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" title="彻底删除（不可恢复）" onClick={() => handlePurge(s)}>
                  <ShieldAlert className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {confirmElement}
    </div>
  )
}
