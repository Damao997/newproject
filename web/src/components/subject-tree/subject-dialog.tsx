import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCreateSubject, useUpdateSubject, type SubjectTreeItem } from '@/hooks/api-queries'

interface SubjectDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  type: 'operating' | 'static'
  /** 编辑目标（edit 模式） */
  subject?: SubjectTreeItem | null
  /** 同类全部科目（用于选择上级科目） */
  flat: SubjectTreeItem[]
  onClose: () => void
}

/**
 * 科目新增/编辑弹窗。编码仅新增可填（编码不可变）；名称/类别/上级/叶子可编辑。
 */
export function SubjectDialog({ open, mode, type, subject, flat, onClose }: SubjectDialogProps) {
  const createSubject = useCreateSubject()
  const updateSubject = useUpdateSubject()

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [parentCode, setParentCode] = useState<string>('none')
  const [isLeaf, setIsLeaf] = useState<'true' | 'false'>('true')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (mode === 'edit' && subject) {
      setCode(subject.code)
      setName(subject.name)
      setCategory(subject.category)
      setParentCode(subject.parentCode ?? 'none')
      setIsLeaf(subject.isLeaf ? 'true' : 'false')
    } else {
      setCode('')
      setName('')
      setCategory('')
      setParentCode('none')
      setIsLeaf('true')
    }
  }, [open, mode, subject])

  const pending = createSubject.isPending || updateSubject.isPending

  const submit = async () => {
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        type,
        category: category.trim() || name.trim(),
        parentCode: parentCode === 'none' ? null : parentCode,
        isLeaf: isLeaf === 'true',
      }
      if (mode === 'create') {
        if (!code.trim()) {
          setError('科目编码必填')
          return
        }
        const parent = flat.find((f) => f.code === parentCode)
        payload.code = code.trim()
        payload.level = parent ? parent.level + 1 : 0
        await createSubject.mutateAsync(payload)
      } else if (subject) {
        await updateSubject.mutateAsync({ id: subject.id, data: payload })
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? '新增科目' : '编辑科目'}</DialogTitle>
          <DialogDescription>
            {mode === 'create' ? `新增${type === 'operating' ? '经营' : '静态'}科目` : `${subject?.name}（${subject?.code}）`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>科目编码</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} disabled={mode === 'edit'} placeholder="如：OP_200（编码不可修改）" />
          </div>
          <div className="space-y-1">
            <Label>科目名称</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="科目名称" />
          </div>
          <div className="space-y-1">
            <Label>类别</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="如：收入（留空取名称）" />
          </div>
          <div className="space-y-1">
            <Label>是否叶子</Label>
            <Select value={isLeaf} onValueChange={(v) => setIsLeaf(v as 'true' | 'false')}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="true">是</SelectItem>
                <SelectItem value="false">否</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>上级科目</Label>
            <Select value={parentCode} onValueChange={setParentCode}>
              <SelectTrigger><SelectValue placeholder="选择上级科目" /></SelectTrigger>
              <SelectContent className="max-h-[280px]">
                <SelectItem value="none">无（根节点）</SelectItem>
                {flat
                  .filter((f) => mode === 'create' || f.code !== subject?.code)
                  .map((f) => (
                    <SelectItem key={f.code} value={f.code}>
                      <span className="font-mono text-xs">{f.code}</span> {f.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>取消</Button>
          <Button onClick={submit} disabled={pending || !name.trim()}>
            {pending ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
