import { useEffect, useState } from 'react'
import { z } from 'zod'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FormInput, FormField, FormSection, FormError, AppForm, useAppForm } from '@/components/forms/form'
import { useFormClose } from '@/components/forms/form-navigation'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogBody, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useCreateUser, useUpdateUser } from '@/hooks/api-queries'
import type { User } from '@/types'
import { DataScopeSelect } from './shared'
import { validatePassword } from './password-validation'

interface UserDialogProps {
  open: boolean; mode: 'create' | 'edit'; user?: User | null; roles: { code: string; name: string }[]
  onClose: () => void; onSaved?: (name: string) => void
}
const defaults = { username: '', name: '', password: '', role: 'viewer', dataScopeCodes: [] as string[] }

export function UserDialog({ open, mode, user, roles, onClose, onSaved }: UserDialogProps) {
  const createUser = useCreateUser()
  const updateUser = useUpdateUser()
  const [error, setError] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const schema = z.object({
    username: z.string().trim().min(1, '请输入用户名'),
    name: z.string(), password: z.string(), role: z.string().min(1, '请选择角色'), dataScopeCodes: z.array(z.string()),
  }).superRefine((values, context) => {
    if (mode === 'edit' && !values.name.trim()) context.addIssue({ code: 'custom', path: ['name'], message: '请输入姓名' })
    if (mode === 'create') {
      const message = validatePassword(values.password)
      if (message) context.addIssue({ code: 'custom', path: ['password'], message })
    }
  })
  const form = useAppForm(schema, { defaultValues: defaults })
  const { reset } = form
  useEffect(() => {
    if (!open) return
    setError(null); setVisible(false)
    if (mode === 'edit' && user) {
      const codes = user.dataScopeCodes?.length ? user.dataScopeCodes
        : user.dataScope && !['全部', '无', '*'].includes(user.dataScope) ? user.dataScope.split(',').filter(Boolean) : []
      reset({ username: user.username, name: user.name, password: '', role: user.role, dataScopeCodes: codes })
    } else reset(defaults)
  }, [open, mode, user, reset])
  const pending = form.formState.isSubmitting || createUser.isPending || updateUser.isPending
  const close = useFormClose({ dirty: form.formState.isDirty, busy: pending, onClose, enabled: open })
  const submit = async (values: z.infer<typeof schema>) => {
    setError(null)
    try {
      if (mode === 'create') await createUser.mutateAsync({ ...values, username: values.username.trim(), name: values.name.trim() || undefined })
      else if (user) await updateUser.mutateAsync({ id: user.id, data: { name: values.name.trim(), role: values.role, dataScopeCodes: values.dataScopeCodes } })
      reset(values); onClose(); onSaved?.(values.name.trim() || values.username.trim())
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试') }
  }
  return <>
    <Dialog open={open} presentation="drawer" busy={pending} onOpenChange={(next) => { if (!next) close.requestClose() }}>
      <DialogContent><DialogHeader><DialogTitle>{mode === 'create' ? '新增用户' : '编辑用户'}</DialogTitle></DialogHeader>
        <DialogBody><AppForm form={form} onSubmit={submit} id="user-form">
          <FormError message={error} />
          <FormSection title="基本信息">
            <FormInput control={form.control} name="username" label="用户名" required readOnly={mode === 'edit'} autoComplete="username" placeholder="用于登录" />
            <FormInput control={form.control} name="name" label="姓名" required={mode === 'edit'} placeholder="用户显示名称" hint={mode === 'create' ? '选填，留空时使用用户名' : undefined} />
            {mode === 'create' && <FormField control={form.control} name="password" label="初始密码" required hint="至少 8 位，含字母与数字；首次登录后须修改">
              {(field) => <Input {...field} value={String(field.value)} type={visible ? 'text' : 'password'} autoComplete="new-password" className="h-11"
                suffix={<button type="button" className="flex h-6 w-6 items-center justify-center rounded hover:bg-muted" aria-label={visible ? '隐藏密码' : '显示密码'} onClick={() => setVisible(!visible)}>
                  {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>} />}
            </FormField>}
          </FormSection>
          <FormSection title="角色与数据范围">
            <FormField control={form.control} name="role" label="角色" required>{(field) =>
              <Select {...field} value={String(field.value)} onValueChange={field.onChange}><SelectTrigger className="h-11"><SelectValue placeholder="选择角色" /></SelectTrigger>
                <SelectContent>{roles.map((role) => <SelectItem key={role.code} value={role.code}>{role.name}</SelectItem>)}</SelectContent></Select>}
            </FormField>
            <FormField control={form.control} name="dataScopeCodes" label="数据范围" hint="留空时按角色默认范围" help="可多选单体公司。汇总主体按成员全有或全无自动推导，无需单独选择。">{(field) =>
              <DataScopeSelect {...field} value={field.value as string[]} onChange={field.onChange} />}
            </FormField>
          </FormSection>
        </AppForm></DialogBody>
        <DialogFooter><Button variant="outline" disabled={pending} onClick={close.requestClose}>取消</Button>
          <Button type="submit" form="user-form" loading={pending} disabled={pending}>保存用户</Button></DialogFooter>
      </DialogContent>
    </Dialog>{close.element}
  </>
}
