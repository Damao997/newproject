/**
 * 构建产物（带 hash 的 chunk）加载失败时的恢复工具。
 *
 * 每次部署都会替换前端产物，chunk 文件名随内容 hash 变化。已打开旧页面的浏览器
 * 在切换路由时会动态 import 已失效的旧 chunk，报「Failed to fetch dynamically
 * imported module」。此时整页刷新即可拿到新的 index.html 与新产品，因此在应用入口
 * 与错误边界统一做「刷新恢复」。
 */

/** sessionStorage：记录最近一次因产物失效触发的自动刷新时间 */
const RELOAD_GUARD_KEY = 'app-chunk-reload-at'
/** 同一时间窗内至多自动刷新一次，避免产物真的缺失时无限刷新 */
const RELOAD_GUARD_WINDOW_MS = 10_000

/** 是否为动态导入（构建产物）加载失败 */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    message,
  )
}

/**
 * 注册 Vite 动态导入失败（`vite:preloadError`）→ 自动整页刷新一次。
 * 在应用入口调用一次；10 秒内的重复失败不再刷新，由用户手动重试。
 */
export function installChunkReloadGuard(): void {
  window.addEventListener('vite:preloadError', () => {
    try {
      const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0)
      if (Number.isFinite(last) && last > 0 && Date.now() - last < RELOAD_GUARD_WINDOW_MS) return
      sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()))
    } catch {
      // sessionStorage 不可用（隐私模式/被禁用）时退化为直接刷新
    }
    window.location.reload()
  })
}