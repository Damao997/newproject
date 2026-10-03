import { useFormModel, useFormValue, ModelFormFields } from '@/components/forms/form-model'
import { useFormClose } from '@/components/forms/form-navigation'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FlashMessage } from '@/components/ui/flash-message'
import {
  Dialog,
  DialogContent, DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCreateRole, useUpdateRole, type RoleItem } from '@/hooks/api-queries'

// ==================== 角色新增/编辑 ====================
interface RoleDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  role?: RoleItem | null
  onClose: () => void
  /** 保存成功回调（name 为保存后的角色名），页面用于展示成功反馈 */
  onSaved?: (name: string) => void
}

export function RoleDialog({ open, mode, role, onClose, onSaved }: RoleDialogProps) {
  const createRole = useCreateRole()
  const updateRole = useUpdateRole()
  const model = useFormModel({code: ('') as string, name: ('') as string, description: ('') as string}, {"code":"请输入角色编码","name":"请输入角色名称"})
  const [code, setCode] = useFormValue(model, "code")
  const [name, setName] = useFormValue(model, "name")
  const [description, setDescription] = useFormValue(model, "description")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (mode === 'edit' && role) {
      setCode(role.code)
      setName(role.name)
      setDescription(role.description ?? '')
    } else {
      setCode('')
      setName('')
      setDescription('')
    }
      model.form.reset(model.form.getValues())
  }, [open, mode, role, setCode, setName, setDescription, model.form])

  const pending = createRole.isPending || updateRole.isPending

  const submit = async () => {
    // 前置校验：编码/名称必填
    if (mode === 'create' && !code.trim()) return setError('请输入角色编码')
    if (!name.trim()) return setError('请输入角色名称')
    setError(null)
    try {
      if (mode === 'create') {
        await createRole.mutateAsync({ code: code.trim(), name: name.trim(), description })
      } else if (role) {
        await updateRole.mutateAsync({ id: role.id, data: { name: name.trim(), description } })
      }
      onClose()
      onSaved?.(name.trim())
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    }
  }

  const formClose = useFormClose({ dirty: model.form.formState.isDirty, busy: model.pending || pending, enabled: open, onClose: onClose })

  return (
    <><Dialog open={open} busy={model.pending || pending} onOpenChange={(next) => { if (!next) formClose.requestClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? '新增角色' : '编辑角色'}</DialogTitle>
          <DialogDescription>{mode === 'create' ? '创建自定义角色（非系统预置）' : `编辑 ${role?.name}`}</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4"><ModelFormFields model={model}>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="role-code">角色编码</Label>
              <Input name="code" id="role-code" value={code} onChange={(e) => setCode(e.target.value)} disabled={mode === 'edit'} placeholder="如 auditor" />
              {mode === 'create' && <p className="text-xs text-muted-foreground">字母/数字/下划线，创建后不可修改</p>}
            </div>
            <div className="space-y-1">
              <Label htmlFor="role-name">角色名称</Label>
              <Input name="name" id="role-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 审计员" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="role-description">描述</Label>
              <Input name="description" id="role-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="角色说明" />
            </div>
            {error && <FlashMessage type="error">{error}</FlashMessage>}
          </div>
        </ModelFormFields></DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={formClose.requestClose}>取消</Button>
          <Button onClick={model.submit(submit)} disabled={pending}>{pending ? '保存中...' : '保存'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>{formClose.element}</>
  )
}
