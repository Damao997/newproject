import { useState } from 'react'
import type { NavItem } from '../nav-items'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { NavSubList } from './nav-sub-list'
import { ActiveBar, linkActive, linkBase, linkIcon, linkIdle } from './nav-shared'
import { useActivePath } from './use-active-path'
import { matchesNavPath } from '@/lib/nav-filter'

/**
 * 桌面端一级导航项（折叠态专用）：点击图标弹出 Popover 面板（手风琴单开，受控）。
 * 面板内二级菜单直接显示；位置跟随/外部点击/Escape/焦点管理由 Radix 负责。
 * 面板打开时抑制 Tooltip（避免悬停名与弹层双浮层重叠），关闭后恢复 hover 提示。
 */
export function DesktopNavDropdown({
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
  const pathname = useActivePath()
  const Icon = item.icon
  // 激活判定与展开态/移动端同口径（含子页边界匹配，防 /dashboard 误匹配 /dashboard2 类前缀）
  const isActive = matchesNavPath(pathname, item)
  // Tooltip 受控状态：点击弹层时先关闭，面板打开期间强制保持关闭
  const [tipOpen, setTipOpen] = useState(false)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setTipOpen(false)
        onToggle()
      }}
    >
      <PopoverTrigger asChild>
        <Tooltip open={open ? false : tipOpen} onOpenChange={(next) => !open && setTipOpen(next)}>
          <TooltipTrigger asChild>
            <button
              type="button"
              className={cn(linkBase, 'w-full justify-center bg-transparent px-2', isActive ? linkActive : linkIdle)}
            >
              {isActive && <ActiveBar />}
              <Icon className={linkIcon} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{item.label}</TooltipContent>
        </Tooltip>
      </PopoverTrigger>
      <PopoverContent side="right" align="start" sideOffset={4} className="max-h-[min(480px,calc(100vh-32px))] min-w-[9rem] overflow-y-auto p-1">
        <NavSubList items={item.children!} onNavigate={onNavigate} />
      </PopoverContent>
    </Popover>
  )
}
