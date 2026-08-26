import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { useProductCategories, useProductCategoryCheck, useProductCategoryMutations } from '@/hooks/api-queries'
import { cn } from '@/lib/utils'
import { Plus, RefreshCw, Pencil, Trash2, AlertTriangle, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import type { ProductCategory } from '@/types'

interface ProductCategoryPanelProps {
  canCreate?: boolean
  canUpdate?: boolean
  canDelete?: boolean
}

interface CategoryForm {
  code: string
  name: string
  subjectKeyword: string
  sortOrder: string
  status: 'active' | 'inactive'
}

const EMPTY_FORM: CategoryForm = { code: '', name: '', subjectKeyword: '', sortOrder: '', status: 'active' }

/**
 * 品类配置管理面板（品类预算达成分析）：维护品类 ↔ 收入科目名关键词的对应关系，
 * 并展示科目树变化检测结果（未覆盖科目 / 失效关键词 / 毛利镜像缺失）。
 */
export function ProductCategoryPanel({ canCreate = false, canUpdate = false, canDelete = false }: ProductCategoryPanelProps) {
  const queryClient = useQueryClient()
  const { data: categories, isLoading } = useProductCategories()
  const { data: check } = useProductCategoryCheck()
  const mutations = useProductCategoryMutations()
  const { confirm, element: confirmElement } = useConfirm()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ProductCategory | null>(null)
  const [form, setForm] = useState<CategoryForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['data', 'product-categories'] })
  }

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError(null)
    setDialogOpen(true)
  }

  const openEdit = (row: ProductCategory) => {
    setEditing(row)
    setForm({
      code: row.code,
      name: row.name,
      subjectKeyword: row.subjectKeyword,
      sortOrder: String(row.sortOrder),
      status: row.status,
    })
    setError(null)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.subjectKeyword.trim()) {
      setError('品类名称与匹配关键词必填')
      return
    }
    if (!editing && !form.code.trim()) {
      setError('品类编码必填')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: form.name.trim(),
        subjectKeyword: form.subjectKeyword.trim(),
        sortOrder: form.sortOrder ? Number(form.sortOrder) : 0,
        status: form.status,
      }
      if (editing) {
        await mutations.update.mutateAsync({ id: editing.id, ...payload })
      } else {
        await mutations.create.mutateAsync({ code: form.code.trim(), ...payload })
      }
      setDialogOpen(false)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (row: ProductCategory) => {
    const ok = await confirm({
      title: '删除品类配置',
      description: `将删除品类「${row.name}」，看板品类预算达成分析将不再展示该品类。`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    try {
      await mutations.remove.mutateAsync(row.id)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? '删除失败')
    }
  }

  const checkMap = new Map((check?.categories ?? []).map((c) => [c.id, c]))
  const hasWarnings = (check?.uncoveredSubjects.length ?? 0) > 0 || (check?.brokenKeywords.length ?? 0) > 0 || (check?.missingProfitMirror.length ?? 0) > 0

  // 品类列表列（含科目树变化检测结果与权限门禁行操作）
  const columns: DataTableColumn<ProductCategory>[] = useMemo(() => {
    const cols: DataTableColumn<ProductCategory>[] = [
      { key: 'name', header: '品类名称', cellClassName: 'font-medium text-foreground' },
      {
        key: 'subjectKeyword', header: '匹配关键词',
        render: (row) => (
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">{row.subjectKeyword}</code>
        ),
      },
      { key: 'sortOrder', header: '排序', align: 'right', cellClassName: 'font-num text-foreground' },
      {
        key: 'status', header: '状态',
        render: (row) => (
          <Badge variant={row.status === 'active' ? 'default' : 'secondary'} className="text-micro">
            {row.status === 'active' ? '启用' : '停用'}
          </Badge>
        ),
      },
      {
        key: 'matchedSubjects', header: '匹配科目',
        render: (row) => {
          const matched = checkMap.get(row.id)?.matchedSubjects ?? []
          return matched.length > 0 ? (
            <div className="flex max-w-xs flex-wrap gap-1">
              {matched.map((s) => (
                <span key={s} className="rounded bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">{s}</span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-destructive">无匹配科目</span>
          )
        },
      },
      {
        key: 'profitOk', header: '毛利镜像',
        render: (row) => {
          const item = checkMap.get(row.id)
          return !item ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : item.profitOk ? (
            <span className="inline-flex items-center gap-1 text-xs text-success-strong">
              <CheckCircle2 className="h-3.5 w-3.5" />齐全
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-destructive">
              <XCircle className="h-3.5 w-3.5" />缺失
            </span>
          )
        },
      },
    ]
    if (canUpdate || canDelete) {
      cols.push({
        key: 'actions', header: '操作', align: 'right',
        render: (row) => (
          <div className="flex justify-end gap-1">
            {canUpdate && (
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => openEdit(row)} title="编辑品类">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            {canDelete && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => handleDelete(row)} title="删除品类">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ),
      })
    }
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openEdit/handleDelete/checkMap 为组件内闭包/派生对象，重算代价可忽略
  }, [canUpdate, canDelete, openEdit, handleDelete, checkMap])

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新检测
          </Button>
          {canCreate && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              新增品类
            </Button>
          )}
        </div>
      </div>

      {/* 检测结果警示 */}
      {hasWarnings && (
        <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
          {(check?.uncoveredSubjects?.length ?? 0) > 0 && (
            <div className="flex items-start gap-2 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-strong" />
              <div>
                <span className="font-medium text-warning-strong">科目树中存在未配置的收入科目</span>
                <span className="ml-2 text-muted-foreground">（新增业务线后可在此新建品类配置；分类汇总层「壹品慧收入/增值业务收入」无需配置）</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {check!.uncoveredSubjects.map((s) => (
                    <span key={s} className="rounded-full bg-warning/10 px-2 py-0.5 text-warning-strong">{s}</span>
                  ))}
                </div>
              </div>
            </div>
          )}
          {(check?.brokenKeywords?.length ?? 0) > 0 && (
            <div className="flex items-start gap-2 text-xs">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              <div>
                <span className="font-medium text-destructive">以下品类关键词在科目树中无匹配科目</span>
                <span className="ml-2 text-muted-foreground">（科目可能已改名/停用，请修正关键词）</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {check!.brokenKeywords.map((k) => (
                    <span key={k} className="rounded-full bg-destructive/10 px-2 py-0.5 text-destructive">{k}</span>
                  ))}
                </div>
              </div>
            </div>
          )}
          {(check?.missingProfitMirror?.length ?? 0) > 0 && (
            <div className="flex items-start gap-2 text-xs">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              <div>
                <span className="font-medium text-destructive">以下品类缺少毛利镜像科目</span>
                <span className="ml-2 text-muted-foreground">（请在毛利类别下补充同名"XX毛利"科目）</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {check!.missingProfitMirror.map((m) => (
                    <span key={m} className="rounded-full bg-destructive/10 px-2 py-0.5 text-destructive">{m}</span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 品类列表 */}
      <DataTable
        columns={columns}
        data={categories ?? []}
        rowKey={(r) => r.id}
        density="compact"
        emptyText="暂无品类配置，点击「新增品类」创建"
        caption="品类配置列表"
        loading={isLoading}
      />

      {error && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </p>
      )}

      {/* 新增/编辑对话框 */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o && !saving) { setDialogOpen(false); setError(null) } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑品类配置' : '新增品类配置'}</DialogTitle>
            <DialogDescription>
              品类名称将展示在看板品类预算达成分析中；匹配关键词对应经营科目树收入类别下的科目名（可命中多个科目并自动求和）。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">品类编码（唯一，创建后不可修改）</Label>
              <Input
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                placeholder="如 kitchen"
                disabled={!!editing}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">品类名称</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="如 厨房产品销售（不含净水及服务）"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">匹配关键词</Label>
              <Input
                value={form.subjectKeyword}
                onChange={(e) => setForm((f) => ({ ...f, subjectKeyword: e.target.value }))}
                placeholder="如 厨房产品销售"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">排序（升序展示）</Label>
                <Input
                  type="number"
                  value={form.sortOrder}
                  onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">状态</Label>
                <div className="flex items-center gap-3 pt-2">
                  {(['active', 'inactive'] as const).map((s) => (
                    <label key={s} className={cn('flex cursor-pointer items-center gap-1.5 text-sm', form.status === s ? 'text-foreground' : 'text-muted-foreground')}>
                      <input
                        type="radio"
                        className="h-3.5 w-3.5 accent-primary"
                        checked={form.status === s}
                        onChange={() => setForm((f) => ({ ...f, status: s }))}
                      />
                      {s === 'active' ? '启用' : '停用'}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? '保存' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmElement}
    </div>
  )
}
