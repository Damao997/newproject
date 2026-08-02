import { useEffect, useMemo, useState } from 'react'
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
import { useCreateSubject, useUpdateSubject, useReclassifySubject, useMetrics, useConvertMetric, type SubjectTreeItem } from '@/hooks/api-queries'
import { useConfirm } from '@/components/ui/confirm-dialog'
import type { Metric } from '@/types'

interface SubjectDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  type: 'operating' | 'static'
  /** 编辑目标（edit 模式） */
  subject?: SubjectTreeItem | null
  /** 同类全部科目（用于选择上级科目） */
  flat: SubjectTreeItem[]
  /** 是否可进行指标类型转换（data:metric:convert，仅 superadmin）；缺省 false 时类型选择只读 */
  canConvert?: boolean
  onClose: () => void
}

type SubjectValueType = 'amount' | 'quantity' | 'ratio'
type SubjectDataType = 'data' | 'calc' | 'display'

/** 按科目名称推断值类型（与后端 seed 打标规则一致），仅作新建时的默认建议 */
function inferValueType(name: string): SubjectValueType {
  if (/率|占比/.test(name)) return 'ratio'
  if (/户数|天数|（户）|\(户\)|人数/.test(name)) return 'quantity'
  return 'amount'
}

/**
 * 科目新增/编辑弹窗。编码仅新增可填（编码不可变）；名称/类别/上级/叶子/值类型可编辑；
 * 编辑模式下可切换指标类型（计算类/数据类/展示类，需 canConvert 权限，dataType 存于 metric 表）。
 */
export function SubjectDialog({ open, mode, type, subject, flat, canConvert = false, onClose }: SubjectDialogProps) {
  const createSubject = useCreateSubject()
  const updateSubject = useUpdateSubject()
  const reclassifySubject = useReclassifySubject()
  const convertMetric = useConvertMetric()
  const { confirm, element: confirmElement } = useConfirm()
  // 全量指标：按科目编码取 metric（类型转换按 metric.id 提交）
  const { data: metricsData } = useMetrics({ pageSize: 1000 })
  const metricByCode = useMemo(() => {
    const m = new Map<string, Metric>()
    for (const item of metricsData?.items ?? []) m.set(item.code, item)
    return m
  }, [metricsData])

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [parentCode, setParentCode] = useState<string>('none')
  const [isLeaf, setIsLeaf] = useState<'true' | 'false'>('true')
  const [valueType, setValueType] = useState<SubjectValueType>('amount')
  // 新建模式下用户未手动选择前，随名称自动推断值类型；手动选择后不再覆盖
  const [valueTypeTouched, setValueTypeTouched] = useState(false)
  // 指标类型（编辑模式可切换；dataType 存于 metric 表，变更走类型转换 API）
  const [dataType, setDataType] = useState<SubjectDataType>('data')
  // data → calc 时的初始公式（必填）
  const [calcFormula, setCalcFormula] = useState('')
  // 类型切换后果提示（内联展示）
  const [typeHint, setTypeHint] = useState<string | null>(null)
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
      const cur = (subject.dataType ?? 'data') as SubjectDataType
      setDataType(cur)
      setCalcFormula('')
      // 展示类为只读终点：直接锁定并提示
      setTypeHint(cur === 'display' ? '展示类为只读展示用途，不支持转换为其他类型' : null)
    } else {
      setCode('')
      setName('')
      setCategory('')
      setParentCode('none')
      setIsLeaf('true')
      setValueType('amount')
      setValueTypeTouched(false)
      setDataType('data')
      setCalcFormula('')
      setTypeHint(null)
    }
  }, [open, mode, subject])

  const pending = createSubject.isPending || updateSubject.isPending || reclassifySubject.isPending || convertMetric.isPending

  /** 指标类型切换：仅更新表单状态（保存时才提交转换），并给出后果提示 */
  const handleTypeChange = (v: SubjectDataType) => {
    setDataType(v)
    if (v === 'calc') setTypeHint('转换为计算类后参与公式计算体系，需填写公式（保存时校验）；公式可含 {编码} 与 {编码@维度} 操作数')
    else if (v === 'display') setTypeHint('展示类为只读展示用途，不参与数据录入与公式计算；保存后不可再转换')
    else setTypeHint('转换为数据类后公式将被清空（保留版本历史），改为手工录入数据')
  }

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
        // 指标类型转换（dataType 存于 metric 表，按 metric.id 提交；展示类为只读终点不可转出）
        const curType = (subject.dataType ?? 'data') as SubjectDataType
        const typeChanged = dataType !== curType
        if (typeChanged) {
          if (!canConvert) {
            setError('无权进行指标类型转换（需 data:metric:convert 权限）')
            return
          }
          if (dataType === 'calc' && !calcFormula.trim()) {
            setError('转换为计算类需填写公式')
            return
          }
          const metric = metricByCode.get(subject.code)
          if (!metric) {
            setError('该科目暂无指标记录，无法转换类型（可在公式维护中创建）')
            return
          }
          // 破坏性转换（清空公式 / 变为只读展示）二次确认
          if (dataType === 'data' || dataType === 'display') {
            const ok = await confirm({
              title: dataType === 'display' ? '转换为展示类' : '转换为数据类',
              description: dataType === 'display'
                ? `科目「${subject.name}」将变为只读展示用途，不再参与数据录入与公式计算${curType === 'calc' ? '，现有公式将被清空（保留版本历史）' : ''}，保存后不可再转换。确认转换？`
                : `科目「${subject.name}」将转换为数据类，现有公式将被清空（保留版本历史），改为手工录入数据。确认转换？`,
              danger: dataType === 'display',
              confirmText: '转换',
            })
            if (!ok) return
          }
          await convertMetric.mutateAsync({
            id: metric.id,
            dataType,
            formula: dataType === 'calc' ? calcFormula.trim() : undefined,
          })
        }
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
    <>
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
            <Input id="subject-code" value={code} onChange={(e) => setCode(e.target.value)} disabled={mode === 'edit'} placeholder="如：OP_0201010102（编码不可修改）" />
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
          {mode === 'edit' && (
            <div className="space-y-1">
              <Label htmlFor="subject-data-type">
                指标类型
                {!canConvert && <span className="ml-1 text-xs text-muted-foreground">（只读：需 data:metric:convert 权限）</span>}
              </Label>
              <Select
                value={dataType}
                onValueChange={(v) => handleTypeChange(v as SubjectDataType)}
                disabled={!canConvert || (subject?.dataType ?? 'data') === 'display'}
              >
                <SelectTrigger id="subject-data-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="data">数据类（手工录入）</SelectItem>
                  <SelectItem value="calc">计算类（公式计算）</SelectItem>
                  <SelectItem value="display">展示类（只读展示）</SelectItem>
                </SelectContent>
              </Select>
              {typeHint && <p className="text-xs text-muted-foreground">{typeHint}</p>}
              {dataType === 'calc' && (subject?.dataType ?? 'data') !== 'calc' && (
                <div className="space-y-1">
                  <Label htmlFor="subject-calc-formula">初始公式（必填）</Label>
                  <Input id="subject-calc-formula" value={calcFormula} onChange={(e) => setCalcFormula(e.target.value)} placeholder="如：{OP_057} / {OP_005}" maxLength={500} />
                </div>
              )}
            </div>
          )}
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
      {confirmElement}
    </>
  )
}
