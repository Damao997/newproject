import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
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
import { useExpenseMappings, useExpenseMappingCheck, useExpenseMappingMutations } from '@/hooks/api-queries'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Plus, RefreshCw, Pencil, Trash2, AlertTriangle, XCircle, Loader2, Check } from 'lucide-react'
import type { ExpenseMapping, ExpenseMappingCheckResult } from '@/types'

interface ExpenseMappingPanelProps {
  canCreate?: boolean
  canUpdate?: boolean
  canDelete?: boolean
}

interface MappingForm {
  code: string
  name: string
  subjectCodes: string[]
  sortOrder: string
  status: 'active' | 'inactive'
}

const EMPTY_FORM: MappingForm = { code: '', name: '', subjectCodes: [], sortOrder: '', status: 'active' }

/** 映射编码合法格式（与后端 isValidMappingCode 一致）：一对一=科目编码（PL 前缀）；归并/自定义=EXP_ 前缀（小写英文/数字序号） */
const MAPPING_CODE_RE = /^(PL[0-9]+|EXP_[a-z0-9][a-z0-9_]*)$/

/**
 * 运营费用映射管理面板（运营费用分析）：维护展示指标 ↔ 经营科目编码集合的对应关系，
 * 并展示科目树变化检测结果（未配置科目 / 失效编码 / 无数据科目）。
 */
export function ExpenseMappingPanel({ canCreate = false, canUpdate = false, canDelete = false }: ExpenseMappingPanelProps) {
  const queryClient = useQueryClient()
  const { data: mappings, isLoading } = useExpenseMappings()
  const { data: check } = useExpenseMappingCheck()
  const mutations = useExpenseMappingMutations()
  const { confirm, element: confirmElement } = useConfirm()

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ExpenseMapping | null>(null)
  const [form, setForm] = useState<MappingForm>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [codeLoading, setCodeLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['data', 'expense-mappings'] })
  }

  const toggleSubject = (code: string) => {
    setForm((f) => {
      const next = f.subjectCodes.includes(code) ? f.subjectCodes.filter((c) => c !== code) : [...f.subjectCodes, code]
      return { ...f, subjectCodes: next }
    })
  }

  const openCreate = async () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setError(null)
    setCodeLoading(true)
    setDialogOpen(true)
    try {
      // 预取下一个统一编码（EXP_ 数字序号，系统自动生成）
      const { code } = await api.getNextExpenseMappingCode()
      setForm((f) => ({ ...f, code }))
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? '自动编码获取失败，请重试')
    } finally {
      setCodeLoading(false)
    }
  }

  const openEdit = (row: ExpenseMapping) => {
    setEditing(row)
    setForm({
      code: row.code,
      name: row.name,
      subjectCodes: [...row.subjectCodes],
      sortOrder: String(row.sortOrder),
      status: row.status,
    })
    setError(null)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError('展示名称必填')
      return
    }
    if (!editing && !form.code.trim()) {
      setError('自动编码获取失败，请关闭对话框后重新打开')
      return
    }
    if (!editing && !MAPPING_CODE_RE.test(form.code.trim())) {
      setError('映射编码需为科目编码（PL 前缀）或 EXP_ 前缀（小写英文/数字序号，如 EXP_001）')
      return
    }
    if (form.subjectCodes.length === 0) {
      setError('至少选择 1 个运营费用科目')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: form.name.trim(),
        subjectCodes: form.subjectCodes,
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

  const handleDelete = async (row: ExpenseMapping) => {
    const ok = await confirm({
      title: '删除运营费用映射',
      description: `将删除映射「${row.name}」，看板运营费用分析将不再展示该指标。`,
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

  // check.mappings 含 hasData/matchedSubjects（list 接口的 DTO 无这些字段），作为列表唯一渲染源；
  // 顺序同为 sortOrder 升序，与 list 等价且信息更全；fallback（check 未返回）仅作加载期兜底
  const rows = (check?.mappings ?? mappings ?? []) as ExpenseMappingCheckResult['mappings']
  const hasWarnings = (check?.uncoveredSubjects.length ?? 0) > 0 || (check?.brokenCodes.length ?? 0) > 0

  // 映射列表列（权限门禁行操作）
  const columns: DataTableColumn<(typeof rows)[number]>[] = useMemo(() => {
    const cols: DataTableColumn<(typeof rows)[number]>[] = [
      { key: 'name', header: '展示名称', cellClassName: 'font-medium text-foreground' },
      {
        key: 'matchedSubjects', header: '引用科目',
        render: (row) => {
          const matched = row.matchedSubjects ?? []
          return !row.hasData ? (
            <span className="text-xs text-destructive">暂无数据/预算（导入后展示）</span>
          ) : matched.length > 0 ? (
            <div className="flex max-w-md flex-wrap gap-1">
              {matched.map((s) => (
                <span key={s} className="rounded bg-muted px-1.5 py-0.5 text-caption text-muted-foreground">{s}</span>
              ))}
            </div>
          ) : (
            <span className="text-xs text-destructive">无匹配科目</span>
          )
        },
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
    ]
    if (canUpdate || canDelete) {
      cols.push({
        key: 'actions', header: '操作', align: 'right',
        render: (row) => (
          <div className="flex justify-end gap-1">
            {canUpdate && (
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => openEdit(row)} title="编辑映射">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            {canDelete && (
              <Button variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive" onClick={() => handleDelete(row)} title="删除映射">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ),
      })
    }
    return cols
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openEdit/handleDelete 为组件内闭包，重算代价可忽略（对齐 import-panel 惯例）
  }, [canUpdate, canDelete, openEdit, handleDelete])

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
              新增映射
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
                <span className="font-medium text-warning-strong">运营费用下存在未配置的科目</span>
                <span className="ml-2 text-muted-foreground">（新增科目后可在此将其纳入映射）</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {check!.uncoveredSubjects.map((s) => (
                    <span key={s} className="rounded-full bg-warning/10 px-2 py-0.5 text-warning-strong">{s}</span>
                  ))}
                </div>
              </div>
            </div>
          )}
          {(check?.brokenCodes?.length ?? 0) > 0 && (
            <div className="flex items-start gap-2 text-xs">
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              <div>
                <span className="font-medium text-destructive">以下映射引用的科目编码已失效</span>
                <span className="ml-2 text-muted-foreground">（科目可能已停用/删除，或不在运营费用范围内，请修正映射）</span>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {check!.brokenCodes.map((c) => (
                    <span key={c} className="rounded-full bg-destructive/10 px-2 py-0.5 font-mono text-destructive">{c}</span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 映射列表 */}
      <DataTable
        columns={columns}
        data={rows}
        rowKey={(r) => r.id}
        density="compact"
        emptyText="暂无映射配置，点击「新增映射」创建"
        caption="运营费用映射列表"
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? '编辑运营费用映射' : '新增运营费用映射'}</DialogTitle>
            <DialogDescription>
              展示名称将显示在看板运营费用分析中；选中的科目编码对应费用科目树的叶子科目，多个科目自动汇总求和。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">映射编码（系统自动生成，创建后不可修改）</Label>
                <Input
                  value={form.code}
                  readOnly
                  placeholder={codeLoading ? '生成中...' : '系统自动生成'}
                  disabled={!!editing}
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">展示名称</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="如 人力成本"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">引用科目（可多选，选中科目汇总为一行；标注"暂无数据"的科目导入数据/预算后才会在看板展示）</Label>
              <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
                {(check?.candidates?.length ?? 0) === 0 && (
                  <p className="text-xs text-muted-foreground">未检测到运营费用科目（科目树中可能尚未配置「费用 &gt; 壹品慧费用 &gt; 运营费用」）</p>
                )}
                {(check?.candidates ?? []).map((group) => (
                  <div key={group.group}>
                    <p className="mb-1.5 text-xs font-medium text-foreground">{group.group}</p>
                    <div className="grid grid-cols-2 gap-1">
                      {group.items.map((item) => {
                        const selected = form.subjectCodes.includes(item.code)
                        return (
                          <label
                            key={item.code}
                            className={cn(
                              'flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition-colors',
                              selected ? 'border-primary/50 bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:bg-muted/50',
                            )}
                          >
                            <Checkbox
                              size="sm"
                              className="shrink-0"
                              checked={selected}
                              onCheckedChange={() => toggleSubject(item.code)}
                            />
                            <span className="flex-1 truncate" title={item.name}>{item.name}</span>
                            {!item.hasData && <span className="shrink-0 text-micro text-muted-foreground">（暂无数据）</span>}
                            {selected && <Check className="h-3 w-3 shrink-0 text-primary" />}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
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
