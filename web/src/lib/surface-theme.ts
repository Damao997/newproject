import type themes from './app-themes.json'

/** 面层颜色由原始配方混合派生，CSS 与组件库共用。 */
export function mixThemeColor(a: string, b: string, amount: number) {
  const channel = (hex: string, offset: number) => parseInt(hex.slice(offset, offset + 2), 16)
  return '#' + [1, 3, 5].map((offset) => Math.round(channel(a, offset) * (1 - amount) + channel(b, offset) * amount).toString(16).padStart(2, '0')).join('')
}
export function getSurfaceColors(p: typeof themes.light) {
  return {
    'table-head': mixThemeColor(p.surface, p.primary, p.dark ? .12 : .045),
    'table-group': mixThemeColor(p.surface, p.primary, p.dark ? .16 : .075),
    'table-stripe': mixThemeColor(p.surface, p.text, p.dark ? .02 : .012),
    'table-hover': mixThemeColor(p.surface, p.primary, p.dark ? .14 : .055),
    'table-selected': mixThemeColor(p.surface, p.primary, p.dark ? .2 : .1),
    'surface-filter': mixThemeColor(p.surface, p.primary, p.dark ? .06 : .018),
  }
}
