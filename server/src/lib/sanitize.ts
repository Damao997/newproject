import sanitizeHtml from 'sanitize-html'

/**
 * 富文本净化（存储前白名单净化，见 docs/plans/数据模型规范.md §6.3）。
 * 允许常见排版标签与表格/链接/图片，移除 script/iframe/on* 事件属性与 javascript: 协议。
 * 展示端仍需 DOMPurify 二次净化（前后双重净化）。
 */

const ALLOWED_TAGS = [
  'p', 'br', 'hr',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'mark', 'sub', 'sup',
  'blockquote', 'code', 'pre',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'a', 'img',
  'span', 'div',
]

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  th: ['colspan', 'rowspan', 'align'],
  td: ['colspan', 'rowspan', 'align'],
  col: ['span', 'width'],
  colgroup: ['span', 'width'],
  '*': ['data-ai-suggested'],
}

export function sanitizeRichText(input: unknown): string {
  const raw = typeof input === 'string' ? input : ''
  return sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ['http', 'https', 'mailto', 'data'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    // 链接强制 noopener，避免 reverse tabnabbing
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }),
    },
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript'],
  })
}

/** 提取富文本的纯文本（用于导出与摘要），去除所有标签 */
export function richTextToPlainText(input: unknown): string {
  const raw = typeof input === 'string' ? input : ''
  const cleaned = sanitizeHtml(raw, { allowedTags: [], allowedAttributes: {} })
  return cleaned
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** multer/busboy 按 latin1 解码 multipart 文件名，中文需重解码为 UTF-8；已含非 latin1 字符则视为已正确解码 */
export function fixUploadFilename(name: string): string {
  if (/[^\u0000-\u00ff]/.test(name)) return name
  const decoded = Buffer.from(name, 'latin1').toString('utf8')
  return decoded.includes('\ufffd') ? name : decoded
}
