import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { Camera, UserRound } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
import { useFormNavigation } from '@/components/forms/form-navigation'
import { AppForm, FormInput, FormSection, FormError, useAppForm } from '@/components/forms/form'
import { PersonalAvatar } from '@/components/settings/personal-avatar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/confirm-dialog'
import type { ProfileUser } from '@/types'
const schema = z.object({
  name: z.string().trim().min(1, '请输入姓名').max(80, '姓名最多 80 个字'),
  email: z.union([z.string().trim().email('请输入有效邮箱').max(254), z.literal('')]),
  phone: z.string().trim().max(32, '联系电话最多 32 个字符'),
  department: z.string().trim().max(80, '部门最多 80 个字'),
  jobTitle: z.string().trim().max(80, '岗位最多 80 个字'),
})
const valuesOf = (user?: ProfileUser | null) => ({ name: user?.name ?? '', email: user?.email ?? '', phone: user?.phone ?? '', department: user?.department ?? '', jobTitle: user?.jobTitle ?? '' })
function AvatarSettings({ profile, onSaved }: { profile: ProfileUser; onSaved: (user: ProfileUser) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const input = useRef<HTMLInputElement>(null)
  const { confirm, element } = useConfirm()
  useFormNavigation(!!file, busy)
  useEffect(() => {
    if (!file) { setPreview(null); return }
    const url = URL.createObjectURL(file); setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const write = async (remove = false) => {
    if (lock.current || (!file && !remove)) return
    if (remove && !await confirm({ title: '移除头像？', description: '移除后将显示姓名缩写。', confirmText: '移除头像', danger: true })) return
    lock.current = true; setBusy(true); setError(null)
    try { onSaved(remove ? await api.removeAvatar() : await api.uploadAvatar(file!)); setFile(null); if (input.current) input.current.value = '' }
    catch (cause) { setError(cause instanceof Error ? cause.message : '头像保存失败，请重试') }
    finally { lock.current = false; setBusy(false) }
  }
  return <div className="settings-avatar-section">
    <div className="flex flex-wrap items-center gap-5">{preview ? <img className="personal-avatar h-20 w-20" src={preview} alt="待保存头像预览" /> : <PersonalAvatar className="h-20 w-20 text-2xl" name={profile.name} version={profile.avatarVersion} />}
      <div className="space-y-3"><div><h3 className="font-semibold">个人头像</h3><p className="text-xs text-muted-foreground">JPEG、PNG、WebP · 最大 2MB · 居中裁切</p></div>
        <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}><Camera className="mr-2 h-4 w-4" />选择图片</Button>
          {file && <><Button size="sm" disabled={busy} loading={busy} onClick={() => { void write() }}>保存头像</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => { setFile(null); if (input.current) input.current.value = '' }}>取消</Button></>}
          {!file && profile.avatarVersion && <Button size="sm" variant="ghost" disabled={busy} loading={busy} onClick={() => { void write(true) }}>移除头像</Button>}</div>
      </div></div>
    <input ref={input} className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" aria-label="上传个人头像" disabled={busy} onChange={event => {
      const candidate = event.target.files?.[0]; setError(null)
      if (!candidate) return
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(candidate.type) || candidate.size > 2 * 1024 * 1024) { setError('请选择 2MB 以内的 JPEG、PNG 或 WebP 图片'); event.target.value = ''; return }
      setFile(candidate)
    }} /><FormError message={error} />{element}
  </div>
}
export function ProfileSettings() {
  const account = useAuthStore(s => s.user)
  const client = useQueryClient()
  const query = useQuery({ queryKey: ['auth', 'profile', account?.id], queryFn: () => api.getProfile(), refetchOnWindowFocus: true })
  const form = useAppForm(schema, { defaultValues: valuesOf(account) })
  const { reset, formState: { isDirty, isSubmitting } } = form
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useFormNavigation(isDirty, isSubmitting)
  useEffect(() => { if (query.data && !isDirty) reset(valuesOf(query.data)) }, [query.data, reset, isDirty])
  const onSaved = (profile: ProfileUser) => {
    if (useAuthStore.getState().user?.id !== account?.id) return
    client.setQueryData(['auth', 'profile', account?.id], profile)
    useAuthStore.getState().updateUser({ name: profile.name, avatarVersion: profile.avatarVersion, updatedAt: profile.updatedAt })
  }
  const submit = async (values: z.infer<typeof schema>) => {
    setError(null); setSaved(false)
    try { const profile = await api.updateProfile(values); onSaved(profile); reset(valuesOf(profile)); setSaved(true) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '资料保存失败，请重试') }
  }
  const profile = query.data ?? account
  return <Card className="settings-form-card"><div className="settings-card-heading"><UserRound className="h-6 w-6 text-primary" /><div><h2>个人资料</h2><p>让同事更容易认识你</p></div></div>
    {query.isPending ? <p role="status" className="py-8">正在加载资料…</p> : query.isError ? <div role="alert" className="py-6"><p>资料加载失败，已有输入已保留</p><Button variant="outline" onClick={() => { void query.refetch() }}>重试</Button></div> : <>
      {profile && <AvatarSettings profile={profile} onSaved={onSaved} />}
      <AppForm form={form} id="personal-profile-form" onSubmit={submit}><FormError message={error} />
        <FormSection title="基本信息"><div className="settings-field-grid">
          <FormInput control={form.control} name="name" label="姓名" required autoComplete="name" />
          <FormInput control={form.control} name="email" label="工作邮箱" type="email" autoComplete="email" hint="用于联系与密码找回，登录仍使用用户名" />
          <FormInput control={form.control} name="phone" label="联系电话" type="tel" autoComplete="tel" />
        </div></FormSection>
        <FormSection title="工作资料" description="用于个人展示，权限与数据范围由管理员管理"><div className="settings-field-grid"><FormInput control={form.control} name="department" label="部门" autoComplete="organization" /><FormInput control={form.control} name="jobTitle" label="岗位" autoComplete="organization-title" /></div></FormSection>
        <FormSection title="账号信息"><dl className="settings-account-info"><dt>登录名</dt><dd>{profile?.username}</dd><dt>账号状态</dt><dd>{profile?.status === 'active' ? '正常' : '停用'}</dd><dt>角色</dt><dd>{({ superadmin: '超级管理员', admin: '管理员', finance_manager: '财务主管', department_manager: '部门经理', viewer: '查看者', finance_analyst_it: '财务分析师（兼 IT）' } as Record<string, string>)[profile?.role ?? ''] ?? profile?.role}</dd><dt>数据范围</dt><dd>{profile?.dataScope === '全部' || profile?.dataScope === 'all' ? '全部授权公司' : profile?.dataScope}</dd></dl></FormSection>
      </AppForm><div className="settings-save-bar"><span role="status" className="text-sm text-muted-foreground">{isDirty ? '有未保存的修改' : saved ? '资料已保存' : ''}</span>
        <div className="flex gap-2"><Button variant="outline" disabled={isSubmitting || !isDirty} onClick={() => { reset(valuesOf(query.data)); setError(null) }}>还原</Button><Button form="personal-profile-form" type="submit" disabled={!isDirty || isSubmitting} loading={isSubmitting}>保存资料</Button></div></div>
    </>}
  </Card>
}
