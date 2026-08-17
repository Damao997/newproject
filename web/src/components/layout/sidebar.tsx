import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronsLeft, ChevronsRight, X, ChevronDown } from 'lucide-react'
import { usePermission } from '@/hooks/usePermission'
import { navItems, type NavChild, type NavItem } from './nav-items'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { getCurrentVersion } from '@/lib/app-version'

interface SidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  mobileOpen: boolean
  onMobileClose: () => void
}

interface NavListProps {
  collapsed: boolean
  onNavigate?: () => void
  /** desktop：折叠态点击弹层 / 展开态内联手风琴；mobile：抽屉内联列表 */
  variant?: 'desktop' | 'mobile'
}

/** 一级导航项基础样式（桌面与移动端共用）：微软雅黑 + 加粗（font-semibold） */
const linkBase =
  'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold transition-colors duration-150'
/** 激活态：选中背景（浅色=浅橙 / 紫渐变=顶部紫 / 深色=稍亮灰黑）+ 选中文字色，三风格自适应 */
const linkActive = 'bg-sidebar-selected-bg font-semibold text-sidebar-selected-fg'
/** 非激活态：侧边栏主文字色 + 前景色 10% hover 层（三风格自适应） */
const linkIdle = 'text-sidebar-fg hover:bg-sidebar-fg/10'
const linkIcon = 'h-4 w-4 shrink-0'

/** 一级项激活指示条：跟随选中文字色（浅色=橙 / 紫渐变=白 / 深色=白） */
function ActiveBar() {
  return <span className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-sidebar-selected-fg" />
}

/** 当前 URL（pathname + search），用于子菜单项精确高亮 */
function useCurrentUrl() {
  const location = useLocation()
  return location.pathname + location.search
}

/**
 * 公共递归子列表（二级/三级菜单）：点击一级项后直接全部展开显示。
 * - 目录项（有 children，如「维度/科目体系」）：纯容器标题，不可点击、不可选中，
 *   仅作层级分组，其三级子列表直接内联显示；
 * - 叶子项：普通 Link；
 * - 所有子项不显示展开/收起箭头图标（一级项 ChevronDown 除外）；
 * - 高亮：叶子项精确匹配（pathname+search），目录项不做任何激活态。
 * - onSurface：'sidebar' = 侧边栏内联（使用侧边栏前景色系），'popover' = 白底弹层（深色文字）。
 */
function NavSubList({
  items,
  depth,
  onNavigate,
  onSurface = 'popover',
}: {
  items: NavChild[]
  depth: number
  onNavigate?: () => void
  onSurface?: 'sidebar' | 'popover'
}) {
  const currentUrl = useCurrentUrl()
  const dirCls = onSurface === 'sidebar' ? 'text-sidebar-fg/70' : 'text-muted-foreground'
  const leafIdleCls =
    onSurface === 'sidebar'
      ? 'text-sidebar-fg/80 hover:bg-sidebar-fg/10 hover:text-sidebar-fg'
      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'

  return (
    <div className={cn('mt-1 space-y-1', depth >= 2 && 'ml-5 border-l border-border pl-2')}>
      {items.map((child) => {
        if (child.children?.length) {
          return (
            <div key={child.path}>
              {/* 目录项：纯容器标题，不可点击、不可选中（仅作层级分组） */}
              <div
                className={cn(
                  'flex select-none items-center rounded-md py-1.5 text-sm font-medium',
                  dirCls,
                  depth === 1 ? 'pl-9 pr-3' : 'pl-6 pr-3'
                )}
              >
                <span className="pl-1.5">{child.label}</span>
              </div>
              {/* 三级直接内联显示，无展开/收起状态与箭头 */}
              <NavSubList items={child.children} depth={depth + 1} onNavigate={onNavigate} onSurface={onSurface} />
            </div>
          )
        }

        const isLeafActive = currentUrl === child.path
        return (
          <Link
            key={child.path}
            to={child.path}
            onClick={onNavigate}
            className={cn(
              'relative flex items-center rounded-md py-1.5 text-sm font-medium transition-colors duration-150',
              depth === 1 ? 'pl-9 pr-3' : 'pl-6 pr-3',
              isLeafActive
                ? 'font-medium text-sidebar-selected-fg'
                : leafIdleCls
            )}
          >
            {isLeafActive && <ActiveBar />}
            <span className="pl-1.5">{child.label}</span>
          </Link>
        )
      })}
    </div>
  )
}

/**
 * 桌面端一级导航项（折叠态专用）：点击图标弹出 fixed 面板（手风琴单开，受控）。
 * 面板内二级/三级直接显示；点击外部 / Escape / 页面滚动 / 路由变化时关闭。
 */
function DesktopNavDropdown({
  item,
  open,
  onToggle,
  onNavigate,
}: {
  item: NavItem
  open: boolean
  onToggle: () => void
  onNavigate?: () => void
}) {
  const currentUrl = useCurrentUrl()
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const Icon = item.icon
  const isActive = currentUrl.startsWith(item.path)

  // 打开时按 trigger 视口坐标计算面板位置
  useEffect(() => {
    if (!open) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) setPanelPos({ top: rect.top, left: rect.right + 4 })
  }, [open])

  // 点击面板/trigger 外部或按 Escape 时关闭
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      if (triggerRef.current?.contains(e.target as Node)) return
      if (panelRef.current?.contains(e.target as Node)) return
      onToggle()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onToggle()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onToggle])

  return (
    <div ref={triggerRef} className="relative">
      {/* 折叠态悬停显示模块名；点击仍弹出二级/三级面板（Tooltip 与弹层共存） */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={onToggle}
            className={cn(linkBase, 'w-full justify-center bg-transparent px-2', isActive ? linkActive : linkIdle)}
          >
            {isActive && <ActiveBar />}
            <Icon className={linkIcon} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>

      {/* 二级/三级面板：fixed 定位（nav overflow 裁剪不了），关闭即卸载（无关闭动画） */}
      {open && panelPos && (
        <div
          ref={panelRef}
          role="menu"
          style={{ top: panelPos.top, left: panelPos.left }}
          className="fixed z-50 max-h-[min(480px,calc(100vh-32px))] min-w-[9rem] overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95"
        >
          <NavSubList items={item.children!} depth={1} onNavigate={onNavigate} />
        </div>
      )}
    </div>
  )
}

/**
 * 桌面端一级导航项（展开态专用）：点击在手风琴组内联展开二级/三级列表。
 * 一级项保留 ChevronDown 旋转指示；子项无箭头。
 */
function DesktopInlineNavItem({
  item,
  expanded,
  onToggle,
  onNavigate,
}: {
  item: NavItem
  expanded: boolean
  onToggle: () => void
  onNavigate?: () => void
}) {
  const currentUrl = useCurrentUrl()
  const Icon = item.icon
  const isActive = currentUrl.startsWith(item.path)

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(linkBase, 'w-full bg-transparent text-left', isActive ? linkActive : linkIdle)}
      >
        {isActive && <ActiveBar />}
        <Icon className={linkIcon} />
        <span className="truncate">{item.label}</span>
        <ChevronDown
          className={cn(
            'ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
            expanded && 'rotate-180'
          )}
        />
      </button>
      {expanded && (
        <div className="animate-in fade-in slide-in-from-top-1 duration-100">
          <NavSubList items={item.children!} depth={1} onNavigate={onNavigate} onSurface="sidebar" />
        </div>
      )}
    </div>
  )
}

/** 移动端抽屉内一级导航项：有子项时点击展开/收起内联二级/三级列表（三级直接显示），无子项时直接跳转 */
function MobileNavItem({
  item,
  expanded,
  onToggle,
  onNavigate,
}: {
  item: NavItem
  expanded: boolean
  onToggle: () => void
  onNavigate?: () => void
}) {
  const location = useLocation()
  const Icon = item.icon
  const isActive = location.pathname.startsWith(item.path)

  if (!item.children?.length) {
    return (
      <Link to={item.path} onClick={onNavigate} className={cn(linkBase, isActive ? linkActive : linkIdle)}>
        {isActive && <ActiveBar />}
        <Icon className={linkIcon} />
        <span className="truncate">{item.label}</span>
      </Link>
    )
  }

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className={cn(linkBase, 'w-full text-left', isActive ? linkActive : linkIdle)}
      >
        {isActive && <ActiveBar />}
        <Icon className={linkIcon} />
        <span className="truncate">{item.label}</span>
        <ChevronDown
          className={cn(
            'ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-150',
            expanded && 'rotate-180'
          )}
        />
      </button>
      {expanded && (
        <div className="animate-in fade-in slide-in-from-top-1 duration-100">
          <NavSubList items={item.children} depth={1} onNavigate={onNavigate} onSurface="sidebar" />
        </div>
      )}
    </div>
  )
}

function NavList({ collapsed, onNavigate, variant = 'desktop' }: NavListProps) {
  const location = useLocation()
  const { permissions } = usePermission()

  // 依据《安全与权限规范》§2.2，仅展示当前角色有 view 权限的模块入口
  const visibleNavItems = useMemo(
    () => navItems.filter((item) => permissions.includes(item.resource)),
    [permissions]
  )
  const currentUrl = location.pathname + location.search

  // 内联手风琴：当前展开的一级项（桌面展开态/移动端共用，单开）
  const [expandedPath, setExpandedPath] = useState<string | null>(() => {
    const active = visibleNavItems.find((i) => i.children?.length && currentUrl.startsWith(i.path))
    return active?.path ?? null
  })
  // 折叠态弹出面板：当前打开的一级项（单开）
  const [openPanelPath, setOpenPanelPath] = useState<string | null>(null)

  // 路由跟随：导航到其他模块时内联展开组自动切换；折叠面板随路由变化关闭
  useEffect(() => {
    const active = visibleNavItems.find((i) => i.children?.length && currentUrl.startsWith(i.path))
    setExpandedPath(active?.path ?? null)
    setOpenPanelPath(null)
  }, [currentUrl, visibleNavItems])

  // 折叠态：页面滚动时关闭弹出面板（fixed 面板避免与 trigger 错位）
  useEffect(() => {
    if (variant !== 'desktop' || !collapsed) return
    const onScroll = () => setOpenPanelPath(null)
    window.addEventListener('scroll', onScroll, true)
    return () => window.removeEventListener('scroll', onScroll, true)
  }, [variant, collapsed])

  const toggleInline = (path: string) =>
    setExpandedPath((prev) => (prev === path ? null : path))
  const togglePanel = (path: string) =>
    setOpenPanelPath((prev) => (prev === path ? null : path))

  return (
    <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3 font-sans">
      {visibleNavItems.map((item) => {
        if (variant === 'mobile') {
          return (
            <MobileNavItem
              key={item.path}
              item={item}
              expanded={expandedPath === item.path}
              onToggle={() => toggleInline(item.path)}
              onNavigate={onNavigate}
            />
          )
        }
        if (item.children?.length) {
          return collapsed ? (
            <DesktopNavDropdown
              key={item.path}
              item={item}
              open={openPanelPath === item.path}
              onToggle={() => togglePanel(item.path)}
              onNavigate={onNavigate}
            />
          ) : (
            <DesktopInlineNavItem
              key={item.path}
              item={item}
              expanded={expandedPath === item.path}
              onToggle={() => toggleInline(item.path)}
              onNavigate={onNavigate}
            />
          )
        }
        const Icon = item.icon
        const isActive = location.pathname.startsWith(item.path)
        const link = (
          <Link
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            className={cn(
              linkBase,
              isActive ? linkActive : linkIdle,
              collapsed && 'justify-center px-2'
            )}
          >
            {isActive && <ActiveBar />}
            <Icon className={linkIcon} />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        )
        if (!collapsed) return link
        return (
          <Tooltip key={item.path}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        )
      })}
    </nav>
  )
}

function SidebarBrand({ collapsed, className }: { collapsed: boolean; className?: string }) {
  return (
    <Link
      to="/dashboard"
      className={cn(
        'flex h-14 shrink-0 items-center gap-2 px-4',
        collapsed && 'justify-center px-2',
        className
      )}
    >
      <img src="/logo.png" alt="壹品慧" className="h-7 w-7 object-contain" />
      {!collapsed && (
        <span className="truncate text-base font-bold tracking-tight text-sidebar-brand-fg">浙江壹品慧经营分析平台</span>
      )}
    </Link>
  )
}

export function Sidebar({ collapsed, onToggleCollapse, mobileOpen, onMobileClose }: SidebarProps) {
  return (
    <TooltipProvider delayDuration={0}>
      {/* 桌面端侧边栏：独立列从页面顶部开始渲染（覆盖 Header 高度区域），全高贴边；右侧上下圆角与页面卡片一致（rounded-r-card 8px），左侧直角 */}
      <aside
        className={cn(
          'relative hidden shrink-0 flex-col overflow-hidden rounded-r-card border-r border-sidebar-border bg-sidebar-bg transition-[width] duration-200 ease-brand md:flex',
          collapsed ? 'w-16' : 'w-60'
        )}
      >
        <SidebarBrand collapsed={collapsed} />
        <NavList collapsed={collapsed} />
        <div className={cn('shrink-0 p-2', collapsed && 'flex justify-center')}>
          {/* 当前部署版本（部署脚本注入 meta app-version；开发环境显示 dev） */}
          {!collapsed && (
            <p className="mb-1 px-2 text-[11px] text-sidebar-fg">版本 {getCurrentVersion()}</p>
          )}
        </div>
        {/* 折叠条：右缘透明按钮（仅箭头图标，三风格自适应）；展开态箭头半透明，hover 转选中色；收起态箭头选中色常驻 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
              onClick={onToggleCollapse}
              className="group absolute inset-y-0 right-0 z-10 flex w-6 items-center justify-center"
            >
              {collapsed ? (
                <ChevronsRight className="h-4 w-4 shrink-0 text-sidebar-selected-fg transition-transform group-hover:scale-110" />
              ) : (
                <ChevronsLeft className="h-4 w-4 shrink-0 text-sidebar-fg/60 transition-colors group-hover:text-sidebar-selected-fg" />
              )}
            </button>
          </TooltipTrigger>
          {collapsed && <TooltipContent side="right">展开侧边栏</TooltipContent>}
        </Tooltip>
      </aside>

      {/* 移动端抽屉 */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={onMobileClose} />
          <aside className="absolute inset-y-0 left-0 flex w-60 flex-col bg-sidebar-bg shadow-lg animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between pr-2">
              <SidebarBrand collapsed={false} />
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={onMobileClose}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <NavList collapsed={false} onNavigate={onMobileClose} variant="mobile" />
          </aside>
        </div>
      )}
    </TooltipProvider>
  )
}
