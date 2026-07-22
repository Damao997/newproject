import DOMPurify from 'dompurify'

/**
 * 前端展示前二次净化
 *
 * 用于富文本渲染组件，确保展示安全。
 * 即使后端已净化，前端仍需二次净化作为纵深防御。
 *
 * 白名单标签/属性对齐《安全与权限规范》§8.2。
 */
const ALLOWED_TAGS = [
  'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'a', 'img',
  'blockquote', 'pre', 'code',
  'div', 'span',
]

const ALLOWED_ATTR = [
  'href', 'target', 'rel',
  'src', 'alt', 'width', 'height',
  'class', 'style',
  'data-ai-suggested',
  'colspan', 'rowspan',
]

/**
 * 净化 HTML 字符串以安全展示。
 *
 * 移除 script / iframe / on* 事件属性 / javascript: 协议等危险内容。
 *
 * @param html 待净化的原始 HTML
 * @returns 净化后的安全 HTML
 */
export function sanitizeForDisplay(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
  })
}
