import { describe, it, expect } from 'vitest'
import { sanitizeRichText, richTextToPlainText, fixUploadFilename } from './sanitize'

describe('fixUploadFilename 上传文件名重解码', () => {
  it('latin1 误解码的中文名还原为 UTF-8', () => {
    const garbled = Buffer.from('经营数据范例.xlsx', 'utf8').toString('latin1')
    expect(fixUploadFilename(garbled)).toBe('经营数据范例.xlsx')
  })

  it('已是正确 UTF-8 的中文名不变', () => {
    expect(fixUploadFilename('年度预算.xlsx')).toBe('年度预算.xlsx')
  })

  it('纯 ASCII 文件名不变', () => {
    expect(fixUploadFilename('report-2026.xlsx')).toBe('report-2026.xlsx')
  })

  it('西文重音字符（非 UTF-8 字节序）不被误改', () => {
    expect(fixUploadFilename('résumé.xlsx')).toBe('résumé.xlsx')
  })
})

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
