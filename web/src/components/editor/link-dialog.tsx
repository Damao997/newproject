import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface LinkDialogProps {
  open: boolean
  /** 初始链接地址（无链接时 'https://'） */
  initialUrl: string
  /** 确定回调：空串表示移除链接（与旧 prompt 行为一致） */
  onConfirm: (url: string) => void
  onCancel: () => void
}

/** 链接编辑对话框：替代原生 prompt；打开时回填当前链接，清空确定 = 移除链接 */
export function LinkDialog({ open, initialUrl, onConfirm, onCancel }: LinkDialogProps) {
  const [url, setUrl] = useState(initialUrl)

  useEffect(() => {
    if (open) setUrl(initialUrl)
  }, [open, initialUrl])

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑链接</DialogTitle>
          <DialogDescription>输入链接地址；清空后确定将移除当前链接。</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="link-url">链接地址</Label>
          <Input
            id="link-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button onClick={() => onConfirm(url.trim())}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
