/** 一级导航项基础样式（桌面与移动端共用）：微软雅黑 + 常规字重（对齐 antd Menu 400） */
export const linkBase =
  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-normal transition-colors duration-150'
/** 激活态：选中背景实色（浅色=浅橙 / 紫渐变=亮紫蓝 / 深色=提亮灰蓝 / 深蓝=#1677ff）+ 选中文字色，四风格自适应；无左侧指示条（对齐参考图） */
export const linkActive = 'bg-sidebar-selected-bg font-medium text-sidebar-selected-fg'
/** 非激活态：侧边栏主文字色 + 选中背景色 40% hover 层（四风格自适应） */
export const linkIdle = 'text-sidebar-fg hover:bg-sidebar-selected-bg/40'
export const linkIcon = 'h-4 w-4 shrink-0'
