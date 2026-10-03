import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import LoginPage from '../index'
import { SIDEBAR_STYLE_OPTIONS, useThemeStore } from '@/stores/themeStore'
import { APP_THEMES } from '@/lib/app-theme'
import { THEME_BOOT_SCRIPT } from '@/lib/theme-css'
import { AntdProvider } from '@/components/ui/antd-provider'

// 覆盖可见品牌、输入保持、旧偏好恢复与打印回退，避免依赖已退休的双栏 CSS。
describe('登录与全站风格契约', () => {
  beforeEach(() => {
    localStorage.clear()
    useThemeStore.setState({ printing: false })
    useThemeStore.getState().setSidebarStyle('light')
  })
  it('切换四套风格保持品牌、已输入账号密码与免登录选择', () => {
    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText('账号'), { target: { value: 'preview' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'test-only' } })
    fireEvent.click(screen.getByLabelText('7 天内免登录'))
    for (const option of SIDEBAR_STYLE_OPTIONS) {
      act(() => useThemeStore.getState().setSidebarStyle(option.key))
      expect(document.documentElement.dataset.sidebar).toBe(option.key)
      expect(document.documentElement.classList.contains('dark')).toBe(option.key === 'dark')
      expect(screen.getByText('浙江壹品慧')).toBeInTheDocument()
      expect(screen.getByText('经营分析平台')).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: '登录' })).toBeInTheDocument()
      expect(screen.getByLabelText('账号')).toHaveValue('preview')
      expect(screen.getByLabelText('密码')).toHaveValue('test-only')
      expect(screen.getByLabelText('7 天内免登录')).toBeChecked()
    }
    fireEvent.click(screen.getByRole('button', { name: '显示密码' }))
    expect(screen.getByLabelText('密码')).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: '隐藏密码' })).toBeInTheDocument()
  })
  it('旧持久化键恢复深色，非法偏好与损坏 JSON 安全回退', async () => {
    for (const key of ['dark', 'bogus-theme']) {
      localStorage.setItem('sidebar-style-storage', JSON.stringify({ state: { sidebarStyle: key, printing: true }, version: 0 }))
      await act(() => useThemeStore.persist.rehydrate())
      expect(useThemeStore.getState().sidebarStyle).toBe(key === 'dark' ? 'dark' : 'light')
      expect(useThemeStore.getState().printing).toBe(false)
      expect(document.documentElement.dataset.sidebar).toBe(key === 'dark' ? 'dark' : 'light')
    }
    for (const raw of ['{broken', JSON.stringify({ state: { sidebarStyle: 'illegal' } })]) {
      localStorage.setItem('sidebar-style-storage', raw)
      window.eval(THEME_BOOT_SCRIPT)
      expect(document.documentElement.dataset.sidebar).toBe('light')
      expect(document.documentElement.classList.contains('dark')).toBe(false)
    }
  })
  it('深色打印使用浅色且恢复原偏好，不把打印状态持久化', () => {
    act(() => useThemeStore.getState().setSidebarStyle('dark'))
    render(<AntdProvider><p>报告正文</p></AntdProvider>)
    act(() => window.dispatchEvent(new Event('beforeprint')))
    expect(document.documentElement.dataset.sidebar).toBe('light')
    expect(useThemeStore.getState().sidebarStyle).toBe('dark')
    expect(useThemeStore.getState().printing).toBe(true)
    expect(JSON.parse(localStorage.getItem('sidebar-style-storage')!).state).toEqual({ sidebarStyle: 'dark' })
    act(() => window.dispatchEvent(new Event('afterprint')))
    expect(document.documentElement.dataset.sidebar).toBe('dark')
    expect(useThemeStore.getState().printing).toBe(false)
  })
  it('所有主题的正文、次要文字、主按钮与控件边界满足对比度基线', () => {
    const luminance = (hex: string) => {
      const parts = hex.slice(1).match(/../g)!.map((part) => parseInt(part, 16) / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4)
      return parts[0] * .2126 + parts[1] * .7152 + parts[2] * .0722
    }
    const contrast = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05) }
    for (const palette of Object.values(APP_THEMES)) {
      expect(contrast(palette.text, palette.surface), `${palette.label} 正文`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(palette.sub, palette.surface), `${palette.label} 次要文字`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(palette.onPrimary, palette.primary), `${palette.label} 主按钮`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(palette.controlBorder, palette.surface), `${palette.label} 控件边界`).toBeGreaterThanOrEqual(3)
      for (const [index, surface] of palette.metricSurfaces.entries()) {
        for (const [name, color] of Object.entries({ 正文: palette.text, 次要文字: palette.sub, 上涨: palette.up, 下跌: palette.down, 达成: palette.success, 未达成: palette.warning })) {
          expect(contrast(color, surface), `${palette.label} 指标卡 ${index + 1} ${name}`).toBeGreaterThanOrEqual(4.5)
        }
        expect(contrast(palette.metricInks[index], surface), `${palette.label} 指标曲线 ${index + 1}`).toBeGreaterThanOrEqual(3)
      }
    }
  })
})
