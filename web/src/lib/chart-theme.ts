/**
 * 图表与第三方组件（canvas / antd）色值单一来源。
 *
 * ECharts 走 canvas 渲染、antd 的 theme.token 只接受字面色值，两者都不能直接吃 CSS 变量，
 * 因此这里以 hex 常量镜像 `globals.css` 的 `--chart-*` / 中性色令牌。修改颜色时两处必须同步。
 */
import type { SidebarStyle } from '@/stores/themeStore'

/**
 * 侧边栏风格色板 hex 镜像：与 globals.css 的 `:root[data-sidebar]` 预设一一对应。
 * 供 ECharts 序列主色、antd theme.token 与风格切换器色板使用；修改时两处必须同步。
 * primary/primaryHover = 交互主色（按钮/链接/焦点环）；chart1 = 图表专用提亮色
 * （白底图表可读，与交互主色解耦：靛蓝用淡紫 #BBA9F7，深色用亮蓝 #7A9BF2）。
 * 主页面恒白，无暗色提亮分支。
 */
export const SIDEBAR_PRESETS: Record<
  SidebarStyle,
  {
    label: string
    primary: string
    primaryHover: string
    chart1: string
  }
> = {
  light: {
    label: '浅色',
    primary: '#FF830F',
    primaryHover: '#FF9A3D',
    chart1: '#FF830F',
  },
  gradient: {
    label: '深紫',
    primary: '#472159',
    primaryHover: '#5B2E73',
    chart1: '#BBA9F7',
  },
  dark: {
    label: '深色',
    primary: '#1F2937',
    primaryHover: '#374151',
    chart1: '#7A9BF2',
  },
}

/** 按侧边栏风格返回图表序列色：首位替换为风格主色（chart1），其余 12 色保持和谐化多色不变 */
export function getChartSeries(style: SidebarStyle = 'light'): string[] {
  // 守卫：未知风格 key（旧版本持久化残留）回退默认浅色，避免下标访问 undefined 崩溃
  const preset = SIDEBAR_PRESETS[style] ?? SIDEBAR_PRESETS.light
  return [preset.chart1, ...CHART_SERIES.slice(1)]
}

/** 序列色：橙主导 + 和谐化多色（与 --chart-1 ~ --chart-13 一一对应；首位随风格切换，此处为默认浅色） */
export const CHART_SERIES = [
  '#FF830F', // --chart-1  品牌橙（浅色风格主色）
  '#199BCC', // --chart-2  青蓝
  '#10B981', // --chart-3  翠绿
  '#F59E0B', // --chart-4  琥珀
  '#8B6FD8', // --chart-5  柔紫
  '#9A8F85', // --chart-6  暖灰（同期基准）
  '#D9527A', // --chart-7  玫红
  '#2B93A6', // --chart-8  青
  '#6C9B3D', // --chart-9  橄榄
  '#CE5A2A', // --chart-10 赭
  '#9B62BE', // --chart-11 紫
  '#C0951E', // --chart-12 芥黄
  '#6B7F99', // --chart-13 蓝灰
]

/** 图表框架色（文字/坐标轴/网格/浮层），对应暖中性令牌 */
export const CHART_INK = {
  /** 主文字，对应 --foreground */
  text: '#1C1917',
  /** 次级文字，对应 --muted-foreground */
  sub: '#7C7069',
  /** 坐标轴刻度文字 */
  axis: '#A8A29A',
  /** 分割线，对应 --border */
  grid: '#E9E2DB',
  /** 卡片/浮层底色，对应 --card，也用作数据点描边 */
  surface: '#FFFFFF',
  /** 浮层底色，对应 --popover */
  tooltipBg: '#FFFFFF',
  /** 浮层边框，对应 --border */
  tooltipBorder: '#E9E2DB',
}

/**
 * 暗色图表框架色已移除：主页面恒白，ECharts 始终使用亮色框架。
 */

/** 图表框架色：主页面恒白，始终使用亮色框架 */
export function getChartInk() {
  return CHART_INK
}

/** 图表字体：与全局微软雅黑规范一致 */
export const CHART_FONT = "'Microsoft YaHei','微软雅黑',sans-serif"

/** tooltip 外观公共片段：各图表 spread 后仅补 formatter/trigger（ink 按显示模式传入） */
export const tooltipShell = (ink = CHART_INK) => ({
  backgroundColor: ink.tooltipBg,
  borderColor: ink.tooltipBorder,
  borderWidth: 1,
  padding: [12, 16] as [number, number],
  textStyle: { color: ink.text, fontSize: 13 },
  // 对齐 antd 浮层三层暖褐阴影（boxShadowSecondary），tooltip 与 antd 弹层质感统一
  shadowBlur: 12,
  shadowColor: 'rgba(28, 20, 12, 0.08)',
  shadowOffsetY: 4,
})

/** tooltip 数值片段：等宽数字，保证多行对齐 */
export const numSpan = (value: string) =>
  `<span style="font-weight:500;font-family:${CHART_FONT};font-variant-numeric:tabular-nums;font-size:13px">${value}</span>`

/** tooltip 标题片段 */
export const titleSpan = (title: string, ink = CHART_INK) =>
  `<div style="font-weight:600;margin-bottom:6px;color:${ink.text};font-size:14px">${title}</div>`

/** tooltip 标签片段（次级文字） */
export const labelSpan = (label: string, ink = CHART_INK) =>
  `<span style="color:${ink.sub};font-size:12px">${label}</span>`

/**
 * 语义色 hex 镜像：供只接受字面色值的第三方组件（antd theme.token）使用。
 * 与 `globals.css` 的同名令牌一一对应；主页面恒白，无暗色分支。
 * 注意：交互主色随侧边栏风格变化，请使用 SIDEBAR_PRESETS[style].primary，勿在此定义固定主色。
 */
export const THEME_HEX = {
  success: '#10B981',
  warning: '#F59E0B',
  destructive: '#EF4444',
  foreground: CHART_INK.text,
  mutedForeground: CHART_INK.sub,
  border: CHART_INK.grid,
  borderSubtle: '#F2ECE6',
  muted: '#F7F3EF',
  accent: '#FDF4EC',
}
