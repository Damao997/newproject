/**
 * 统一规范化中台挂载路径。
 * 返回值不带末尾斜杠；根路径返回空字符串，便于安全拼接 URL。
 */
export function normalizeBasePath(value: string | undefined): string {
  const raw = String(value ?? '').trim()
  if (!raw || raw === '/') return ''
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`
  const normalized = withLeadingSlash.replace(/\/+/g, '/').replace(/\/+$/, '')
  if (normalized === '/' || normalized.includes('..')) return ''
  return normalized
}
