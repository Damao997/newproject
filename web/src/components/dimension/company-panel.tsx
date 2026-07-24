import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useCompanies, useCreateCompany, useUpdateCompany, useDeleteCompany } from '@/hooks/api-queries'
import { Plus, Pencil, Trash2, Search } from 'lucide-react'
import type { Company } from '@/types'

interface CompanyPanelProps {
  canCreate?: boolean
  canUpdate?: boolean
  canDelete?: boolean
}

interface CompanyForm {
  code: string
  name: string
  entityType: 'single' | 'summary'
}

const emptyForm: CompanyForm = { code: '', name: '', entityType: 'single' }

/**
 * 公司主体管理：列表 + 搜索 + 新增/编辑（编码不可变）+ 停用（软删除，引用保护）。
 */
export function CompanyPanel({ canCreate = false, canUpdate = false, canDelete = false }: CompanyPanelProps) {
  const { data, isLoading } = useCompanies()
  const createCompany = useCreateCompany()
  const updateCompany = useUpdateCompany()
  const deleteCompany = useDeleteCompany()
  const { confirm, element: confirmElement } = useConfirm()

  const [keyword, setKeyword] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<CompanyForm>(emptyForm)
  const [error, setError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const companies = useMemo(() => (data ?? []) as Company[], [data])
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return companies
    return companies.filter((c) => c.name.toLowerCase().includes(kw) || c.code.toLowerCase().includes(kw))
  }, [companies, keyword])

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
    setError(null)
    setDialogOpen(true)
  }

  const openEdit = (c: Company) => {
    setEditingId(c.id)
    setForm({
      code: c.code,
      name: c.name,
      entityType: (c.entityType ?? (c.type === 'summary' ? 'summary' : 'single')) as 'single' | 'summary',
    })
    setError(null)
    setDialogOpen(true)
  }

  const submit = async () => {
    setError(null)
    try {
      const payload = {
        name: form.name.trim(),
        entityType: form.entityType,
      }
      if (editingId) {
        await updateCompany.mutateAsync({ id: editingId, data: payload })
      } else {
        if (!form.code.trim()) { setError('公司编码必填'); return }
        await createCompany.mutateAsync({ ...payload, code: form.code.trim() })
      }
      setDialogOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleDelete = async (c: Company) => {
    if (!(await confirm({ title: '停用公司', description: `确认停用公司「${c.name}」？被事实数据/用户/汇总映射引用时将无法停用。`, danger: true, confirmText: '停用' }))) return
    setListError(null)
    try {
      await deleteCompany.mutateAsync(c.id)
    } catch (err) {
      setListError(err instanceof Error ? err.message : '停用失败')
    }
  }

  const hasActions = canUpdate || canDelete
  const columns: DataTableColumn<Company>[] = [
    { key: 'code', header: '公司编码', cellClassName: 'font-mono text-muted-foreground' },
    { key: 'name', header: '公司名称', cellClassName: 'font-medium' },
    {
      key: 'type', header: '类型',
      render: (c) => (c.type === 'summary' ? <Badge variant="default">汇总主体</Badge> : <Badge variant="secondary">单体公司</Badge>),
    },
    {
      key: 'status', header: '状态',
      render: (c) => (c.status === 'active' ? <Badge variant="success">启用</Badge> : <Badge variant="secondary">停用</Badge>),
    },
    ...(hasActions
      ? [{
          key: 'actions', header: '操作', align: 'right' as const,
          render: (c: Company) => (
            <div className="flex items-center justify-end gap-1">
              {canUpdate && (
                <Button variant="ghost" size="sm" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
              )}
              {canDelete && c.status === 'active' && (
                <Button variant="ghost" size="sm" onClick={() => handleDelete(c)}><Trash2 className="h-4 w-4" /></Button>
              )}
            </div>
          ),
        }]
      : []),
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col space-y-2 sm:flex-row sm:items-center sm:space-x-2 sm:space-y-0">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="搜索公司名称或编码..." value={keyword} onChange={(e) => setKeyword(e.target.value)} className="pl-8" />
        </div>
        {canCreate && (
          <Button variant="outline" size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> 新增公司
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{isLoading ? '加载中...' : `共 ${filtered.length} 家公司`}</p>
      {listError && <p className="text-xs text-destructive">{listError}</p>}

      <DataTable columns={columns} data={filtered} rowKey={(c) => c.id} emptyText={isLoading ? '加载中...' : '暂无公司'} />

      <Dialog open={dialogOpen} onOpenChange={(o) => !o && setDialogOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? '编辑公司' : '新增公司'}</DialogTitle>
            <DialogDescription>{editingId ? '编码不可修改；类型/名称可编辑' : '创建单体公司或汇总主体'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>公司编码</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} disabled={!!editingId} placeholder="如：C001（编码不可修改）" />
            </div>
            <div className="space-y-1">
              <Label>公司名称</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="公司名称" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>类型</Label>
                <Select value={form.entityType} onValueChange={(v) => setForm({ ...form, entityType: v as 'single' | 'summary' })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">单体公司</SelectItem>
                    <SelectItem value="summary">汇总主体</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={submit} disabled={createCompany.isPending || updateCompany.isPending || !form.name.trim()}>
              {createCompany.isPending || updateCompany.isPending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmElement}
    </div>
  )
}
