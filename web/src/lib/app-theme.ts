import themes from './app-themes.json'

/** 四套全站配方共享同一份色板，兼容原有持久化键。 */
export type AppStyle = keyof typeof themes
export const APP_THEMES = themes
export const APP_STYLE_KEYS = Object.keys(themes) as AppStyle[]
export const APP_FONT = "'Segoe UI','Microsoft YaHei','微软雅黑',system-ui,sans-serif"
export { getSurfaceColors, mixThemeColor } from './surface-theme'
export function normalizeStyle(value: unknown): AppStyle {
  return typeof value === 'string' && Object.hasOwn(themes, value) ? value as AppStyle : 'light'
}
export function getAppTheme(style?: AppStyle) {
  const current = style ?? (typeof document === 'undefined' ? 'light' : normalizeStyle(document.documentElement.dataset.sidebar))
  return themes[current] ?? themes.light
}
