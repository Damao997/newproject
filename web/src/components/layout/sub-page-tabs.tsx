import { useNavigate } from 'react-router-dom'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useActivePath } from './sidebar/use-active-path'

export interface SubPageTab {
  /** 完整路由路径：Tab 激活匹配与跳转目标 */
  path: string
  label: string
}

/**
 * 模块内子页 Tab 条（导航两级化后的分类切换层）：
 * - 路由驱动：切换即 navigate 到子页真实路径（刷新/分享/权限校验沿用路由层）；
 * - 激活：pathname 精确匹配 Tab path，非法/未知路径兜底高亮第一项；
 * - 样式：line 线条式变体（选中主色短横线指示器 + 底部贯穿分割线，未选中态弱化）；
 * - 响应式：窄屏 TabsList 横向滚动（TabsTrigger 自带 whitespace-nowrap）。
 */
export function SubPageTabs({ items }: { items: SubPageTab[] }) {
  const pathname = useActivePath()
  const navigate = useNavigate()
  const active = items.find((t) => pathname === t.path) ?? items[0]

  if (items.length === 0) return null

  return (
    // shrink-0：视口撑满布局（页面根 h-[calc(100dvh-…)] 的 flex 链）下 Tab 条不参与压缩，表格区 flex-1 自适应剩余空间
    <Tabs value={active?.path} onValueChange={(v) => navigate(v)} className="shrink-0">
      <TabsList variant="line" className="max-w-full overflow-x-auto">
        {items.map((t) => (
          <TabsTrigger key={t.path} value={t.path} className="shrink-0">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
