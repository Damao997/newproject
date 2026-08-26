import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { FlashMessage } from '@/components/ui/flash-message'
import { useConfirm } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { usePermissions, useUpdateRolePermissions, type RoleItem } from '@/hooks/api-queries'
import { PERMISSION_LABELS } from '@/lib/constants'
import { isHighRiskPermission } from '@/lib/permissions'
import { PermissionMatrix, type PermItem } from './shared'

// ==================== 角色权限编辑 ====================
interface PermissionDialogProps {
  open: boolean
  role?: RoleItem | null
  onClose: () => void
  /** 保存成功回调（name 为角色名），页面用于展示成功反馈 */
  onSaved?: (name: string) => void
}

export function PermissionDialog({ open, role, onClose, onSaved }: PermissionDialogProps) {
  const { data: allPerms } = usePermissions()
  const updatePerms = useUpdateRolePermissions()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const { confirm, element: confirmElement } = useConfirm()

  // 系统失管保护：superadmin 角色权限集固定为全量，前后端均禁止修改；其余角色（含预置）可编辑
  const locked = role?.code === 'superadmin'
  const perms = useMemo(() => (allPerms ?? []) as PermItem[], [allPerms])

  const permKey = (p: { resource: string; action: string }) => `${p.resource}#${p.action}`

  useEffect(() => {
    if (!open || !role) return
    setError(null)
    setSelected(new Set((role.permissions ?? []).map(permKey)))
  }, [open, role])

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  /** 批量勾选/取消：用于模块内全选清除与全局全选全不选 */
  const setAll = (keys: string[], checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      for (const k of keys) {
        if (checked) next.add(k)
        else next.delete(k)
      }
      return next
    })
  }

  const save = async () => {
    if (!role) return
    setError(null)
    const permissions = perms
      .filter((p) => selected.has(permKey(p)))
      .map((p) => ({ resource: p.resource, action: p.action }))
    // 高危权限汇总确认：相比原角色新增的高危项需二次确认后再提交（勾选时不打断）
    if (!locked) {
      const origin = new Set((role.permissions ?? []).map(permKey))
      const newHighRisk = perms.filter(
        (p) => isHighRiskPermission(p.resource) && selected.has(permKey(p)) && !origin.has(permKey(p)),
      )
      if (newHighRisk.length > 0) {
        const names = newHighRisk.map((p) => PERMISSION_LABELS[p.resource] ?? p.resource).join('、')
        const ok = await confirm({
          title: '确认授予高危权限',
          description: `角色「${role.name}」将新增 ${newHighRisk.length} 项高危权限：${names}。高危权限可导致数据不可恢复操作，确认授予？`,
          danger: true,
          confirmText: '确认授予',
        })
        if (!ok) return
      }
    }
    try {
      await updatePerms.mutateAsync({ roleId: role.id, permissions })
      onClose()
      onSaved?.(role.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>权限配置 · {role?.name}</DialogTitle>
            <DialogDescription>
              {locked ? '超级管理员角色固定拥有全部权限，不可修改' : '勾选该角色拥有的权限项，支持按模块批量操作'}
            </DialogDescription>
          </DialogHeader>
          <PermissionMatrix perms={perms} selected={selected} onToggle={toggle} onSetAll={setAll} locked={locked} />
          {error && <FlashMessage type="error">{error}</FlashMessage>}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={save} disabled={updatePerms.isPending || locked}>
              {updatePerms.isPending ? '保存中...' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmElement}
    </>
  )
}
