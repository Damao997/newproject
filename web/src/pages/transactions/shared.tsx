import { Fragment, useMemo, type ReactNode } from 'react'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { useCompanies, useTransactionAccounts } from '@/hooks/api-queries'
import { cn, formatMoneyWan } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ChevronDown } from 'lucide-react'

export const TRANSACTION_TYPES = ['应收账款', '其他应收款', '预收账款', '应付账款', '其他应付款', '预付账款']
// 默认展示口径：浙江省公司汇总（汇总主体编码 ET0001，后端按汇总映射展开为成员合并口径）
export const DEFAULT_SUMMARY_CODE = 'ET0001'
// 账龄分析展示分段（后端已由 10 段归集为 8 段，1-3月与1年至3年均按单段展开）
export const AGING_GROUPS = ['1个月', '2个月', '3个月', '4-6月', '半年以上', '1年至2年', '2年至3年', '3年以上']
// 贷方性质类型（债务）：余额已在导入时按科目性质归一为正号，净额 = 债权 - 债务
export const CREDIT_NATURE_TYPES = ['预收账款', '应付账款', '其他应付款']

/**
 * 默认展示主体：ET0001 → 首个授权汇总主体 → 首个授权单体。
 * useCompanies 已按数据权限过滤（与后端 pickDefaultCompany 同源，均按 orderNo），
 * 无 ET0001 权限时返回首个有权主体；无任何权限返回 null。
 */
export function useDefaultCompanyCode(): string | null {
  const { data: companies } = useCompanies()
  return useMemo(() => {
    const list = companies ?? []
    const et0001 = list.find((c) => c.code === DEFAULT_SUMMARY_CODE)
    if (et0001) return et0001.code
    const summary = list.find((c) => c.type === 'summary')
    if (summary) return summary.code
    const entity = list.find((c) => c.type === 'entity')
    return entity?.code ?? null
  }, [companies])
}

/** 金额展示：按「万」计 + 千分位，「万」字缩小为小号后缀 */
export function formatAmount(v: number): ReactNode {
  return (
    <>
      {formatMoneyWan(v / 10000)}
      <span className="ml-0.5 text-[0.55em] font-normal text-muted-foreground">万</span>
    </>
  )
}

// 关联方三分类标签样式（内部公司/关联方/外部）
const PARTY_TYPE_META: Record<string, { label: string; className: string }> = {
  internal: { label: '内部公司', className: 'bg-chart-1/10 text-chart-1' },
  related: { label: '关联方', className: 'bg-chart-5/10 text-chart-5' },
  external: { label: '外部', className: 'bg-muted text-muted-foreground' },
}

export function PartyTypeTag({ partyType }: { partyType?: string }) {
  const meta = PARTY_TYPE_META[partyType ?? 'external'] ?? PARTY_TYPE_META.external
  return <span className={cn('rounded px-1.5 py-0.5 text-xs', meta.className)}>{meta.label}</span>
}

/** 8 段账龄堆叠条色阶：绿→青→蓝→紫→黄→橙→红（success/info/warning/destructive 系，同系两段深浅区分） */
export const AGING_BAR_COLORS = [
  'bg-success', 'bg-success/60',
  'bg-info', 'bg-info/60',
  'bg-warning', 'bg-warning/60',
  'bg-destructive/60', 'bg-destructive',
] as const

/** 账龄堆叠条：按 8 段占比渲染（总余额 ≤0 时不渲染）；各段 title 显示段名与金额（万） */
export function AgingStackBar({ aging, closingBalance, className }: { aging: Record<string, number>; closingBalance: number; className?: string }) {
  const total = closingBalance > 0 ? closingBalance : Object.values(aging).reduce((s, v) => s + (v ?? 0), 0)
  if (total <= 0) return null
  return (
    <div className={cn('flex h-1.5 w-full overflow-hidden rounded-full bg-muted', className)}>
      {AGING_GROUPS.map((g, i) => {
        const v = aging[g] ?? 0
        if (v <= 0) return null
        return (
          <div
            key={g}
            className={AGING_BAR_COLORS[i]}
            style={{ width: `${Math.max((v / total) * 100, 1)}%` }}
            title={`${g}：${formatMoneyWan(v / 10000)} 万`}
          />
        )
      })}
    </div>
  )
}

/** 账龄风险分档（供总览卡片/分析抽屉复用）：danger=3年+>20%、watch=3年+≥5%、good=其余；余额≤0 返回 null */
export function agingRisk(aging: Record<string, number>, closingBalance: number): { level: 'danger' | 'watch' | 'good'; text: string } | null {
  if (closingBalance <= 0) return null
  const total = closingBalance
  const pct = (b: string) => ((aging[b] ?? 0) / total) * 100
  const threePlus = pct('3年以上')
  if (threePlus > 20) return { level: 'danger', text: `3 年以上账龄占 ${threePlus.toFixed(1)}%，存在高逾期风险` }
  if (threePlus >= 5) return { level: 'watch', text: `3 年以上账龄占 ${threePlus.toFixed(1)}%，建议关注回收` }
  const in1y = AGING_GROUPS.slice(0, 5).reduce((s, b) => s + pct(b), 0)
  return { level: 'good', text: `账龄结构良好，1 年内占 ${in1y.toFixed(1)}%` }
}

// 对象类型多选选项（空数组 = 全部对象；默认勾选外部+关联方，排除内部公司）
export const PARTY_TYPES: { value: string; label: string }[] = [
  { value: 'external', label: '外部' },
  { value: 'related', label: '关联方' },
  { value: 'internal', label: '内部公司' },
]

// 对象类型多选筛选器（空数组 = 全部对象）
export function PartyTypeSelect({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const label = useMemo(() => {
    if (value.length === 0) return '全部对象'
    const firstName = PARTY_TYPES.find((t) => t.value === value[0])?.label ?? value[0]
    return value.length === 1 ? firstName : `${firstName} 等 ${value.length} 个`
  }, [value])

  const toggle = (v: string, checked: boolean) => {
    onChange(checked ? [...value, v] : value.filter((x) => x !== v))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-9 w-[150px] justify-between px-3 font-normal">
          <span className="truncate">{label}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[150px]">
        <DropdownMenuItem
          className="text-xs text-muted-foreground"
          onSelect={(e) => { e.preventDefault(); onChange([]) }}
        >
          清空（全部对象）
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {PARTY_TYPES.map((t) => (
          <DropdownMenuCheckboxItem
            key={t.value}
            checked={value.includes(t.value)}
            onCheckedChange={(checked) => toggle(t.value, checked === true)}
            onSelect={(e) => e.preventDefault()}
          >
            {t.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// 明细/账龄共用的科目多选筛选器（空数组语义为「全部科目」）
// 选项 = 科目主数据全集 + 实际数据合并：有数据科目在前，科目体系中已定义但当前无数据的置底灰显；
// 可选项随 transactionType 联动收窄，未选类型时为六大往来全部科目
export function AccountMultiSelect({ value, onChange, transactionType }: { value: string[]; onChange: (v: string[]) => void; transactionType?: string }) {
  const { data: accounts } = useTransactionAccounts(transactionType)
  const label = useMemo(() => {
    if (value.length === 0) return '全部科目'
    const first = (accounts || []).find((a) => a.accountCode === value[0])
    const firstName = first?.accountDesc || value[0]
    return value.length === 1 ? firstName : `${firstName} 等 ${value.length} 个`
  }, [value, accounts])

  // 后端已按 hasData 排序，取首个无数据项位置插入分组分隔
  const firstNoDataCode = (accounts || []).find((a) => !a.hasData)?.accountCode

  const toggle = (code: string, checked: boolean) => {
    onChange(checked ? [...value, code] : value.filter((c) => c !== code))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-9 w-[200px] justify-between px-3 font-normal">
          <span className="truncate">{label}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-[320px] w-[260px] overflow-y-auto">
        <DropdownMenuItem
          className="text-xs text-muted-foreground"
          onSelect={(e) => { e.preventDefault(); onChange([]) }}
        >
          清空（全部科目）
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {(accounts || []).map((a) => (
          <Fragment key={a.accountCode}>
            {a.accountCode === firstNoDataCode && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="py-1 text-xs font-normal text-muted-foreground">以下科目当前无数据</DropdownMenuLabel>
              </>
            )}
            <DropdownMenuCheckboxItem
              checked={value.includes(a.accountCode)}
              onCheckedChange={(checked) => toggle(a.accountCode, checked === true)}
              onSelect={(e) => e.preventDefault()}
              className={cn(!a.hasData && 'text-muted-foreground')}
            >
              <span className="truncate">
                {a.accountDesc || a.accountCode}
                <span className="ml-1 text-xs text-muted-foreground">{a.accountCode}</span>
                {!a.hasData && <span className="ml-1 text-xs text-muted-foreground">· 无数据</span>}
              </span>
            </DropdownMenuCheckboxItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 明细筛选生效条件摘要（供折叠 trigger 展示；空数组 = 无生效条件） */
export function buildDetailSummary(
  accountFilter: string[],
  partyFilter: string[],
  keyword: string,
  subtotalOnly: boolean,
): string[] {
  const parts: string[] = []
  if (accountFilter.length > 0) parts.push(`${accountFilter.length} 个科目`)
  if (partyFilter.length > 0) parts.push('已选对象类型')
  if (keyword.trim()) parts.push('有关键词')
  if (subtotalOnly) parts.push('仅显示小计')
  return parts
}
