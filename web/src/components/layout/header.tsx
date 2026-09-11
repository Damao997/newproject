import { Menu } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Breadcrumb } from './breadcrumb'
import { CompanyPill } from './company-pill'
import { PeriodPill } from './period-pill'
import { RefreshButton } from './refresh-button'
import { UserChip } from './user-chip'
import { getHeaderFilterVisibility } from './header-filter-visibility'

interface HeaderProps {
  onMenuClick: () => void
}

/**
 * 顶栏：参考 AntD ProLayout 风格重构（白底 + 56px 高 + 底边细分隔线）。
 * 左侧（移动端）：汉堡 + 品牌（仅 <768px 显示）。
 * 左侧（桌面端）：面包屑（≥1 节点时全场景显示，与「恢复面包屑显示」决议一致）。
 * 右侧：CompanyPill / PeriodPill / RefreshButton / UserChip（全局筛选：公司 → 期间，均为 h-8 圆角胶囊；
 * 部分不需要公司/期间筛选的页面按 header-filter-visibility.ts 配置条件卸载两胶囊）。
 *
 * 历史原 header 内联的财年选择 + 用户头像下拉 + 主题切换已拆分至独立组件（PeriodPill /
 * UserChip / RefreshButton），便于单测与复用；PeriodPill / CompanyPill 自管理加载/失败/空数据态。
 */
export function Header({ onMenuClick }: HeaderProps) {
  const location = useLocation()
  const { showCompany, showPeriod } = getHeaderFilterVisibility(location.pathname)

  return (
    <header className="z-40 w-full shrink-0 border-b border-border/60 bg-background font-sans">
      <div className="flex h-14 items-center px-4">
        {/* 移动端：菜单按钮 + 品牌标识（<640px 仅 Logo 最大化内容空间，640-767px 标题单行截断） */}
        <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-foreground"
            aria-label="打开导航菜单"
            onClick={onMenuClick}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <img src="/logo.png" alt="壹品慧" className="h-7 w-7 shrink-0 object-contain" />
          <span className="hidden min-w-0 truncate text-base font-bold text-foreground sm:inline">
            浙江壹品慧经营分析平台
          </span>
        </div>

        {/* 桌面端面包屑：全场景显示（左对齐占满剩余空间，单行截断）；<768px 隐藏（左侧为汉堡+品牌） */}
        <div className="hidden min-w-0 flex-1 items-center overflow-hidden md:flex">
          <Breadcrumb singleLine />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {showCompany && <CompanyPill />}
          {showPeriod && <PeriodPill />}
          <RefreshButton />
          <UserChip />
        </div>
      </div>
    </header>
  )
}
