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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { useCompanies } from '@/hooks/api-queries'
import { useSubjectBudgetConfigs, useSubjectBudgetConfigCheck, useSubjectBudgetConfigMutations } from '@/hooks/api-queries'
import { cn } from '@/lib/utils'
import { Plus, RefreshCw, Pencil, Trash2, AlertTriangle, Loader2 } from 'lucide-react'
import type { SubjectBudgetConfig } from '@/types'

interface SubjectBudgetPanelProps {
  canCreate?: boolean
  canUpdate?: boolean
  canDelete?: boolean
}

/**
 * 主体展示配置管理面板（主体预算达成分析）：维护看板主体预算达成分析展示的主体（排序/启停），
 * 并展示公司表变化检测结果（公司表新增但未配置的主体）。
 */
export function SubjectBudgetPanel({ canCreate = false, canUpdate = false, canDelete = false }: SubjectBudgetPanelProps) {
  const queryClient = useQueryClient()
  const { data: configs, isLoading } = useSubjectBudgetConfigs()
  const { data: check } = useSubjectBudgetConfigCheck()
  const mutations = useSubjectBudgetConfigMutations()
  const { confirm, element: confirmElement } = useConfirm()
  const { data: companies } = useCompanies()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SubjectBudgetConfig | null>(null)
  const [form, setForm] = useState({ companyCode: '', sortOrder: '', status: 'active' as 'active' | 'inactive' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 可新增候选：公司表 active 主体中尚未配置的
  const configuredCodes = useMemo(() => new Set((configs ?? []).map((c) => c.companyCode)), [configs])
  const candidates = useMemo(() => (companies ?? []).filter((c) => !configuredCodes.has(c.code)), [companies, configuredCodes])
  const entityCandidates = candidates.filter((c) => c.type === 'entity')
  const summaryCandidates = candidates.filter((c) => c.type === 'summary')

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['data', 'subject-budget-configs'] })
  }

  const openCreate = () => {
    setEditing(null)
    setForm({ companyCode: '', sortOrder: '', status: 'active' })
    setError(null)
    setDialogOpen(true)
  }

  const openEdit = (row: SubjectBudgetConfig) => {
    setEditing(row)
    setForm({ companyCode: row.companyCode, sortOrder: String(row.sortOrder), status: row.status })
    setError(null)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!editing && !form.companyCode) {
      setError('请选择主体')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = { sortOrder: form.sortOrder ? Number(form.sortOrder) : 0, status: form.status }
      if (editing) {
        await mutations.update.mutateAsync({ id: editing.id, ...payload })
      } else {
        await mutations.create.mutateAsync({ companyCode: form.companyCode, ...payload })
      }
      setDialogOpen(false)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (row: SubjectBudgetConfig) => {
    const ok = await confirm({
      title: '移除主体配置',
      description: `将移除主体「${row.companyName}」，看板主体预算达成分析将不再展示该主体。`,
      confirmText: '移除',
      danger: true,
    })
    if (!ok) return
    try {
      await mutations.remove.mutateAsync(row.id)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? '移除失败')
    }
  }

  const unconfigured = check?.unconfiguredSubjects ?? []
  const hasWarnings = unconfigured.length > 0

  // 配置列表列（权限门禁行操作；斑马纹由 rowClassName 表达）
  const columns: DataTableColumn<SubjectBudgetConfig>[] = useMemo(() => {
    const cols: DataTableColumn<SubjectBudgetConfig>[] = [
      { key: 'companyName', header: '主体名称', cellClassName: 'font-medium text-foreground' },
      {
        key: 'entityType', header: '类型',
        render: (row) => (
          <Badge variant={row.entityType === 'summary' ? 'secondary' : 'outline'} className="text-[10px]">
            {row.entityType === 'summary' ? '汇总主体' : '单体公司'}
          </Badge>
        ),
      },
      { key: 'sortOrder', header: '排序', align: 'right', cellClassName: 'font-num text-foreground' },
      {
        key: 'status', header: '状态',
        render: (row) => (
          <Badge variant={row.status === 'active' ? 'default' : 'secondary'} className="text-[10px]">
            {row.status === 'active' ? '启用' : '停用'}
          </Badge>
        ),
      },
    ]
    if (canUpdate || canDelete) {
      cols.push({
        key: 'actions', header: '操作', align: 'right',
        render: (row) => (
          <div className="flex justify-end gap-1">
            {canUpdate && (
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => openEdit(row)} title="编辑主体配置">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            {canDelete && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => handleDelete(row)} title="移除主体配置">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ),
      })
    }
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openEdit/handleDelete 为组件内闭包，重算代价可忽略
  }, [canUpdate, canDelete, openEdit, handleDelete])

  return (
    <div className="space-y-4">
      {/* 说明 + 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs text-muted-foreground">
          维护看板「主体预算达成分析」展示的主体：仅配置且启用（active）的主体会在看板中展示。
          公司表新增主体后，点击「刷新检测」查看未配置主体并加入展示列表。
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            刷新检测
          </Button>
          {canCreate && (
            <Button size="sm" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" />
              新增主体
            </Button>
          )}
        </div>
      </div>

      {/* 检测结果警示 */}
      {hasWarnings && (
        <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
          <div className="flex items-start gap-2 text-xs">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-strong" />
            <div>
              <span className="font-medium text-warning-strong">公司表存在未配置展示的主体</span>
              <span className="ml-2 text-muted-foreground">（新增主体后需在此加入展示列表）</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {unconfigured.map((s) => (
                  <span key={s.code} className="rounded-full bg-warning/10 px-2 py-0.5 text-warning-strong">
                    {s.name}（{s.entityType === 'summary' ? '汇总' : '公司'}）
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 配置列表 */}
      <DataTable
        columns={columns}
        data={configs ?? []}
        rowKey={(r) => r.id}
        density="compact"
        emptyText="暂无主体配置，点击「新增主体」创建"
        caption="主体展示配置列表"
        rowClassName={(_, i) => (i % 2 === 1 ? 'bg-muted/30' : undefined)}
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
            <DialogTitle>{editing ? '编辑主体配置' : '新增主体配置'}</DialogTitle>
            <DialogDescription>
              配置的主体将展示在看板主体预算达成分析中；排序值越小越靠前，停用后不再展示。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {editing ? (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">主体</Label>
                <div className="rounded-md border border-border px-3 py-2 text-sm text-foreground">{editing.companyName}</div>
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">主体（选择未配置的公司/汇总主体）</Label>
                <Select value={form.companyCode} onValueChange={(v) => setForm((f) => ({ ...f, companyCode: v }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择主体" />
                  </SelectTrigger>
                  <SelectContent>
                    {entityCandidates.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>公司</SelectLabel>
                        {entityCandidates.map((c) => (
                          <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {summaryCandidates.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>汇总主体</SelectLabel>
                        {summaryCandidates.map((c) => (
                          <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                    {candidates.length === 0 && <SelectItem value="__none__" disabled>暂无未配置主体</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
            )}
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
