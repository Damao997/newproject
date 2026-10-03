import { APP_THEMES, APP_FONT, getAppTheme } from './app-theme'
import type { SidebarStyle } from '@/stores/themeStore'

/** 保留调用方接口，所有字面色值统一来自全站配方。 */
export const SIDEBAR_PRESETS = Object.fromEntries(Object.entries(APP_THEMES).map(([key, p]) => [key, {
  label: p.label, primary: p.primary, primaryHover: p.primaryHover, chart1: p.series[0],
}])) as Record<SidebarStyle, { label: string; primary: string; primaryHover: string; chart1: string }>
export function getChartSeries(style?: SidebarStyle): string[] { return [...getAppTheme(style).series] }
export function getChartInk(style?: SidebarStyle) {
  const p = getAppTheme(style)
  return { text: p.text, sub: p.sub, axis: p.sub, grid: p.subtle, surface: p.surface, tooltipBg: p.surface, tooltipBorder: p.border }
}
export const CHART_FONT = APP_FONT
export const tooltipShell = (ink = getChartInk()) => ({
  backgroundColor: ink.tooltipBg, borderColor: ink.tooltipBorder, borderWidth: 1,
  padding: [12, 16] as [number, number], textStyle: { color: ink.text, fontSize: 13 },
  shadowBlur: 12, shadowColor: 'rgba(0,0,0,0.12)', shadowOffsetY: 4,
})
export const numSpan = (value: string) => `<span style="font-weight:500;font-family:${CHART_FONT};font-variant-numeric:tabular-nums;font-size:13px">${value}</span>`
export const titleSpan = (title: string, ink = getChartInk()) => `<div style="font-weight:600;margin-bottom:6px;color:${ink.text};font-size:14px">${title}</div>`
export const labelSpan = (label: string, ink = getChartInk()) => `<span style="color:${ink.sub};font-size:12px">${label}</span>`

/** 横向条形图共用圆润轨道，数值、浮层和钻取仍由原图表负责。 */
export function getHorizontalBarStyle(style?: SidebarStyle) {
  return { barWidth: 10, barMaxWidth: 12, showBackground: true, backgroundStyle: { color: getChartInk(style).grid, borderRadius: 6 } }
}
