import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useAnalysisColMembers } from '@/hooks/api-queries'
import { ANALYSIS_ROW_DIMS, type AnalysisQuerySpec } from '@/types'
import { allColCodes, colDimOptions, colDimTriggerLabel, nextColCodes } from '@/lib/analysis-col-members'

/**
 * 列维度选择器（矩阵模式，v2，见 docs/plans/即席分析-L1L2-阶段方案.md §2.1）。
 *
 * 两段式：先选列维度（无 = 单轴 v1 形态），再在该维度成员中多选（缺省全部成员）。
 * 列维度候选自动剔除行维度（后端 schema 层拒绝行列同维，前端不给犯错的入口）；
 * 成员清单走后端 /analysis/col-members，与查询内的 resolveColMembers 同源。
 */

type ColDim = NonNullable<AnalysisQuerySpec['colDim']>

const NONE = '__none__'

export function ColDimPicker({
  rowDim,
  value,
  colCodes,
  onChange,
}: {
  rowDim: AnalysisQuerySpec['rowDim']
  value?: ColDim
  /** 空数组 = 全部成员（缺省） */
  colCodes: string[]
  onChange: (dim: ColDim | undefined, codes: string[]) => void
}) {
  const options = colDimOptions(ANALYSIS_ROW_DIMS, rowDim)
  const membersQuery = useAnalysisColMembers(value)
  // 稳定引用：避免每次 render 新建数组触发下游 useMemo/effect 抖动
  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data])

  // 切换列维度时重置成员选择（新维度的旧编码无意义）
  const handleDimChange = (v: string) => {
    onChange(v === NONE ? undefined : (v as ColDim), [])
  }

  const selected = useMemo(() => new Set(colCodes), [colCodes])
  const [keyword, setKeyword] = useState('')
  useEffect(() => { setKeyword('') }, [value])

  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    return kw ? members.filter((m) => m.name.toLowerCase().includes(kw) || m.code.toLowerCase().includes(kw)) : members
  }, [members, keyword])

  const toggle = (code: string, checked: boolean) => {
    onChange(value, nextColCodes(colCodes, members.map((m) => m.code), code, checked))
  }
  const setAll = (on: boolean) => onChange(value, allColCodes(members.map((m) => m.code), on))

  const dimLabel = value ? labelOf(value) : ''
  const triggerLabel = !value
    ? '无（单指标列）'
    : colDimTriggerLabel(dimLabel, colCodes, members.length)

  return (
    <div className="flex items-center gap-2">
      <Select value={value ?? NONE} onValueChange={handleDimChange}>
        <SelectTrigger className="h-9 w-[150px]" aria-label="列维度">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>无（单指标列）</SelectItem>
          {options.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {value && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" aria-label="列成员选择">
              {triggerLabel}
              <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <div className="border-b p-2">
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索列成员名称 / 编码"
                aria-label="搜索列成员"
                className="h-8"
              />
            </div>
            <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs text-muted-foreground">
              <span>{membersQuery.isPending ? '加载中…' : `共 ${members.length} 个成员`}</span>
              <span className="flex gap-2">
                <button type="button" className="hover:text-foreground" onClick={() => setAll(true)}>全选</button>
                <button type="button" className="hover:text-foreground" onClick={() => setAll(false)}>清空</button>
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
              {membersQuery.isPending ? (
                <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />正在加载成员…
                </p>
              ) : visible.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">无匹配成员</p>
              ) : (
                visible.map((m) => {
                  const checked = colCodes.length === 0 || selected.has(m.code)
                  return (
                    <label key={m.code} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => toggle(m.code, v === true)}
                        aria-label={m.name}
                      />
                      <span className="truncate" title={`${m.name}（${m.code}）`}>{m.name}</span>
                      <code className="ml-auto shrink-0 text-[10px] text-muted-foreground">{m.code}</code>
                      {checked && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                    </label>
                  )
                })
              )}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

function labelOf(dim: ColDim): string {
  return ANALYSIS_ROW_DIMS.find((d) => d.value === dim)?.label ?? dim
}
