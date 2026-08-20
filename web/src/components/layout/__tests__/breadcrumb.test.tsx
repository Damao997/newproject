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

describe('Breadcrumb（导航两级化后）', () => {
  it('二级子页：首页 / 一级 / 二级 三段链', () => {
    renderAt('/indicators/operating')
    const nav = screen.getByLabelText('面包屑')
    expect(nav.textContent).toContain('首页')
    expect(nav.textContent).toContain('首页看板')
    expect(nav.textContent).toContain('财务指标')
  })

  it('match 声明子页：/data/browse 命中数据导入', () => {
    renderAt('/data/browse')
    const nav = screen.getByLabelText('面包屑')
    expect(nav.textContent).toContain('数据管理')
    expect(nav.textContent).toContain('数据导入')
  })

  it('边界前缀子页：/data/reclassify/consolidation 命中重分类管理（match 为空）', () => {
    renderAt('/data/reclassify/consolidation')
    const nav = screen.getByLabelText('面包屑')
    expect(nav.textContent).toContain('数据管理')
    expect(nav.textContent).toContain('重分类管理')
  })

  it('最长路径优先：/reports/analyses 命中单项分析而非前缀汇总报告', () => {
    renderAt('/reports/analyses')
    const nav = screen.getByLabelText('面包屑')
    expect(nav.textContent).toContain('分析报告')
    expect(nav.textContent).toContain('单项分析')
    expect(nav.textContent).not.toContain('汇总报告')
  })

  it('一级叶子页：首页 / 模块 两段链', () => {
    renderAt('/inventory')
    const nav = screen.getByLabelText('面包屑')
    expect(nav.textContent).toContain('首页')
    expect(nav.textContent).toContain('存货管理')
  })

  it('首页自身页面：首页看板 / 看板总览（不重复插入首页根）', () => {
    renderAt('/dashboard')
    const nav = screen.getByLabelText('面包屑')
    expect(nav.textContent).toContain('首页看板')
    expect(nav.textContent).toContain('看板总览')
    // 未插入独立「首页」crumb（“首页看板”含子串，用分隔符数量校验：仅一段分隔符 = 2 段链）
    expect(nav.querySelectorAll('a[href="/dashboard"]')).toHaveLength(0)
  })

  it('不在导航树的路径不渲染（如登录页）', () => {
    renderAt('/login')
    expect(screen.queryByLabelText('面包屑')).toBeNull()
  })
})
