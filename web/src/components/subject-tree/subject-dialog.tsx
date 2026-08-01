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
import { useCreateSubject, useUpdateSubject, useReclassifySubject, type SubjectTreeItem } from '@/hooks/api-queries'

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

type SubjectValueType = 'amount' | 'quantity' | 'ratio'

/** 按科目名称推断值类型（与后端 seed 打标规则一致），仅作新建时的默认建议 */
function inferValueType(name: string): SubjectValueType {
  if (/率|占比/.test(name)) return 'ratio'
  if (/户数|天数|（户）|\(户\)|人数/.test(name)) return 'quantity'
  return 'amount'
}

/**
 * 科目新增/编辑弹窗。编码仅新增可填（编码不可变）；名称/类别/上级/叶子/值类型可编辑。
 */
export function SubjectDialog({ open, mode, type, subject, flat, onClose }: SubjectDialogProps) {
  const createSubject = useCreateSubject()
  const updateSubject = useUpdateSubject()
  const reclassifySubject = useReclassifySubject()

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [parentCode, setParentCode] = useState<string>('none')
  const [isLeaf, setIsLeaf] = useState<'true' | 'false'>('true')
  const [valueType, setValueType] = useState<SubjectValueType>('amount')
  // 新建模式下用户未手动选择前，随名称自动推断值类型；手动选择后不再覆盖
  const [valueTypeTouched, setValueTypeTouched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 向上追溯到 level0 根，返回根名作为 category（成为根时用自身名） */
  const deriveRootCategory = (pc: string | null, selfName: string): string => {
    if (!pc) return selfName
    let cur = flat.find((f) => f.code === pc)
    let guard = 0
    while (cur && cur.parentCode && guard < 50) {
      cur = flat.find((f) => f.code === cur?.parentCode)
      guard++
    }
    return cur?.name ?? selfName
  }

  useEffect(() => {
    if (!open) return
    setError(null)
    if (mode === 'edit' && subject) {
      setCode(subject.code)
      setName(subject.name)
      setCategory(subject.category)
      setParentCode(subject.parentCode ?? 'none')
      setIsLeaf(subject.isLeaf ? 'true' : 'false')
      setValueType(subject.valueType ?? 'amount')
      setValueTypeTouched(true) // 编辑模式不随名称自动推断
    } else {
      setCode('')
      setName('')
      setCategory('')
      setParentCode('none')
      setIsLeaf('true')
      setValueType('amount')
      setValueTypeTouched(false)
    }
  }, [open, mode, subject])

  const pending = createSubject.isPending || updateSubject.isPending || reclassifySubject.isPending

  // 编辑模式下上级是否变更（变更则走重分类路径，category 自动推导）
  const newParentCode = parentCode === 'none' ? null : parentCode
  const parentChanged = mode === 'edit' && !!subject && newParentCode !== subject.parentCode

  const handleParentChange = (v: string) => {
    setParentCode(v)
    if (mode === 'edit') {
      setCategory(deriveRootCategory(v === 'none' ? null : v, name.trim()))
    }
  }

  const handleNameChange = (v: string) => {
    setName(v)
    if (mode === 'create' && !valueTypeTouched) setValueType(inferValueType(v))
  }

  const submit = async () => {
    setError(null)
    try {
      if (mode === 'create') {
        if (!code.trim()) {
          setError('科目编码必填')
          return
        }
        const parent = flat.find((f) => f.code === parentCode)
        const payload: Record<string, unknown> = {
          name: name.trim(),
          type,
          category: category.trim() || name.trim(),
          parentCode: parentCode === 'none' ? null : parentCode,
          isLeaf: isLeaf === 'true',
          valueType,
          code: code.trim(),
          level: parent ? parent.level + 1 : 0,
        }
        await createSubject.mutateAsync(payload)
      } else if (subject) {
        if (parentChanged) {
          // 换父归类：category 向下传播，走重分类路径
          await reclassifySubject.mutateAsync({ id: subject.id, parentCode: newParentCode })
        }
        // 其余可编辑字段（名称/叶子/值类型）；非换父时同步 category/parentCode
        const fieldPayload: Record<string, unknown> = {
          name: name.trim(),
          type,
          isLeaf: isLeaf === 'true',
          valueType,
        }
        if (!parentChanged) {
          fieldPayload.category = category.trim() || name.trim()
          fieldPayload.parentCode = newParentCode
        }
        await updateSubject.mutateAsync({ id: subject.id, data: fieldPayload })
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
            <Label htmlFor="subject-code">科目编码</Label>
            <Input id="subject-code" value={code} onChange={(e) => setCode(e.target.value)} disabled={mode === 'edit'} placeholder="如：OP_200（编码不可修改）" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="subject-name">科目名称</Label>
            <Input id="subject-name" value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="科目名称" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="subject-category">类别{parentChanged && <span className="ml-1 text-xs text-muted-foreground">（随上级自动推导）</span>}</Label>
            <Input id="subject-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="如：收入（留空取名称）" readOnly={parentChanged} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="subject-value-type">值类型{mode === 'create' && !valueTypeTouched && <span className="ml-1 text-xs text-muted-foreground">（随名称自动推断，可手动调整）</span>}</Label>
            <Select value={valueType} onValueChange={(v) => { setValueType(v as SubjectValueType); setValueTypeTouched(true) }}>
              <SelectTrigger id="subject-value-type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="amount">金额（万元，千分位两位小数）</SelectItem>
                <SelectItem value="quantity">数量（整数，如户数/天数）</SelectItem>
                <SelectItem value="ratio">比率（百分比展示，同比按百分点差）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="subject-is-leaf">是否叶子</Label>
            <Select value={isLeaf} onValueChange={(v) => setIsLeaf(v as 'true' | 'false')}>
              <SelectTrigger id="subject-is-leaf"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="true">是</SelectItem>
                <SelectItem value="false">否</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="subject-parent">上级科目</Label>
            <Select value={parentCode} onValueChange={handleParentChange}>
              <SelectTrigger id="subject-parent"><SelectValue placeholder="选择上级科目" /></SelectTrigger>
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
