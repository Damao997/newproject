import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import LoginPage from '../index'
import { SIDEBAR_STYLE_OPTIONS, useThemeStore } from '@/stores/themeStore'

/**
 * 登录页品牌区 × 主题色联动测试
 *
 * 品牌区（.login-side）颜色由 html[data-sidebar] 驱动的 --login-brand-* CSS 变量决定；
 * jsdom 无法计算 CSS 级联，故分三层验证：
 * A. 运行时：themeStore 正确写 data-sidebar（登录页 CSS 的唯一驱动源）；
 * B. 源码契约：globals.css 中每个主题都有登录品牌色板覆盖块（防止新增主题漏配/旧变量回归）；
 * C. 渲染：品牌标识（文案/logo）在任意主题下保持不变（辨识度不受主题影响）。
 */

const css = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf-8')

/**
 * 提取指定主题的登录品牌色板覆盖块内容。
 * light 为默认主题：色板直接定义在基础 .login-shell 块中（无 data-sidebar='light' 覆盖块）；
 * 其余主题各有独立的 :root[data-sidebar='<key>'] .login-shell 覆盖块。
 */
function loginBrandBlock(key: string): string {
  const match =
    key === 'light'
      ? css.match(/\.login-shell \{([^}]*--login-brand-g1[^}]*)\}/)
      : css.match(new RegExp(`:root\\[data-sidebar='${key}'\\] \\.login-shell \\{([^}]*)\\}`))
  expect(
    match,
    key === 'light'
      ? 'globals.css 基础 .login-shell 块缺少 --login-brand-* 默认色板'
      : `globals.css 缺少 :root[data-sidebar='${key}'] .login-shell 覆盖块`,
  ).toBeTruthy()
  return match![1]
}

describe('登录页品牌区主题联动', () => {
  beforeEach(() => {
    localStorage.clear()
    // 归位到默认主题，避免用例间状态串扰
    useThemeStore.getState().setSidebarStyle('light')
  })

  it('A1. setSidebarStyle 对全部合法主题写入 html[data-sidebar]（登录页 CSS 驱动源）', () => {
    for (const opt of SIDEBAR_STYLE_OPTIONS) {
      useThemeStore.getState().setSidebarStyle(opt.key)
      expect(document.documentElement.getAttribute('data-sidebar')).toBe(opt.key)
    }
  })

  it('A2. 持久化恢复遇非法风格值时归一化回退默认 light（merge 校验）', async () => {
    localStorage.setItem(
      'sidebar-style-storage',
      JSON.stringify({ state: { sidebarStyle: 'bogus-theme' }, version: 0 }),
    )
    await useThemeStore.persist.rehydrate()
    expect(useThemeStore.getState().sidebarStyle).toBe('light')
    expect(document.documentElement.getAttribute('data-sidebar')).toBe('light')
  })

  it('B1. globals.css 为每个主题注册了登录品牌色板（渐变 + 文字 + 强调色齐全）', () => {
    for (const opt of SIDEBAR_STYLE_OPTIONS) {
      const block = loginBrandBlock(opt.key)
      expect(block).toContain('--login-brand-g1')
      expect(block).toContain('--login-brand-g2')
      expect(block).toContain('--login-brand-g3')
      expect(block).toContain('--login-brand-text')
      expect(block).toContain('--login-brand-500')
    }
  })

  it('B2. 品牌渐变/按钮渐变涉及的 6 个颜色变量均已 @property 注册（渐变平滑插值的前提）', () => {
    for (const name of ['--login-brand-g1', '--login-brand-g2', '--login-brand-g3', '--login-brand-400', '--login-brand-500', '--login-brand-600']) {
      expect(css).toContain(`@property ${name}`)
    }
  })

  it('B3. 旧硬编码 --brand-orange-* 色板已全部移除（防回归）', () => {
    expect(css).not.toContain('--brand-orange-')
  })

  it('C1. 品牌标识（文案/logo）在主题切换前后保持不变（辨识度不受主题影响）', () => {
    const { container, unmount } = render(
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>,
    )

    const assertBrandIntact = () => {
      const side = container.querySelector('.login-side')
      expect(side).toBeTruthy()
      // 粉彩淡雅版：图片 logo（alt 品牌名）+ 平台全称文案
      const logo = side!.querySelector('.login-brand-logo') as HTMLImageElement | null
      expect(logo).toBeTruthy()
      expect(logo!.getAttribute('alt')).toBe('浙江壹品慧')
      expect(side!.querySelector('.login-brand-text')!.textContent).toBe('浙江壹品慧经营分析平台')
    }

    assertBrandIntact()
    for (const opt of SIDEBAR_STYLE_OPTIONS) {
      useThemeStore.getState().setSidebarStyle(opt.key)
      assertBrandIntact()
    }
    unmount()
  })
})
