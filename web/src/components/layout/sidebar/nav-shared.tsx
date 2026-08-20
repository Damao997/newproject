/** 一级导航项基础样式（桌面与移动端共用）：微软雅黑 + 加粗（font-semibold） */
export const linkBase =
  'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-semibold transition-colors duration-150'
/** 激活态：选中背景（浅色=浅橙 / 紫渐变=顶部紫 / 深色=稍亮灰蓝）+ 选中文字色，三风格自适应 */
export const linkActive = 'bg-sidebar-selected-bg font-semibold text-sidebar-selected-fg'
/** 非激活态：侧边栏主文字色 + 选中背景色 40% hover 层（三风格自适应：浅色淡橙 / 紫渐变淡紫蓝 / 深色提亮灰蓝） */
export const linkIdle = 'text-sidebar-fg hover:bg-sidebar-selected-bg/40'
export const linkIcon = 'h-4 w-4 shrink-0'

/** 一级项激活指示条：三风格专用色（浅色=橙 / 紫渐变=白 / 深色=柔和亮蓝，避免深底白条刺眼） */
export function ActiveBar() {
  return <span className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-sidebar-active-bar" />
}
