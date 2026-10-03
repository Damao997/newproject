import themes from './app-themes.json'
import { getSurfaceColors, mixThemeColor as mix } from './surface-theme'
type AppStyle = keyof typeof themes

function rgb(hex: string) {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
}
/** 生成 Tailwind 所需 HSL 三元组；网页、图表和 Ant Design 共用原始配方。 */
export function toHsl(hex: string) {
  const [r, g, b] = rgb(hex)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min
  const lightness = (max + min) / 2
  let hue = 0, saturation = 0
  if (delta) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1))
    hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
    hue = (hue * 60 + 360) % 360
  }
  return `${hue.toFixed(2)} ${(saturation * 100).toFixed(2)}% ${(lightness * 100).toFixed(2)}%`
}
function paletteCss(p: typeof themes.light) {
  const colors: Record<string, string> = {
    ...getSurfaceColors(p),
    background: p.surface, foreground: p.text, card: p.surface, 'card-foreground': p.text,
    popover: p.surface, 'popover-foreground': p.text, page: p.page,
    primary: p.primary, 'primary-foreground': p.onPrimary, ring: p.primary,
    secondary: p.accent, 'secondary-foreground': p.primary, accent: p.accent, 'accent-foreground': p.primary,
    muted: p.muted, 'muted-foreground': p.sub, border: p.border, input: p.controlBorder, 'border-subtle': p.subtle,
    destructive: p.danger, 'destructive-foreground': p.dark ? p.page : '#FFFFFF', success: p.success, 'success-strong': p.success,
    warning: p.warning, 'warning-strong': p.warning, info: p.info, 'finance-red': p.up, 'finance-green': p.down,
    brand: p.brand, 'sidebar-bg': p.sidebar, 'sidebar-fg': p.sidebarText, 'sidebar-icon': p.sidebarMuted,
    'sidebar-selected-bg': p.sidebarSelected, 'sidebar-selected-fg': p.sidebarSelectedText,
    'sidebar-active-bar': p.brand, 'sidebar-border': p.sidebarBorder, 'sidebar-brand-fg': p.sidebarSelectedText,
    'sidebar-scrollbar': p.sidebarMuted, 'sidebar-scrollbar-hover': p.sidebarText,
  }
  p.series.forEach((value, i) => { colors[`chart-${i + 1}`] = value })
  p.metricSurfaces.forEach((value, i) => { colors[`metric-surface-${i + 1}`] = value })
  p.metricInks.forEach((value, i) => { colors[`metric-ink-${i + 1}`] = value })
  // 扩展色阶从全站配方派生，旧图表与状态组件无须另建色板。
  for (const [name, color] of Object.entries({ success: p.success, warning: p.warning, destructive: p.danger, info: p.info, neutral: p.sub })) {
    for (const [level, amount] of [[50, .07], [100, .14], [300, .55], [500, 1], [700, 1], [900, 1]] as const) colors[`${name}-${level}`] = mix(p.surface, color, amount)
  }
  for (let i = 1; i <= 13; i++) colors[`blue-${i}`] = mix(p.surface, p.primary, Math.min(1, (i - 1) / 7))
  for (const [i, amount] of [[50, .06], [100, .12], [200, .24], [300, .38], [400, .7], [500, 1], [600, 1], [700, 1], [800, 1], [900, 1]] as const) colors[`orange-${i}`] = mix(p.surface, p.brand, amount)
  for (let i = 1; i <= 10; i++) colors[`ink-${i}`] = mix(p.surface, p.text, (i - 1) / 9)
  for (let i = 1; i <= 12; i++) colors[`cool-${i}`] = mix(p.surface, p.text, (i - 1) / 11)
  return Object.entries(colors).map(([key, value]) => `--${key}:${toHsl(value)};`).join('') + `color-scheme:${p.dark ? 'dark' : 'light'};--radius:${p.controlRadius}px;--radius-card:${p.radius}px;--font-heading:'Segoe UI','Microsoft YaHei','微软雅黑',sans-serif;--antd-radius-sm:8px;--antd-radius-md:${p.controlRadius}px;--antd-radius-lg:${p.radius}px;--antd-shadow-1:${p.dark ? 'none' : '0 4px 20px rgb(44 60 95 / .035)'};--antd-shadow-2:0 12px 36px rgb(0 0 0 / ${p.dark ? '.32' : '.1'});--antd-shadow-3:0 18px 54px rgb(0 0 0 / .16);--scrollbar-track:transparent;--scrollbar-thumb:${p.border};--scrollbar-thumb-hover:${p.sub};--scrollbar-thumb-active:${p.text};`
}
/** Vite 在开发和构建时注入同一份首屏主题，恢复深色时不会先闪白。 */
export function buildThemeCss() {
  return (Object.keys(themes) as AppStyle[]).map((style) => `${style === 'light' ? ':root,' : ''}:root[data-sidebar='${style}']{${paletteCss(themes[style])}}`).join('\n')
}
export const THEME_BOOT_SCRIPT = `(()=>{let style='light';try{const saved=JSON.parse(localStorage.getItem('sidebar-style-storage')||'null');const auth=JSON.parse(localStorage.getItem('auth-storage')||'null');const prefs=auth?.state?.user?.id?JSON.parse(localStorage.getItem('personal-preferences:'+auth.state.user.id)||'null'):null;const key=prefs?.preferences?.theme??saved?.state?.sidebarStyle;if(['light','gradient','dark','antd'].includes(key))style=key}catch{}document.documentElement.dataset.sidebar=style;document.documentElement.classList.toggle('dark',style==='dark')})()`
