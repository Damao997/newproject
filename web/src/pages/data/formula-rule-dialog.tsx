import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  useFormulaRules,
  useCreateFormulaRule,
  useUpdateFormulaRule,
  useToggleFormulaRule,
  useDeleteFormulaRule,
} from '@/hooks/api-queries'
import { Plus, Trash2 } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'

interface RuleManageDialogProps {
  open: boolean
  onClose: () => void
  canUpdate?: boolean
  canDelete?: boolean
  formatFormula?: (f: string | null | undefined) => string
}

interface RuleRow {
  id: string
  name: string
  formulaTemplate: string
  description: string | null
  enabled: boolean
}

/**
 * 公式规则库管理：规则的增删改与启停（规则用于批量生成公式）。
 */
export function RuleManageDialog({ open, onClose, canUpdate = false, canDelete = false, formatFormula }: RuleManageDialogProps) {
  const { data, isLoading } = useFormulaRules()
  const createRule = useCreateFormulaRule()
  const updateRule = useUpdateFormulaRule()
  const toggleRule = useToggleFormulaRule()
  const deleteRule = useDeleteFormulaRule()
  const { confirm, element: confirmElement } = useConfirm()

  const [newName, setNewName] = useState('')
  const [newTemplate, setNewTemplate] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTemplate, setEditTemplate] = useState('')

  const rules = (data ?? []) as unknown as RuleRow[]

  const validateTemplate = (tpl: string): string | null => {
    if (!tpl.trim()) return '公式模板不能为空'
    const expr = tpl.replace(/\{[^}]+\}/g, '0')
    if (!/^[0-9+\-*/().\s]+$/.test(expr)) return '模板含非法字符（仅支持 +-*/() 数字与 {编码} 引用）'
    return null
  }

  const handleCreate = async () => {
    setError(null)
    if (!newName.trim() || !newTemplate.trim()) {
      setError('规则名称与公式模板必填')
      return
    }
    try {
      await createRule.mutateAsync({ name: newName.trim(), formulaTemplate: newTemplate.trim(), description: newDesc.trim() || undefined })
      setNewName('')
      setNewTemplate('')
      setNewDesc('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败')
    }
  }

  const handleSaveEdit = async (id: string) => {
    setError(null)
    try {
      await updateRule.mutateAsync({ id, data: { formulaTemplate: editTemplate.trim() } })
      setEditingId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleDelete = async (row: RuleRow) => {
    if (!(await confirm({ title: '删除规则', description: `确认删除规则「${row.name}」？`, danger: true, confirmText: '删除' }))) return
    try {
      await deleteRule.mutateAsync(row.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>公式规则库管理</DialogTitle>
          <DialogDescription>规则用于「批量生成公式」：按业务名匹配指标，套用公式模板。</DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">加载中...</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-2 text-left font-medium">规则名</th>
                  <th className="p-2 text-left font-medium">公式模板</th>
                  <th className="p-2 text-left font-medium">状态</th>
                  <th className="p-2 text-left font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-b">
                    <td className="p-2">
                      {r.name}
                      {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}
                    </td>
                    <td className="p-2 font-mono">
                      {editingId === r.id ? (
                        <div className="flex items-center space-x-1">
                          <Input value={editTemplate} onChange={(e) => setEditTemplate(e.target.value)} className="h-8 font-mono" />
                          <Button size="sm" onClick={() => handleSaveEdit(r.id)} disabled={updateRule.isPending || !!validateTemplate(editTemplate)}>保存</Button>
                        </div>
                      ) : (
                        <>
                          {r.formulaTemplate}
                          {formatFormula && <p className="text-xs text-muted-foreground">{formatFormula(r.formulaTemplate)}</p>}
                        </>
                      )}
                    </td>
                    <td className="p-2">
                      {r.enabled ? <Badge variant="success">启用</Badge> : <Badge variant="secondary">停用</Badge>}
                    </td>
                    <td className="p-2">
                      <div className="flex items-center space-x-1">
                        {canUpdate && editingId !== r.id && (
                          <Button variant="ghost" size="sm" onClick={() => { setEditingId(r.id); setEditTemplate(r.formulaTemplate) }}>编辑</Button>
                        )}
                        {canUpdate && (
                          <Button variant="ghost" size="sm" onClick={() => toggleRule.mutate({ id: r.id, enabled: !r.enabled })}>
                            {r.enabled ? '停用' : '启用'}
                          </Button>
                        )}
                        {canDelete && (
                          <Button variant="ghost" size="sm" onClick={() => handleDelete(r)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canUpdate && (
          <div className="space-y-2 rounded-lg border border-dashed p-3">
            <p className="flex items-center gap-1 text-sm font-medium"><Plus className="h-4 w-4" /> 新增规则</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="规则名（如：毛利率）" />
              <Input value={newTemplate} onChange={(e) => setNewTemplate(e.target.value)} placeholder="公式模板（如：{OP_057} / {OP_005}）" />
            </div>
            <Input value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="说明（可选）" />
            {newTemplate.trim() && validateTemplate(newTemplate) && (
              <p className="text-xs text-destructive">{validateTemplate(newTemplate)}</p>
            )}
            <div className="flex justify-end">
              <Button size="sm" onClick={handleCreate} disabled={createRule.isPending || !!validateTemplate(newTemplate) || !newName.trim()}>
                {createRule.isPending ? '创建中...' : '创建规则'}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>关闭</Button>
        </DialogFooter>
        {confirmElement}
      </DialogContent>
    </Dialog>
  )
}
