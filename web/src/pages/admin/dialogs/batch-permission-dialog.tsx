import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
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
import { usePermissions, useUpdateRolePermissionsBatch, type RoleItem } from '@/hooks/api-queries'
import { PERMISSION_LABELS } from '@/lib/constants'
import { isHighRiskPermission } from '@/lib/permissions'
import { PermissionMatrix, type PermItem } from './shared'

// ==================== 角色批量权限（表格视图行选择） ====================
interface BatchPermissionDialogProps {
  open: boolean
  /** 批量目标角色（表格视图中选中的角色列表，不可为空） */
  roles?: RoleItem[] | null
  onClose: () => void
  /** 保存成功回调（names 为角色名列表），页面用于展示成功反馈 */
  onSaved?: (names: string[]) => void
}

export function BatchPermissionDialog({ open, roles, onClose, onSaved }: BatchPermissionDialogProps) {
  const { data: allPerms } = usePermissions()
  const updateBatch = useUpdateRolePermissionsBatch()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const { confirm, element: confirmElement } = useConfirm()

  const perms = useMemo(() => (allPerms ?? []) as PermItem[], [allPerms])
  const permKey = (p: { resource: string; action: string }) => `${p.resource}#${p.action}`

  useEffect(() => {
    if (!open) return
    setError(null)
    setSelected(new Set())
  }, [open])

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

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
    if (!roles || roles.length === 0) return
    setError(null)
    const permissions = perms
      .filter((p) => selected.has(permKey(p)))
      .map((p) => ({ resource: p.resource, action: p.action }))
    // 高危权限汇总确认：批量从空集开始勾选，勾选的高危项即新增，需二次确认后再提交
    const highRisk = perms.filter((p) => isHighRiskPermission(p.resource) && selected.has(permKey(p)))
    if (highRisk.length > 0) {
      const names = highRisk.map((p) => PERMISSION_LABELS[p.resource] ?? p.resource).join('、')
      const ok = await confirm({
        title: '确认授予高危权限',
        description: `将为 ${roles.length} 个角色批量授予 ${highRisk.length} 项高危权限：${names}。高危权限可导致数据不可恢复操作，确认授予？`,
        danger: true,
        confirmText: '确认授予',
      })
      if (!ok) return
    }
    try {
      await updateBatch.mutateAsync({ roleIds: roles.map((r) => r.id), permissions })
      onClose()
      onSaved?.(roles.map((r) => r.name))
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>批量配置权限</DialogTitle>
            <DialogDescription>为 {roles?.length ?? 0} 个角色设置相同权限集（覆盖原权限），支持按模块批量操作</DialogDescription>
          </DialogHeader>
          {/* 目标角色摘要：前 5 个 + 溢出计数 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">目标角色：</span>
            {roles?.slice(0, 5).map((r) => (
              <Badge key={r.id} variant="secondary">{r.name}</Badge>
            ))}
            {(roles?.length ?? 0) > 5 && <Badge variant="outline">+{roles!.length - 5} 个</Badge>}
          </div>
          <PermissionMatrix perms={perms} selected={selected} onToggle={toggle} onSetAll={setAll} />
          {error && <FlashMessage type="error">{error}</FlashMessage>}
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button onClick={save} disabled={updateBatch.isPending}>
              {updateBatch.isPending ? '保存中...' : `应用到 ${roles?.length ?? 0} 个角色`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {confirmElement}
    </>
  )
}
