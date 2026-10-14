import { useEffect, useState } from 'react'
import { z } from 'zod'
import { AppForm, FormError, FormInput, useAppForm } from '@/components/forms/form'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FlashMessage } from '@/components/ui/flash-message'
import { api } from '@/lib/api'
import { isEmailCollectionSnoozed, snoozeEmailCollection } from '@/lib/email-collection'
import { useAuthStore } from '@/stores/authStore'

const schema = z.object({
  email: z.string().trim().email('请输入有效邮箱').max(254, '邮箱最多 254 个字符'),
})
type Values = z.infer<typeof schema>
const defaults: Values = { email: '' }

/**
 * 工作邮箱收集引导（一次性活动，用于开通「忘记密码」自助找回）：
 * - 是否拦截由服务端开关下发（GET /auth/login-options 的 emailCollectionRequired），活动结束改 env 即停；
 * - 只对未绑邮箱的账号弹出，且无关闭按钮：要么保存，要么「暂不填写」
 *   （本次浏览器会话豁免，登出重登后再次提醒）；
 * - 强制改密优先级更高（未改初始密码前先走改密），避免两个不可关闭弹窗叠加。
 */
export function EmailCollectionDialog() {
  const { user, updateUser } = useAuthStore()
  const [required, setRequired] = useState(false)
  const [snoozed, setSnoozed] = useState(isEmailCollectionSnoozed)
  const [saved, setSaved] = useState(false)
  const form = useAppForm(schema, { defaultValues: defaults })

  const needsEmail = !!user && !user.email

  // 开关只在确实可能弹窗时探测一次；探测失败按不拦截处理（不为一次网络抖动把用户挡在门外）
  useEffect(() => {
    if (!needsEmail) return
    let cancelled = false
    api.getLoginOptions()
      .then((options) => { if (!cancelled) setRequired(options.emailCollectionRequired) })
      .catch((cause) => { console.error('邮箱收集引导：能力探测失败', cause) })
    return () => { cancelled = true }
  }, [needsEmail])

  const open = required && needsEmail && !snoozed && !user?.mustChangePassword
  const busy = form.formState.isSubmitting

  useEffect(() => { if (open) { form.reset(defaults); setSaved(false) } }, [open, form])

  const submit = async (values: Values) => {
    form.clearErrors('root')
    try {
      const profile = await api.updateProfile({ email: values.email.trim() })
      updateUser({ email: profile.email })
      setSaved(true)
    } catch (error) {
      form.setError('root', { message: error instanceof Error ? error.message : '保存失败，请稍后重试' })
    }
  }

  const handleSnooze = () => {
    snoozeEmailCollection()
    setSnoozed(true)
  }

  return <>
    {/* busy 恒为 true 复用「强制模式」：antd Modal 隐藏右上角关闭按钮，并屏蔽 ESC 与点遮罩关闭 */}
    <Dialog open={open} busy onOpenChange={() => { /* 强制引导：只能保存，或点「暂不填写」豁免本次会话 */ }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>补全工作邮箱</DialogTitle>
          <DialogDescription>用于自助找回密码，登录仍使用用户名。</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <AppForm form={form} id="email-collection" onSubmit={submit}>
            <div className="space-y-4">
              <FormInput control={form.control} name="email" label="工作邮箱" type="email" required autoComplete="email"
                hint="填错或想更换，可随时在「个人设置 → 个人资料」修改" />
              <FormError message={form.formState.errors.root?.message} />
            </div>
          </AppForm>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={handleSnooze} disabled={busy}>暂不填写</Button>
          <Button type="submit" form="email-collection" loading={form.formState.isSubmitting} disabled={busy}>保存</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {saved && <FlashMessage type="success" autoHideMs={3000} onAutoHide={() => setSaved(false)} className="fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-md border border-border bg-background px-4 py-2 shadow-md">工作邮箱已保存，可用于找回密码</FlashMessage>}
  </>
}
