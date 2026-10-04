import { useEffect, useMemo } from 'react'
import { flushSync } from 'react-dom'
import { ConfigProvider, theme as antdTheme } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { APP_FONT, getAppTheme, getSurfaceColors } from '@/lib/app-theme'
import { applySidebarStyle, useThemeStore } from '@/stores/themeStore'

/** 根级主题同时覆盖表格、弹窗、表单与浮层，切换时保留组件状态。 */
export function AntdProvider({ children }: { children: React.ReactNode }) {
  const style = useThemeStore((s) => s.printing ? 'light' : s.sidebarStyle)
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return
    const sync = () => {
      document.documentElement.style.setProperty('--form-viewport-height', viewport.height + 'px')
      document.documentElement.style.setProperty('--form-viewport-top', viewport.offsetTop + 'px')
    }
    const onResize = () => {
      sync()
      const focused = document.activeElement
      if (window.innerWidth < 768 && focused instanceof HTMLElement && focused.closest('[data-dialog-body]')) {
        focused.scrollIntoView?.({ block: 'nearest' })
      }
    }
    sync()
    viewport.addEventListener('resize', onResize)
    viewport.addEventListener('scroll', sync)
    return () => {
      viewport.removeEventListener('resize', onResize)
      viewport.removeEventListener('scroll', sync)
      document.documentElement.style.removeProperty('--form-viewport-height')
      document.documentElement.style.removeProperty('--form-viewport-top')
    }
  }, [])
  useEffect(() => {
    const beforePrint = () => {
      applySidebarStyle('light')
      flushSync(() => useThemeStore.setState({ printing: true }))
    }
    const afterPrint = () => {
      applySidebarStyle(useThemeStore.getState().sidebarStyle)
      flushSync(() => useThemeStore.setState({ printing: false }))
    }
    window.addEventListener('beforeprint', beforePrint)
    window.addEventListener('afterprint', afterPrint)
    return () => {
      window.removeEventListener('beforeprint', beforePrint)
      window.removeEventListener('afterprint', afterPrint)
    }
  }, [])
  const theme = useMemo(() => {
    const p = getAppTheme(style)
    const surfaces = getSurfaceColors(p)
    return {
      algorithm: p.dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: {
        colorPrimary: p.primary, colorInfo: p.info, colorLink: p.primary, colorLinkHover: p.primaryHover,
        colorSuccess: p.success, colorWarning: p.warning, colorError: p.danger,
        colorText: p.text, colorTextSecondary: p.sub, colorTextTertiary: p.sub,
        colorBorder: p.controlBorder, colorBorderSecondary: p.subtle,
        colorBgLayout: p.page, colorBgContainer: p.surface, colorBgElevated: p.surface,
        colorFillAlter: p.muted, colorTextPlaceholder: p.sub,
        colorBgMask: 'rgba(0,0,0,0.45)', colorTextLightSolid: p.onPrimary,
        controlHeight: 36, controlHeightSM: 32, controlHeightLG: 44,
        borderRadius: p.controlRadius, borderRadiusLG: p.radius, borderRadiusSM: 8, fontSize: 14, fontFamily: APP_FONT,
      },
      components: {
        Table: { headerBg: surfaces['table-head'], headerColor: p.text, rowHoverBg: surfaces['table-hover'], rowSelectedBg: surfaces['table-selected'], rowSelectedHoverBg: surfaces['table-selected'], borderColor: p.subtle, cellFontSize: 13 },
        Card: { colorBorderSecondary: p.subtle },
        Button: { primaryShadow: 'none', defaultShadow: 'none' },
      },
    }
  }, [style])
  return <ConfigProvider locale={zhCN} theme={theme}>{children}</ConfigProvider>
}
