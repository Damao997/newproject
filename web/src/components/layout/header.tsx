import { Menu } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Breadcrumb } from './breadcrumb'
import { CompanyPill } from './company-pill'
import { PeriodPill } from './period-pill'
import { RefreshButton } from './refresh-button'
import { UserChip } from './user-chip'
import { HeaderTitleHost } from './page-heading'
import { getHeaderFilterVisibility } from './header-filter-visibility'

interface HeaderProps { onMenuClick: () => void }

/** 主标题和全局范围集中在顶栏；手机分成两行，保证各个操作始终可达。 */
export function Header({ onMenuClick }: HeaderProps) {
  const location = useLocation()
  const { showCompany, showPeriod } = getHeaderFilterVisibility(location.pathname)
  const reportDetail = /\/reports\/(?:editor\/|[^/]+\/(?:edit|read))/.test(location.pathname)

  return <header className="app-header z-40 w-full shrink-0 border-b border-subtle bg-background font-sans">
    <div className="header-inner">
      <div className="header-leading flex min-w-0 items-center gap-2">
        <Button variant="ghost" size="icon" className="header-menu h-8 w-8 shrink-0 text-foreground md:hidden" aria-label="打开导航菜单" onClick={onMenuClick}>
          <Menu className="h-5 w-5" />
        </Button>
        <div className="header-page-context min-w-0">
          <HeaderTitleHost />
          {reportDetail && <div className="header-breadcrumb min-w-0"><Breadcrumb singleLine /></div>}
        </div>
      </div>
      <div className="header-controls flex min-w-0 items-center gap-2">
        {showCompany && <CompanyPill selectionMode={location.pathname.startsWith('/dashboard/analysis/') ? 'single' : 'multiple'} />}
        {showPeriod && <PeriodPill />}
        <RefreshButton />
        <UserChip />
      </div>
    </div>
  </header>
}
