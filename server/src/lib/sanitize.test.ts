import { describe, it, expect } from 'vitest'
import { sanitizeRichText, richTextToPlainText } from './sanitize'

describe('sanitize 富文本净化', () => {
  it('剥离 script/iframe/on* 事件属性', () => {
    const dirty = '<p onclick="evil()">正文</p><script>alert(1)</script><iframe src="x"></iframe>'
    const clean = sanitizeRichText(dirty)
    expect(clean).not.toContain('<script')
    expect(clean).not.toContain('<iframe')
    expect(clean).not.toContain('onclick')
    expect(clean).toContain('正文')
  })

  it('阻断 javascript: 协议链接，保留 http(s)', () => {
    const dirty = '<a href="javascript:alert(1)">恶意</a><a href="https://example.com">正常</a>'
    const clean = sanitizeRichText(dirty)
    expect(clean).not.toContain('javascript:')
    expect(clean).toContain('https://example.com')
  })

  it('保留排版标签与表格', () => {
    const dirty = '<h2>标题</h2><ul><li>项</li></ul><table><tr><td>格</td></tr></table>'
    const clean = sanitizeRichText(dirty)
    expect(clean).toContain('<h2>')
    expect(clean).toContain('<li>')
    expect(clean).toContain('<td>')
  })

  it('保留 data-ai-suggested 标识', () => {
    const clean = sanitizeRichText('<div data-ai-suggested="true"><p>AI 内容</p></div>')
    expect(clean).toContain('data-ai-suggested')
  })

  it('非字符串输入返回空串', () => {
    expect(sanitizeRichText(undefined)).toBe('')
    expect(sanitizeRichText(null)).toBe('')
    expect(sanitizeRichText(123)).toBe('')
  })

  it('richTextToPlainText 去除标签并压缩空白', () => {
    const html = '<p>第一段</p><p>第二段</p><script>x</script>'
    const text = richTextToPlainText(html)
    expect(text).toContain('第一段')
    expect(text).toContain('第二段')
    expect(text).not.toContain('<')
    expect(text).not.toContain('x')
  })
})
