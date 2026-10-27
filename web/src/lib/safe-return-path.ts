/**
 * 登录后回跳路径校验：只接受站内相对路径。
 * 拒绝协议/主机形式（http:、//host）、反斜杠绕过、控制字符与伪协议，允许查询与锚点。
 * 调用方仍需排除自身页面（如 /login）以避免循环跳转。
 */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return null
  if (!value.startsWith('/')) return null
  if (value.startsWith('//')) return null
  if (value.includes('\\')) return null
  // 控制字符可造成 URL 解析歧义（换行/制表符截断）
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return null
  }
  // 拒绝 /javascript:... 之类把伪协议塞进路径开头的形式
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(value)) return null
  return value
}
