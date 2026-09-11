import { describe, it, expect } from 'vitest'
import { sanitizeForDisplay } from '@/lib/sanitize'

describe('sanitizeForDisplay', () => {
  it('剥离 script 标签', () => {
    const result = sanitizeForDisplay('<p>正常</p><script>alert(1)</script>')
    expect(result).toContain('<p>正常</p>')
    expect(result).not.toContain('<script>')
    expect(result).not.toContain('alert(1)')
  })

  it('移除 on* 事件属性', () => {
    const result = sanitizeForDisplay('<img src="x" onerror="alert(1)" />')
    expect(result).not.toContain('onerror')
  })

  it('剥离 javascript: 协议链接', () => {
    const result = sanitizeForDisplay('<a href="javascript:alert(1)">点我</a>')
    expect(result).not.toContain('javascript:')
  })

  it('保留白名单表格标签与结构', () => {
    const html = '<table><thead><tr><th>列</th></tr></thead><tbody><tr><td>值</td></tr></tbody></table>'
    const result = sanitizeForDisplay(html)
    expect(result).toContain('<table>')
    expect(result).toContain('<td>值</td>')
  })

  it('保留 data-ai-suggested 属性', () => {
    const result = sanitizeForDisplay('<span data-ai-suggested="true">AI</span>')
    expect(result).toContain('data-ai-suggested')
  })
})
