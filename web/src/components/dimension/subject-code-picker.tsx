import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useSubjectTree } from '@/hooks/api-queries'
import { cn } from '@/lib/utils'

/**
 * C1 显式科目选择器（品类 / 产品配置共用）。
 *
 * 候选范围与后端 ProductCategoryService.check() 的 incomeRows 严格一致：
 * 经营科目树中 category = 「壹品慧收入」的节点（任意层级均可勾选，
 * 父子同时勾选时后端按「祖先命中则后代剔除」收敛，不会重复求和）。
 */

export interface IncomeSubjectNode {
  code: string
  name: string
  level: number
  parentCode: string | null
}

/** 收入类别候选节点：按 code 排序（层级编码的字典序即树序），供条目渲染与测试复用 */
export function useIncomeSubjectNodes(): { nodes: IncomeSubjectNode[]; isLoading: boolean } {
  const { data: tree, isLoading } = useSubjectTree('operating')
  const nodes = useMemo(
    () =>
      (tree ?? [])
        .filter((s) => s.category === '壹品慧收入')
        .map((s) => ({ code: s.code, name: s.name, level: s.level, parentCode: s.parentCode }))
        .sort((a, b) => a.code.localeCompare(b.code)),
    [tree],
  )
  return { nodes, isLoading }
}

/** 折叠态计算：默认只展开含选中节点的祖先链，其余折叠 */
export function computeExpanded(nodes: IncomeSubjectNode[], selected: Set<string>): Set<string> {
  const byCode = new Map(nodes.map((n) => [n.code, n]))
  const expanded = new Set<string>()
  for (const code of selected) {
    let cur = byCode.get(code)
    while (cur?.parentCode) {
      expanded.add(cur.parentCode)
      cur = byCode.get(cur.parentCode)
    }
  }
  return expanded
}

/** 直接子节点索引（父 code → 子列表，按 code 排序） */
export function groupChildren(nodes: IncomeSubjectNode[]): Map<string | null, IncomeSubjectNode[]> {
  const map = new Map<string | null, IncomeSubjectNode[]>()
  for (const n of nodes) {
    const key = n.parentCode && nodes.some((x) => x.code === n.parentCode) ? n.parentCode : null
    const list = map.get(key)
    if (list) list.push(n)
    else map.set(key, [n])
  }
  return map
}

interface IncomeSubjectPickerProps {
  value: string[]
  onChange: (codes: string[]) => void
  disabled?: boolean
  id?: string
  /** 触发按钮文案前缀（如「显式科目」） */
  label?: string
}

export function IncomeSubjectPicker({ value, onChange, disabled, id, label = '显式科目' }: IncomeSubjectPickerProps) {
  const { nodes, isLoading } = useIncomeSubjectNodes()
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const childrenOf = useMemo(() => groupChildren(nodes), [nodes])
  const selected = useMemo(() => new Set(value), [value])
  const effectiveExpanded = useMemo(() => {
    const withSelected = new Set(expanded)
    for (const c of computeExpanded(nodes, selected)) withSelected.add(c)
    return withSelected
  }, [expanded, nodes, selected])

  const toggle = (code: string) => {
    onChange(selected.has(code) ? value.filter((c) => c !== code) : [...value, code])
  }

  const roots = childrenOf.get(null) ?? []

  const renderNode = (node: IncomeSubjectNode) => {
    const children = childrenOf.get(node.code) ?? []
    const isExpanded = effectiveExpanded.has(node.code)
    const isSelected = selected.has(node.code)
    return (
      <div key={node.code}>
        <div className="flex items-center gap-1" style={{ paddingLeft: `${(node.level - 1) * 14}px` }}>
          {children.length > 0 ? (
            <button
              type="button"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
              onClick={() => setExpanded((prev) => {
                const next = new Set(prev)
                if (next.has(node.code)) next.delete(node.code)
                else next.add(node.code)
                return next
              })}
              aria-label={isExpanded ? `折叠 ${node.name}` : `展开 ${node.name}`}
            >
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="h-5 w-5 shrink-0" />
          )}
          <label
            className={cn(
              'flex flex-1 cursor-pointer items-center gap-2 rounded-md border px-2 py-1 text-xs transition-colors',
              isSelected ? 'border-primary/50 bg-primary/5 text-foreground' : 'border-border text-muted-foreground hover:bg-muted/50',
            )}
          >
            <Checkbox size="sm" className="shrink-0" checked={isSelected} onCheckedChange={() => toggle(node.code)} />
            <span className="flex-1 truncate" title={`${node.name}（${node.code}）`}>{node.name}</span>
            <span className="shrink-0 font-num text-micro text-muted-foreground">{node.code}</span>
          </label>
        </div>
        {isExpanded && children.length > 0 && (
          <div className="mt-1 space-y-1">{children.map(renderNode)}</div>
        )}
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn('w-full justify-between font-normal', value.length === 0 && 'text-muted-foreground')}
        >
          {value.length > 0 ? `已选 ${value.length} 个科目` : `选择${label}（可多选）`}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-72 w-96 overflow-y-auto" align="start">
        {isLoading && (
          <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />加载科目树…
          </div>
        )}
        {!isLoading && nodes.length === 0 && (
          <p className="p-2 text-xs text-muted-foreground">未检测到收入类别科目（科目树中可能尚未配置「壹品慧收入」）</p>
        )}
        <div className="space-y-1">
          {roots.map(renderNode)}
        </div>
        {value.length > 0 && (
          <div className="mt-2 border-t border-border pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-full text-xs text-muted-foreground"
              onClick={() => onChange([])}
            >
              清空已选（回退关键词匹配）
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
