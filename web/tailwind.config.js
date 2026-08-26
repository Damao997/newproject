/** @type {import('tailwindcss').Config} */
export default {
  // 主页面恒白，无暗色 class 写入；保留 class 策略配置以防历史 dark: 变体意外触发
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        page: "hsl(var(--page))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          strong: "hsl(var(--success-strong))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          strong: "hsl(var(--warning-strong))",
        },
        info: "hsl(var(--info))",
        // 侧边栏三风格变量（随 html[data-sidebar] 切换）；--sidebar-bg 可为渐变字符串，由内联 style 承载
        sidebar: {
          bg: "hsl(var(--sidebar-bg))",
          fg: "hsl(var(--sidebar-fg))",
          icon: "hsl(var(--sidebar-icon))",
          "selected-bg": "hsl(var(--sidebar-selected-bg))",
          "selected-fg": "hsl(var(--sidebar-selected-fg))",
          "active-bar": "hsl(var(--sidebar-active-bar))",
          border: "hsl(var(--sidebar-border))",
          "brand-fg": "hsl(var(--sidebar-brand-fg))",
        },
        finance: {
          red: "#FF3B30",
          green: "#34C759",
        },
        // 图表序列色：与 src/lib/chart-theme.ts 的 CHART_SERIES 一一对应
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
          6: "hsl(var(--chart-6))",
          7: "hsl(var(--chart-7))",
          8: "hsl(var(--chart-8))",
          9: "hsl(var(--chart-9))",
          10: "hsl(var(--chart-10))",
          11: "hsl(var(--chart-11))",
          12: "hsl(var(--chart-12))",
          13: "hsl(var(--chart-13))",
        },
      },
      boxShadow: {
        // 暖调阴影：以褐黑替代纯黑，与品牌橙更协调
        sm: "0 1px 3px 0 rgb(28 20 12 / 0.05)",
        DEFAULT: "0 1px 3px 0 rgb(28 20 12 / 0.06), 0 1px 2px -1px rgb(28 20 12 / 0.06)",
        md: "0 4px 6px -1px rgb(28 20 12 / 0.08), 0 2px 4px -2px rgb(28 20 12 / 0.06)",
        lg: "0 12px 24px -8px rgb(28 20 12 / 0.12)",
        xl: "0 25px 50px -12px rgb(28 20 12 / 0.18)",
      },
      transitionTimingFunction: {
        brand: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        card: "var(--radius-card)",
      },
      fontFamily: {
        // 全局正文统一微软雅黑（非 Windows 环境回退 system-ui）
        sans: ['"Microsoft YaHei"', '"微软雅黑"', "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
        // 数字展示专用：微软雅黑 + tnum 等宽数字特性，保证表格数字对齐
        num: [
          ['"Microsoft YaHei"', '"微软雅黑"', "sans-serif"],
          { fontFeatureSettings: '"tnum"' },
        ],
      },
      fontSize: {
        // 语义字号：正文最小 12px 红线；micro 仅限装饰性后缀（单位标注/角标），caption 辅助信息，helper 小号正文/小按钮
        micro: ["10px", { lineHeight: "14px" }],
        caption: ["11px", { lineHeight: "16px" }],
        helper: ["12px", { lineHeight: "18px" }],
      },
      keyframes: {
        "accordion-down": {
          from: { height: 0 },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: 0 },
        },
        "fade-in": {
          from: { opacity: 0, transform: "translateY(10px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
        "fade-in-scale": {
          from: { opacity: 0, transform: "scale(0.95)" },
          to: { opacity: 1, transform: "scale(1)" },
        },
        "slide-in": {
          from: { opacity: 0, transform: "translateX(-10px)" },
          to: { opacity: 1, transform: "translateX(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.3s ease-out forwards",
        "fade-in-scale": "fade-in-scale 0.25s ease-out forwards",
        "slide-in": "slide-in 0.3s ease-out forwards",
        shimmer: "shimmer 1.5s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
