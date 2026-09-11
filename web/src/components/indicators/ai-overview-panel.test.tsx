import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { renderOverviewText } from '@/lib/overview-render'

/** renderOverviewText 纯函数单测：分节标题/表格/转义/空行 */

describe('renderOverviewText', () => {
  it('分节标题行渲染为加粗段落', () => {
    const html = renderToStaticMarkup(<>{renderOverviewText('一、整体指标趋势概览\n据指标表显示，收入增长。')}</>)
    expect(html).toContain('<p class="mt-1 font-semibold text-foreground">一、整体指标趋势概览</p>')
    expect(html).toContain('据指标表显示，收入增长。')
  })

  it('markdown 表格行渲染为表格（跳过分隔行，首行为表头样式）', () => {
    const text = '| 指标 | 本月 | 累计 |\n|---|---|---|\n| 毛利 | 27.1% | -19.9% |'
    const html = renderToStaticMarkup(<>{renderOverviewText(text)}</>)
    expect(html).toContain('<table')
    expect(html).toContain('27.1%')
    expect(html).toContain('-19.9%')
    // 分隔行被过滤
    expect(html).not.toContain('---')
    // 首行（表头）带背景
    expect(html).toContain('bg-muted/50')
  })

  it('HTML 特殊字符被转义（XSS 安全）', () => {
    const html = renderToStaticMarkup(<>{renderOverviewText('<script>alert(1)</script> 正常内容')}</>)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('正常内容')
  })

  it('空行与空白文本安全处理', () => {
    expect(renderToStaticMarkup(<>{renderOverviewText('')}</>)).toBe('')
    expect(renderToStaticMarkup(<>{renderOverviewText('\n\n')}</>)).toBe('')
  })
})
