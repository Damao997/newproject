/**
 * 内部生产静态托管使用根路径部署：SPA 深层路由刷新时，index.html 中的
 * 相对资源必须通过 <base href="/"> 固定解析到站点根，否则会被解析成
 * /data/assets/... 等错误路径并导致 React 无法启动。
 *
 * 中台构建不调用本模块；portal-web 会按 /<slug>/ 注入前缀，二者互不影响。
 */

export const ROOT_BASE_TAG = '<base href="/">'

const BASE_TAG_RE = /<base\b[^>]*\bhref\s*=\s*["'][^"']*["'][^>]*>/i
const ROOT_BASE_RE = /<base\b[^>]*\bhref\s*=\s*["']\/["'][^>]*>/i
const HEAD_RE = /<head\b[^>]*>/i

export function ensureRootBaseHref(html) {
  if (BASE_TAG_RE.test(html)) return html.replace(BASE_TAG_RE, ROOT_BASE_TAG)
  if (!HEAD_RE.test(html)) throw new Error('未找到 <head> 标签，无法注入 <base href="/">')
  return html.replace(HEAD_RE, (head) => `${head}\n    ${ROOT_BASE_TAG}`)
}

export function hasRootBaseHref(html) {
  return ROOT_BASE_RE.test(html)
}
