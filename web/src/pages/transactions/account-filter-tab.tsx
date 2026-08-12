import { useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { usePermission } from '@/hooks/usePermission'
import { useManageAccounts, useUpdateAccountStatus } from '@/hooks/api-queries'
import { usePageStore } from '@/stores/pageStateStore'
import { Loader2, FilterX } from 'lucide-react'
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

  const list = accounts ?? []
  const activeCount = list.filter((a) => a.status === 'active').length
  const excludedCount = list.length - activeCount

  // 默认收敛：只显示 有数据 或 已排除 的科目；展开后显示全部
  const grouped = useMemo(() => {
    const visible = showAll ? list : list.filter((a) => a.hasData || a.status === 'inactive')
    const map = new Map<string, ManageAccountItem[]>()
    for (const a of visible) {
      if (!map.has(a.transactionType)) map.set(a.transactionType, [])
      map.get(a.transactionType)!.push(a)
    }
    return TYPE_ORDER.filter((t) => map.has(t)).map((t) => ({ type: t, items: map.get(t)! }))
  }, [list, showAll])

  const visibleCount = grouped.reduce((s, g) => s + g.items.length, 0)
  const hasHidden = visibleCount < list.length

  const onToggle = (a: ManageAccountItem) => {
    updateStatus.mutate({ code: a.code, status: a.status === 'active' ? 'inactive' : 'active' })
  }

  return (
    <div className="space-y-4">
      {/* 科目过滤卡：标题统计 + 交互说明 + 科目标签云 */}
      <Card className="rounded-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <FilterX className="h-4 w-4" />
              科目过滤
            </h3>
            <span className="text-xs text-muted-foreground">
              已纳入 <span className="font-medium text-success-strong">{activeCount}</span> 个 · 已排除 <span className="font-medium text-warning-strong">{excludedCount}</span> 个
            </span>
          </div>
        </div>
        <div className="p-4">
          <p className="pb-3 text-xs text-muted-foreground">
            点击标签即可排除/恢复该科目：排除后账龄分析将自动剔除其数据，且不再出现在科目筛选下拉中。
          </p>
        <div>
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中...
            </div>
          ) : list.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">暂无科目主数据</div>
          ) : (
            <div className="space-y-5">
              {grouped.map((g) => (
                <div key={g.type}>
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    {g.type}
                    <span className="text-xs font-normal text-muted-foreground">{g.items.length} 个科目</span>
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
                    {showAll ? '收起无数据科目' : `显示全部 ${list.length} 个科目`}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
        </div>
      </Card>
    </div>
  )
}
