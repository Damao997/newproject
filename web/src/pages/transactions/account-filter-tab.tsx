import { useCallback, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { useManageAccounts, useUpdateAccountStatus } from '@/hooks/api-queries'
import { usePageStore } from '@/stores/pageStateStore'
import { Loader2, FilterX, Search, Info } from 'lucide-react'
import type { ManageAccountItem } from '@/types'

/**
 * 科目过滤 Tab（紧凑标签点选式）：配置哪些往来科目纳入/排除分析。
 * 单击标签即切换纳入/排除；排除（inactive）的科目会在账龄分析中被自动剔除，
 * 且不出现在科目筛选下拉中。默认只显示有数据或已排除的科目，其余可展开查看。
 */

const TYPE_ORDER = ['应收账款', '其他应收款', '预收账款', '应付账款', '其他应付款', '预付账款']

/** 标签显示文本：去掉与所属类型重复的名称前缀（如「应收账款-商品类-增值商品」→「商品类-增值商品」） */
function displayName(a: ManageAccountItem): string {
  const prefix = `${a.transactionType}-`
  return a.name.startsWith(prefix) ? a.name.slice(prefix.length) : a.name
}

export function AccountFilterTab() {
  // 展开开关持久化到 pageStateStore（切 tab/切路由/刷新后恢复）
  const setTransactionsTab = usePageStore((s) => s.setTransactionsTab)
  const showAll = usePageStore((s) => s.transactions['account-filter'].showAll)
  const setShowAll = useCallback((v: boolean) => setTransactionsTab('account-filter', { showAll: v }), [setTransactionsTab])
  const { data: accounts, isLoading } = useManageAccounts()
  const updateStatus = useUpdateAccountStatus()
  const { can } = usePermission()
  const canUpdate = can('transactions', 'update')

  const [keyword, setKeyword] = useState('')

  const list = accounts ?? []
  const activeCount = list.filter((a) => a.status === 'active').length
  const excludedCount = list.length - activeCount

  // 默认收敛：只显示 有数据 或 已排除 的科目；展开后显示全部
  const grouped = useMemo(() => {
    const kw = keyword.trim()
    const filtered = kw ? list.filter((a) => a.name.includes(kw) || a.code.includes(kw)) : list
    const visible = showAll ? filtered : filtered.filter((a) => a.hasData || a.status === 'inactive')
    const map = new Map<string, ManageAccountItem[]>()
    for (const a of visible) {
      if (!map.has(a.transactionType)) map.set(a.transactionType, [])
      map.get(a.transactionType)!.push(a)
    }
    // 全量分组统计（不随搜索/展开收敛，供组标题徽章使用）
    const allMap = new Map<string, { active: number; inactive: number }>()
    for (const a of list) {
      if (!allMap.has(a.transactionType)) allMap.set(a.transactionType, { active: 0, inactive: 0 })
      const e = allMap.get(a.transactionType)!
      if (a.status === 'active') e.active += 1
      else e.inactive += 1
    }
    return {
      rows: TYPE_ORDER.filter((t) => map.has(t)).map((t) => ({ type: t, items: map.get(t)! })),
      filteredTotal: filtered.length,
      allStats: allMap,
    }
  }, [list, showAll, keyword])

  const visibleCount = grouped.rows.reduce((s, g) => s + g.items.length, 0)
  const hasHidden = visibleCount < grouped.filteredTotal

  const onToggle = (a: ManageAccountItem) => {
    updateStatus.mutate({ code: a.code, status: a.status === 'active' ? 'inactive' : 'active' })
  }

  return (
    <div className="space-y-4">
      {/* 科目过滤卡：标题统计 + 交互说明 + 科目标签云 */}
      <Card className="rounded-card border border-border overflow-hidden">
        <div className="flex flex-col gap-2 border-b px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <FilterX className="h-4 w-4" />
              科目过滤
            </h3>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              已纳入 <span className="font-medium text-success-strong">{activeCount}</span> 个 · 已排除 <span className="font-medium text-warning-strong">{excludedCount}</span> 个
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="科目过滤规则说明" className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="max-w-[260px] text-xs">点击标签即可排除/恢复该科目：排除后账龄分析将自动剔除其数据，且不再出现在科目筛选下拉中。</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="relative w-full sm:w-[180px]">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="搜索科目"
              placeholder="搜索科目..."
              className="h-8 w-full pl-8 text-sm"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
        </div>
        <div className="p-4">
        <div>
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
            </div>
          ) : list.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">暂无科目主数据</div>
          ) : grouped.rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">未找到匹配科目</div>
          ) : (
            <div className="space-y-5">
              {grouped.rows.map((g) => (
                <div key={g.type}>
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    {g.type}
                    <span className="text-xs font-normal text-muted-foreground">{g.items.length} 个科目</span>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      纳入 {grouped.allStats.get(g.type)?.active ?? 0} · 排除 {grouped.allStats.get(g.type)?.inactive ?? 0}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.items.map((a) => {
                      const included = a.status === 'active'
                      return (
                        <button
                          key={a.code}
                          type="button"
                          disabled={!canUpdate || updateStatus.isPending}
                          onClick={() => onToggle(a)}
                          title={`${a.code} ${a.name}（点击${included ? '排除' : '恢复'}）`}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-colors',
                            included
                              ? 'bg-background hover:bg-muted/60'
                              : 'border-transparent bg-muted text-muted-foreground line-through hover:bg-muted/70',
                            (!canUpdate || updateStatus.isPending) && 'cursor-not-allowed opacity-60',
                          )}
                        >
                          {included
                            ? a.hasData && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                            : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />}
                          {displayName(a)}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
              {(hasHidden || showAll) && (
                <div className="flex justify-center border-t pt-3">
                  <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => setShowAll(!showAll)}>
                    {showAll ? '收起无数据科目' : `显示全部 ${grouped.filteredTotal} 个科目`}
                  </Button>
                </div>
              )}
              <div className="flex items-center gap-4 border-t border-border pt-3 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-success" /> 有数据</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-warning" /> 已排除</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full border border-dashed border-muted-foreground/60" /> 暂无数据</span>
              </div>
            </div>
          )}
        </div>
        </div>
      </Card>
    </div>
  )
}
