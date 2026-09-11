import { useMemo } from 'react'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { SIDEBAR_PRESETS, THEME_HEX } from '@/lib/chart-theme'
import { useThemeStore } from '@/stores/themeStore'

/**
 * antd 全局主题 Provider（App 根部挂载一次）。
 *
 * 主题配方上提自 pro-table-inner.tsx 的局部 ConfigProvider（已在线上验证）：
 * - 交互主色（colorPrimary/colorInfo/colorLink）跟随侧边栏风格（SIDEBAR_PRESETS hex 镜像，
 *   antd token 只接受字面色值，不能直接吃 CSS 变量）；
 * - 语义色走 THEME_HEX 镜像（与 globals.css 的同名令牌一一对应）；页面浅灰 #f0f2f5、组件恒白，恒用亮色算法。
 * 主题对象随 sidebarStyle 变化重建（ConfigProvider 内部按 token 引用重算样式）。
 */
export function AntdProvider({ children }: { children: React.ReactNode }) {
  const sidebarStyle = useThemeStore((s) => s.sidebarStyle)
  const brand = SIDEBAR_PRESETS[sidebarStyle] ?? SIDEBAR_PRESETS.light

  const theme = useMemo(
    () => ({
      token: {
        colorPrimary: brand.primary,
        colorInfo: brand.primary,
        colorLink: brand.primary,
        colorLinkHover: brand.primaryHover,
        colorSuccess: THEME_HEX.success,
        colorWarning: THEME_HEX.warning,
        colorError: THEME_HEX.destructive,
        colorText: THEME_HEX.foreground,
        colorTextSecondary: THEME_HEX.mutedForeground,
        colorBorder: THEME_HEX.border,
        colorBorderSecondary: THEME_HEX.borderSubtle,
        // 控件高度体系对齐项目规范：middle=36（FilterBar h-9 筛选控件标准）/ small=32（h-8 紧凑按钮与输入）/ large=44（h-11）
        controlHeight: 36,
        controlHeightSM: 32,
        controlHeightLG: 44,
        borderRadius: 8,
        fontSize: 13,
        fontFamily: "'Microsoft YaHei', '微软雅黑', system-ui, sans-serif",
        // 遮罩 antd 标准黑 45%（B 端规范，与 antd Modal 默认一致）
        colorBgMask: 'rgba(0, 0, 0, 0.45)',
        // 布局底色浅灰（antd colorBgLayout，与 globals.css --page #f0f2f5 一致），供内部使用该 token 的组件统一
        colorBgLayout: '#f0f2f5',
      },
      components: {
        Table: {
          // antd Table 标准中性配色：表头/悬停 #fafafa（colorFillQuaternary）、边框 #f0f0f0（colorSplit）
          headerBg: '#fafafa',
          headerColor: THEME_HEX.foreground,
          rowHoverBg: '#fafafa',
          borderColor: '#f0f0f0',
        },
      },
    }),
    [brand],
  )

  return (
    <ConfigProvider locale={zhCN} theme={theme}>
      {children}
    </ConfigProvider>
  )
}
