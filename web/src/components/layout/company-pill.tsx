import { useMemo } from 'react'
import { Building2, ChevronDown, Info } from 'lucide-react'
import { message, Tooltip } from 'antd'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CompanyMultiSelect } from '@/components/filters/company-select'
import { usePeriodStore } from '@/stores/periodStore'
import { useCompanies } from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { resolveExclusiveCompanies } from '@/hooks/use-exclusive-company-filter'
import { cn } from '@/lib/utils'

/**
 * 顶栏公司胶囊（与 PeriodPill 同构形态）：
 * 触发器为 `Building2 + 文本 + ChevronDown` 的 h-8 圆角胶囊，点击展开公司多选面板；
 * 写入选中项至 periodStore（companyCodes：null = 全部公司的明确语义）。
 *
 * 数据流：
 * - useCompanies 拉取公司主数据（单体/汇总分组选项内置于 CompanyMultiSelect）
 * - 主体互斥规则（单体 vs 汇总主体互斥、汇总最多一个）由 resolveExclusiveCompanies 纯函数执行，
 *   冲突提示采用 antd message 轻提示：不依赖面板开关状态（面板内提示在面板关闭后不可见），且与
 *   页面侧 FlashMessage 形态解耦，避免同一规则两处提示实现漂移。
 *
 * 加载/失败/空数据态：与 PeriodPill 同风格（骨架 / 占位文案），避免「功能不见了」的困惑。
 */
export function CompanyPill() {
  const companyCodes = usePeriodStore((s) => s.companyCodes)
  const setCompanyCodes = usePeriodStore((s) => s.setCompanyCodes)
  const { data: companies, isPending, isError } = useCompanies()
  const { displayNameMap } = useCompanyDisplayName()

  // 互斥处理：prev 取 store 当前值（null 视为未选），冲突时修剪并轻提示
  const handleChange = (next: string[]) => {
    const result = resolveExclusiveCompanies({
      companies,
      prev: usePeriodStore.getState().companyCodes ?? [],
      next,
    })
    setCompanyCodes(result.next)
    if (result.notice) message.info(result.notice)
  }

  // 快捷操作：全选单体公司（避开互斥冲突；全选全部会混入汇总主体被规则修剪，无意义）
  const selectAllEntities = () => {
    if (companies) handleChange(companies.filter((c) => c.type === 'entity').map((c) => c.code))
  }

  const label = useMemo(() => {
    if (!companyCodes || companyCodes.length === 0) return '全部公司'
    if (companyCodes.length === 1) return displayNameMap.get(companyCodes[0]) ?? companyCodes[0]
    return `${companyCodes.length} 家公司`
  }, [companyCodes, displayNameMap])

  if (!companies || companies.length === 0) {
    return isPending ? (
      <div className="h-8 w-[140px] animate-pulse rounded-md bg-muted" />
    ) : isError ? (
      <span className="text-sm text-muted-foreground" title="公司加载失败">公司加载失败</span>
    ) : (
      <span className="text-sm text-muted-foreground" title="导入公司主数据后，可筛选公司范围">暂无公司</span>
    )
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="选择公司"
          title={`当前公司范围：${label}`}
          className={cn(
            'inline-flex h-8 items-center gap-2 rounded-md border border-border/60 bg-muted/50 px-3 text-sm text-foreground transition-colors',
            'hover:bg-muted',
          )}
        >
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="max-w-[160px] truncate font-medium">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[300px] p-3">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              公司范围
              {/* 规则说明改为 hover 展示（antd Tooltip），避免面板内长文案占位 */}
              <Tooltip title="影响看板/指标/数据浏览的公司范围；单体公司与汇总主体不能同时筛选，汇总主体仅可选择一个。">
                <Info className="h-3 w-3 cursor-help text-muted-foreground/70" aria-label="公司范围规则说明" />
              </Tooltip>
            </label>
            <CompanyMultiSelect value={companyCodes ?? []} onChange={handleChange} className="w-full" />
          </div>
          <div className="flex items-center gap-4 border-t border-border/60 pt-2">
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={selectAllEntities}
            >
              全选实体
            </button>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setCompanyCodes(null)}
            >
              全部（清空）
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
