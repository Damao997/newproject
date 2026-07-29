import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
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
import { getCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { useCompanyDisplayStore } from '@/stores/companyDisplayStore'
import { Plus, Pencil, Trash2, Search, RotateCcw } from 'lucide-react'
import type { Company } from '@/types'

interface CompanyPanelProps {
  canCreate?: boolean
  canUpdate?: boolean
  canDelete?: boolean
}

interface CompanyForm {
  code: string
  name: string
  shortName: string
  entityType: 'single' | 'summary'
}

const emptyForm: CompanyForm = { code: '', name: '', shortName: '', entityType: 'single' }

/**
 * 公司主体管理：列表 + 搜索 + 新增/编辑（编码不可变）+ 停用（软删除，引用保护）+ 重新启用。
 * 公司为基础数据，仅允许软删除（status→inactive），不允许物理删除。
 */
export function CompanyPanel({ canCreate = false, canUpdate = false, canDelete = false }: CompanyPanelProps) {
  const showInactive = canUpdate || canDelete
  const { data, isLoading } = useCompanies(showInactive ? { includeInactive: 'true' } : undefined)
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
  const showShortName = useCompanyDisplayStore((s) => s.showShortName)
  const setShowShortName = useCompanyDisplayStore((s) => s.setShowShortName)

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
      shortName: c.shortName ?? '',
      entityType: (c.entityType ?? (c.type === 'summary' ? 'summary' : 'single')) as 'single' | 'summary',
    })
    setError(null)
    setDialogOpen(true)
  }

  const submit = async () => {
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        entityType: form.entityType,
      }
      // 简称仅对单体公司有效
      if (form.entityType === 'single') {
        payload.shortName = form.shortName.trim() || null
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

  const handleReEnable = async (c: Company) => {
    if (!(await confirm({ title: '重新启用公司', description: `确认重新启用公司「${c.name}」（${c.code}）？启用后将重新出现在各业务模块中。`, confirmText: '启用' }))) return
    setListError(null)
    try {
      await updateCompany.mutateAsync({ id: c.id, data: { status: 'active' } })
    } catch (err) {
      setListError(err instanceof Error ? err.message : '启用失败')
    }
  }

  const hasActions = canUpdate || canDelete
  const columns: DataTableColumn<Company>[] = [
    { key: 'code', header: '公司编码', cellClassName: 'font-mono text-muted-foreground' },
    {
      key: 'name', header: '公司名称', cellClassName: 'font-medium',
      render: (c) => (
        <span title={c.name}>
          {getCompanyDisplayName(c, showShortName)}
          {showShortName && c.shortName && <span className="ml-1 text-xs text-muted-foreground">({c.name})</span>}
        </span>
      ),
    },
    {
      key: 'shortName', header: '简称',
      render: (c) => (c.shortName ? <span className="text-muted-foreground">{c.shortName}</span> : <span className="text-muted-foreground/50">—</span>),
    },
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
              {canUpdate && c.status !== 'active' && (
                <Button variant="ghost" size="sm" className="text-primary hover:text-primary" title="重新启用" onClick={() => handleReEnable(c)}>
                  <RotateCcw className="h-4 w-4" />
                </Button>
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
        <div className="flex items-center gap-2">
          <Label htmlFor="show-short-name" className="text-xs text-muted-foreground whitespace-nowrap">显示简称</Label>
          <Switch id="show-short-name" checked={showShortName} onCheckedChange={setShowShortName} />
        </div>
        {canCreate && (
          <Button variant="outline" size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> 新增公司
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">{isLoading ? '加载中...' : `共 ${filtered.length} 家公司`}</p>
      {listError && <p className="text-xs text-destructive">{listError}</p>}

      <DataTable columns={columns} data={filtered} rowKey={(c) => c.id} dense emptyText={isLoading ? '加载中...' : '暂无公司'} />

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
            {form.entityType === 'single' && (
              <div className="space-y-1">
                <Label>公司简称 <span className="text-muted-foreground font-normal">（可选，用于界面简短显示）</span></Label>
                <Input value={form.shortName} onChange={(e) => setForm({ ...form, shortName: e.target.value })} placeholder="如：壹品慧" maxLength={100} />
              </div>
            )}
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
