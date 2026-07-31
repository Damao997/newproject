/**
 * 图表与第三方组件（canvas / antd）色值单一来源。
 *
 * ECharts 走 canvas 渲染、antd 的 theme.token 只接受字面色值，两者都不能直接吃 CSS 变量，
 * 因此这里以 hex 常量镜像 `globals.css` 的 `--chart-*` / 中性色令牌。修改颜色时两处必须同步。
 */

/** 序列色：橙主导 + 和谐化多色（与 --chart-1 ~ --chart-13 一一对应） */
export const CHART_SERIES = [
  '#F97316', // --chart-1  品牌橙
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

/** 图表字体：与全局微软雅黑规范一致 */
export const CHART_FONT = "'Microsoft YaHei','微软雅黑',sans-serif"

/** tooltip 外观公共片段：各图表 spread 后仅补 formatter/trigger */
export const tooltipShell = {
  backgroundColor: CHART_INK.tooltipBg,
  borderColor: CHART_INK.tooltipBorder,
  borderWidth: 1,
  padding: [12, 16] as [number, number],
  textStyle: { color: CHART_INK.text, fontSize: 13 },
}

/** tooltip 数值片段：等宽数字，保证多行对齐 */
export const numSpan = (value: string) =>
  `<span style="font-weight:500;font-family:${CHART_FONT};font-variant-numeric:tabular-nums;font-size:13px">${value}</span>`

/** tooltip 标题片段 */
export const titleSpan = (title: string) =>
  `<div style="font-weight:600;margin-bottom:6px;color:${CHART_INK.text};font-size:14px">${title}</div>`

/** tooltip 标签片段（次级文字） */
export const labelSpan = (label: string) =>
  `<span style="color:${CHART_INK.sub};font-size:12px">${label}</span>`

/**
 * 语义色 hex 镜像：供只接受字面色值的第三方组件（antd theme.token）使用。
 * 与 `globals.css` 的同名令牌一一对应。
 */
export const THEME_HEX = {
  primary: '#F97316',
  primaryHover: '#FB923C',
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
