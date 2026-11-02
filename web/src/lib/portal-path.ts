function normalizeBasePath(value: string | null | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw || raw === '/') return ''
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`
  return withLeadingSlash.replace(/\/+/g, '/').replace(/\/+$/, '')
}

/** 中台网关挂载前缀；普通根路径部署返回空字符串。 */
export function getBasePath(): string {
  if (typeof document === 'undefined') return ''
  return normalizeBasePath(document.querySelector<HTMLMetaElement>('meta[name="app-base-path"]')?.content)
}

/** API 基础路径支持构建期覆盖，未覆盖时跟随中台挂载前缀。 */
export function getApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  const basePath = getBasePath()
  return basePath ? `${basePath}/api/v1` : '/api/v1'
}

/** 将 Router 内部绝对路径转换为带中台前缀的真实浏览器路径。 */
export function withBasePath(path: string): string {
  if (!path.startsWith('/')) return path
  return `${getBasePath()}${path}`
}

/** public 目录静态资源路径。 */
export function assetPath(path: string): string {
  return `${getBasePath()}/${path.replace(/^\/+/, '')}`
}
