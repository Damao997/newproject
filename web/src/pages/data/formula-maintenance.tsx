import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { Pagination } from '@/components/data-table/pagination'
import { operatingAnalysisFlat, staticAnalysisFlat } from '@/lib/subject-tree'
import { PAGINATION } from '@/lib/constants'
import { Pencil } from 'lucide-react'

interface CalcSubjectRow {
  code: string
  name: string
  category: string
  level: number
}

// 合并两棵树中的计算类科目
const calcSubjects: CalcSubjectRow[] = [...operatingAnalysisFlat, ...staticAnalysisFlat]
  .filter(({ node }) => node.dataType === 'calc')
  .map(({ node }) => ({
    code: node.code,
    name: node.name,
    category: node.category,
    level: node.level,
  }))

// 公式初值（mock 示例，仅个别科目给出，其余为占位）
const initialFormulas: Record<string, string> = {
  毛利: '收入 - 成本',
  壹品慧毛利: '壹品慧收入 - 壹品慧成本',
  壹品慧毛利率: '壹品慧毛利 / 壹品慧收入',
  应收账款: '集团内客户 + 集团外客户 - 已收燃易信',
  '总资产报酬率（ROA,%）': '净利润 / 总资产',
  '资产负债率(%)': '总负债 / 总资产',
  '净资产回报率（ROE,%）': '净利润 / 权益净资产',
}

const PAGE_SIZE = PAGINATION.DEFAULT_PAGE_SIZE

interface FormulaMaintenanceProps {
  /** 是否可编辑公式（受 data:metric 门禁） */
  canManage?: boolean
}

/**
 * 计算类科目公式维护。
 *
 * 汇总经营分析 + 静态指标两棵树中 dataType==='calc' 的科目，展示编码/名称/类别/层级/公式；
 * 「编辑公式」以弹窗修改，仅更新本地状态（mock，不持久化）。
 */
export function FormulaMaintenance({ canManage = false }: FormulaMaintenanceProps) {
  const [formulas, setFormulas] = useState<Record<string, string>>(initialFormulas)
  const [keyword, setKeyword] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [page, setPage] = useState(1)

  const [editing, setEditing] = useState<CalcSubjectRow | null>(null)
  const [draftFormula, setDraftFormula] = useState('')

  const categories = useMemo(
    () => Array.from(new Set(calcSubjects.map((s) => s.category))),
    [],
  )

  const filtered = useMemo(() => calcSubjects.filter((s) => {
    if (categoryFilter !== 'all' && s.category !== categoryFilter) return false
    if (keyword.trim()) {
      const kw = keyword.trim().toLowerCase()
      if (!s.name.toLowerCase().includes(kw) && !s.code.toLowerCase().includes(kw)) return false
    }
    return true
  }), [categoryFilter, keyword])

  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const resetPage = () => setPage(1)

  const openEdit = (row: CalcSubjectRow) => {
    setEditing(row)
    setDraftFormula(formulas[row.name] ?? '')
  }

  const saveFormula = () => {
    if (!editing) return
    setFormulas((prev) => ({ ...prev, [editing.name]: draftFormula.trim() }))
    setEditing(null)
  }

  const columns: DataTableColumn<CalcSubjectRow>[] = [
    { key: 'code', header: '科目编码', cellClassName: 'font-mono text-muted-foreground' },
    { key: 'name', header: '科目名称', cellClassName: 'font-medium' },
    { key: 'category', header: '类别', cellClassName: 'text-muted-foreground' },
    { key: 'level', header: '层级', render: (r) => <Badge variant="outline">level{r.level}</Badge> },
    {
      key: 'formula', header: '公式', cellClassName: 'font-mono',
      render: (r) => formulas[r.name] ? formulas[r.name] : <span className="text-muted-foreground">—</span>,
    },
    {
      key: 'actions', header: '操作', align: 'right', render: (r) =>
        canManage ? (
          <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
            <Pencil className="mr-1 h-4 w-4" />
            编辑公式
          </Button>
        ) : (
          <span className="text-muted-foreground">-</span>
        ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:space-x-2 sm:space-y-0">
        <Select value={categoryFilter} onValueChange={(v) => { setCategoryFilter(v); resetPage() }}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <SelectValue placeholder="选择类别" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类别</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>{cat}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="搜索科目名称或编码..."
          value={keyword}
          onChange={(e) => { setKeyword(e.target.value); resetPage() }}
          className="flex-1"
        />
      </div>

      <p className="text-xs text-muted-foreground">共 {filtered.length} 个计算类科目</p>

      <DataTable columns={columns} data={paged} rowKey={(r) => r.code} emptyText="暂无计算类科目" />

      <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onPageChange={setPage} />

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>编辑公式</DialogTitle>
            <DialogDescription>
              {editing ? `${editing.name}（${editing.code}）` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">公式表达式</label>
            <Input
              value={draftFormula}
              onChange={(e) => setDraftFormula(e.target.value)}
              placeholder="如：收入 - 成本"
            />
            <p className="text-xs text-muted-foreground">
              仅更新本地状态用于演示，不会持久化到后端。
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>取消</Button>
            <Button onClick={saveFormula}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
