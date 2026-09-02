import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Breadcrumb } from '../breadcrumb'

/** 在指定路径下渲染面包屑（MemoryRouter 提供 Router 上下文） */
function renderAt(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Breadcrumb />
    </MemoryRouter>
  )
}

describe('Breadcrumb（平铺一级菜单后）', () => {
  it('模块子路由：首页 / 财务指标 两段链（/indicators 前缀覆盖 /indicators/operating）', () => {
    renderAt('/indicators/operating')
    const nav = screen.getByLabelText('面包屑')
    expect(nav.textContent).toContain('首页')
    expect(nav.textContent).toContain('财务指标')
  })

  it('match 声明子页：/data/browse 命中数据导入', () => {
    renderAt('/data/browse')
    const nav = screen.getByLabelText('面包屑')
    expect(nav.textContent).toContain('首页')
    expect(nav.textContent).toContain('数据导入')
  })

  it('边界前缀子页：/data/reclassify/consolidation 命中重分类管理', () => {
    renderAt('/data/reclassify/consolidation')
    const nav = screen.getByLabelText('面包屑')
    expect(nav.textContent).toContain('首页')
    expect(nav.textContent).toContain('重分类管理')
  })

  it('前缀子页归并所属模块：/reports/analyses 显示分析报告（平铺后无二级「单项分析」）', () => {
    renderAt('/reports/analyses')
    const nav = screen.getByLabelText('面包屑')
    expect(nav.textContent).toContain('首页')
    expect(nav.textContent).toContain('分析报告')
  })

  it('最长路径优先：/dashboard/analysis/key-metrics 命中经营分析而非首页看板', () => {
    renderAt('/dashboard/analysis/key-metrics')
    const nav = screen.getByLabelText('面包屑')
    expect(nav.textContent).toContain('首页')
    expect(nav.textContent).toContain('经营分析')
    expect(nav.textContent).not.toContain('首页看板')
  })

  it('一级叶子页：首页 / 存货管理 两段链', () => {
    renderAt('/inventory')
    const nav = screen.getByLabelText('面包屑')
    expect(nav.textContent).toContain('首页')
    expect(nav.textContent).toContain('存货管理')
  })

  it('首页自身页面：仅「首页看板」单段（不重复插入首页根）', () => {
    renderAt('/dashboard')
    const nav = screen.getByLabelText('面包屑')
    expect(nav.textContent).toContain('首页看板')
    // 未插入独立「首页」crumb（无分隔符 = 单段链）
    expect(nav.textContent).not.toContain('/')
    expect(nav.querySelectorAll('a[href="/dashboard"]')).toHaveLength(0)
  })

  it('不在导航树的路径不渲染（如登录页）', () => {
    renderAt('/login')
    expect(screen.queryByLabelText('面包屑')).toBeNull()
  })
})
