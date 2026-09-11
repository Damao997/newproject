# 页面风格变更规划 — iOS 毛玻璃风格技术落地方案

> ⚠️ **本文档已合并到 `UI设计规范.md` v1.0，AI Agent 请 Read `UI设计规范.md` 而非本文档。** 本文档保留供历史参考。

> 架构师：高见远 ｜ 输入：产品经理许清楚《iOS 毛玻璃风格 UI 设计规范》
> 技术栈：Vite 5 + React 18 + TypeScript + Ant Design 5 + @ant-design/pro-components + Tailwind CSS 3 + Zustand + ECharts + echarts-for-react
> 范围：P0 亮色全量落地，P1 暗色主题预留（CSS 变量强制预留，保证 P1 平滑接入）

---

## 一、技术实现总览

### 1.1 四层架构（自底向上）

```
┌──────────────────────────────────────────────────────────────────┐
│ Layer 4  业务组件封装层   web/src/components/glass/*              │
│   GlassCard / GlassTable / GlassNav / GlassModal / GlassDrawer   │
│   GlassTooltip / SegmentedControl / StatusCapsule                │
├──────────────────────────────────────────────────────────────────┤
│ Layer 3  Tailwind config 层   web/tailwind.config.ts + glass.css │
│   darkMode:'class' · colors→var(--color-*) · backdropBlur 扩展  │
│   自定义 borderRadius · @layer utilities 注入 .glass-*           │
├──────────────────────────────────────────────────────────────────┤
│ Layer 2  AntD ConfigProvider token 层   web/src/theme/*.ts       │
│   lightTheme.ts / darkTheme.ts · 全局 token + 组件 token override │
│   动态切换: themeStore → <ConfigProvider theme={current}>         │
├──────────────────────────────────────────────────────────────────┤
│ Layer 1  CSS 变量层（唯一真相源）   web/src/theme/variables.css   │
│   :root (亮) / .dark (暗) · 色板/渐变/文字/边框/阴影/圆角/模糊   │
└──────────────────────────────────────────────────────────────────┘
```

数据流方向：`tokens.ts 常量` → 同时生成 `variables.css`、`lightTheme.ts`、`echartsLightTheme.ts`；运行时切换由 `classList` + `ConfigProvider` + `echarts.setOption` 三处响应。

### 1.2 三层主题一致性策略（关键）

**问题**：CSS 变量是 DOM 运行时值；AntD token 是 JS 对象、ECharts theme 是 JSON，定义时无法 `var()` 引用。且 AntD 内部需对主色做 lighten/darken/alpha 色彩运算，必须拿到真实 hex。

**解法 —— "常量单源 + 双向同步"**：

1. **色板常量单源**：`web/src/theme/tokens.ts` 用 TS `as const` 定义全部色值（`PALETTE`、`GLASS`、`TEXT`、`BORDER`、`SHADOW`、`RADIUS`、`BLUR`、`CHART_COLORS`），及对应 `dark` 变体。JS 侧唯一来源。
2. **CSS 变量由常量对齐**：`variables.css` 的 `:root` / `.dark` 值与 `tokens.ts` 一一对应（P0 人工保持一致；P1 增 `tokens.spec.ts` 断言防漂移）。运行时 Tailwind utility / glass.css / inline-style 统一 `var(--color-*)`。
3. **AntD token 引用常量**：`lightTheme.ts` 直接 `import { PALETTE } from './tokens'`，hex 一致，AntD 色彩运算可用。
4. **ECharts theme 引用常量**：`echartsLightTheme.ts` 同样 `import { CHART_COLORS, TEXT } from './tokens'`。
5. **切换一致性**：亮→暗仅需三步——① `documentElement.classList.toggle('dark')`（CSS 变量整体翻转，Tailwind/glass.css/inline 自动响应）；② `ConfigProvider` 换 `darkTheme`；③ ECharts 实例 `setOption(merge)` 重绘。三者读取同一套 `tokens.dark`，天然一致。

> 一致性保证：因 `tokens.ts` 是 JS 单源，CSS 变量、AntD token、ECharts theme 三者色值同源；运行时切换只翻 `classList` + 换 token 对象 + 重绘图表，无色值硬编码散落风险。

---

## 二、CSS 变量层设计

### 2.1 亮色变量定义清单（P0，基于产品经理色板）

| 分类 | CSS 变量 | 值 | 用途 |
|---|---|---|---|
| 主色 | `--color-primary` | `#007AFF` | iOS 蓝，交互主色 |
| 状态-成功/涨 | `--color-success` | `#34C759` | iOS 绿，正向 |
| 状态-错误/跌 | `--color-error` | `#FF3B30` | iOS 红，负向 |
| 状态-警告 | `--color-warning` | `#FF9500` | iOS 橙 |
| 状态-信息 | `--color-info` | `#007AFF` | 同主色 |
| 辅助色 | `--color-purple` | `#5856D6` | 图表 C5 |
| 辅助色 | `--color-pink` | `#FF2D92` | 图表 C6 |
| 辅助色 | `--color-teal` | `#30B0C7` | 图表 C7 |
| 辅助色 | `--color-yellow` | `#FFCC00` | 图表 C8 |
| 辅助色 | `--color-magenta` | `#AF52DE` | 图表 C9 |
| 辅助色 | `--color-cyan` | `#64D2FF` | 图表 C10 |
| 中性灰 | `--color-gray` | `#8E8E93` | 辅助文字 |
| 背景渐变 | `--bg-gradient` | `linear-gradient(135deg,#E3F0FF 0%,#EDE7FF 40%,#FFE9F3 75%,#E0F7F4 100%)` | 全屏底 |
| 毛玻璃底 | `--glass-bg` | `rgba(255,255,255,0.65)` | 卡片/导航壳 |
| 内容层底 | `--content-bg` | `rgba(255,255,255,0.9)` | 内容容器 |
| 表格芯底 | `--table-core-bg` | `rgba(255,255,255,0.92)` | 表格近白芯 |
| 表头底 | `--table-header-bg` | `rgba(0,122,255,0.06)` | 淡蓝表头 |
| 行-奇 | `--table-row-odd` | `rgba(255,255,255,0.6)` | 斑马纹奇行 |
| 行-偶 | `--table-row-even` | `rgba(255,255,255,0.85)` | 斑马纹偶行 |
| 行-Hover | `--table-row-hover` | `rgba(0,122,255,0.08)` | 行悬停 |
| 行-选中 | `--table-row-selected` | `rgba(0,122,255,0.12)` | 行选中 |
| 主文字 | `--text-primary` | `#1C1C1E` | 标题/正文 |
| 次要文字 | `--text-secondary` | `#3A3A3C` | 坐标轴/说明 |
| 辅助文字 | `--text-tertiary` | `#8E8E93` | 占位/弱化 |
| 禁用文字 | `--text-disabled` | `#C7C7CC` | 禁用态 |
| 边框 | `--border-color` | `rgba(0,0,0,0.06)` | 通用边框 |
| 毛玻璃边框 | `--glass-border` | `rgba(255,255,255,0.5)` | 玻璃高光边 |
| 网格线 | `--grid-line` | `rgba(60,60,67,0.08)` | ECharts 网格 |
| 阴影-卡 | `--shadow-card` | `0 2px 12px rgba(0,0,0,0.06)` | 卡片 |
| 阴影-Hover | `--shadow-hover` | `0 4px 20px rgba(0,0,0,0.1)` | 悬停抬升 |
| 阴影-弹窗 | `--shadow-modal` | `0 12px 48px rgba(0,0,0,0.16)` | 弹窗 |
| 遮罩 | `--mask-bg` | `rgba(0,0,0,0.25)` | Modal/Drawer 遮罩 |
| 圆角-卡 | `--radius-card` | `20px` | 卡片 |
| 圆角-按钮 | `--radius-button` | `12px` | 按钮 |
| 圆角-输入 | `--radius-input` | `10px` | 输入框 |
| 圆角-Tag | `--radius-tag` | `8px` | 标签 |
| 圆角-胶囊 | `--radius-capsule` | `999px` | 灵动岛/分段 |
| 模糊-卡 | `--blur-card` | `24px` | 卡片/导航 |
| 模糊-弹窗 | `--blur-modal` | `30px` | Modal/Drawer |
| 模糊-Tooltip | `--blur-tooltip` | `16px` | ECharts Tooltip |
| 模糊-遮罩 | `--blur-mask` | `4px` | 遮罩轻微模糊 |

### 2.2 暗色变量预留（P1 方向性定义）

| 变量 | 暗色值（方向） |
|---|---|
| `--bg-gradient` | `linear-gradient(135deg,#1C1C1E 0%,#2C2C2E 40%,#1A1A2E 75%,#242426 100%)` |
| `--glass-bg` | `rgba(40,40,42,0.6)`（透明度 0.4–0.55） |
| `--content-bg` | `rgba(44,44,46,0.85)` |
| `--table-core-bg` | `rgba(44,44,46,0.92)` |
| `--table-header-bg` | `rgba(0,122,255,0.12)` |
| `--table-row-odd` | `rgba(58,58,60,0.5)` |
| `--table-row-even` | `rgba(44,44,46,0.7)` |
| `--text-primary` | `#F2F2F7` |
| `--text-secondary` | `#AEAEB2` |
| `--text-tertiary` | `#8E8E93` |
| `--glass-border` | `rgba(255,255,255,0.08)` |
| `--grid-line` | `rgba(255,255,255,0.08)` |
| `--blur-card` | `30px`（暗色提升至 30–40px） |
| `--blur-modal` | `40px` |

> 主色/状态色/图表色板 C1-C10 在暗色下保持不变（iOS 暗色模式下强调色不变），仅背景与文字翻转。

### 2.3 变量命名规范

- 色彩：`--color-{语义}`（`--color-primary` / `--color-success` / `--color-error`）
- 背景：`--bg-{语义}`（`--bg-gradient`）/ `--glass-bg` / `--content-bg` / `--table-*-bg`
- 文字：`--text-{层级}`（`primary` / `secondary` / `tertiary` / `disabled`）
- 边框：`--border-color` / `--glass-border`
- 阴影：`--shadow-{场景}`（`card` / `hover` / `modal`）
- 圆角：`--radius-{场景}`（`card` / `button` / `input` / `tag` / `capsule`）
- 模糊：`--blur-{场景}`（`card` / `modal` / `tooltip` / `mask`）
- 图表网格：`--grid-line`
- 命名一律小写连字符；语义优先于色相（`--color-success` 而非 `--color-green`），便于暗色复用。

### 2.4 完整 CSS 变量定义代码块

```css
/* web/src/theme/variables.css */
:root {
  /* === 主色 / 状态色 === */
  --color-primary: #007AFF;
  --color-success: #34C759;
  --color-error:   #FF3B30;
  --color-warning: #FF9500;
  --color-info:    #007AFF;

  /* === 辅助色（图表） === */
  --color-purple:  #5856D6;
  --color-pink:    #FF2D92;
  --color-teal:    #30B0C7;
  --color-yellow:  #FFCC00;
  --color-magenta: #AF52DE;
  --color-cyan:    #64D2FF;
  --color-gray:    #8E8E93;

  /* === 背景与玻璃 === */
  --bg-gradient: linear-gradient(135deg, #E3F0FF 0%, #EDE7FF 40%, #FFE9F3 75%, #E0F7F4 100%);
  --glass-bg:        rgba(255,255,255,0.65);
  --content-bg:      rgba(255,255,255,0.90);
  --table-core-bg:   rgba(255,255,255,0.92);
  --table-header-bg: rgba(0,122,255,0.06);
  --table-row-odd:   rgba(255,255,255,0.60);
  --table-row-even:  rgba(255,255,255,0.85);
  --table-row-hover: rgba(0,122,255,0.08);
  --table-row-selected: rgba(0,122,255,0.12);

  /* === 文字 === */
  --text-primary:   #1C1C1E;
  --text-secondary: #3A3A3C;
  --text-tertiary:  #8E8E93;
  --text-disabled:  #C7C7CC;

  /* === 边框 / 网格 === */
  --border-color:  rgba(0,0,0,0.06);
  --glass-border:  rgba(255,255,255,0.50);
  --grid-line:     rgba(60,60,67,0.08);

  /* === 阴影 === */
  --shadow-card:  0 2px 12px rgba(0,0,0,0.06);
  --shadow-hover: 0 4px 20px rgba(0,0,0,0.10);
  --shadow-modal: 0 12px 48px rgba(0,0,0,0.16);
  --mask-bg:      rgba(0,0,0,0.25);

  /* === 圆角 === */
  --radius-card:    20px;
  --radius-button:  12px;
  --radius-input:   10px;
  --radius-tag:     8px;
  --radius-capsule: 999px;

  /* === 模糊半径 === */
  --blur-card:    24px;
  --blur-modal:   30px;
  --blur-tooltip: 16px;
  --blur-mask:    4px;
}

/* === 暗色预留（P1） === */
.dark {
  --bg-gradient: linear-gradient(135deg, #1C1C1E 0%, #2C2C2E 40%, #1A1A2E 75%, #242426 100%);
  --glass-bg:        rgba(40,40,42,0.60);
  --content-bg:      rgba(44,44,46,0.85);
  --table-core-bg:   rgba(44,44,46,0.92);
  --table-header-bg: rgba(0,122,255,0.12);
  --table-row-odd:   rgba(58,58,60,0.50);
  --table-row-even:  rgba(44,44,46,0.70);
  --table-row-hover: rgba(0,122,255,0.16);
  --table-row-selected: rgba(0,122,255,0.24);

  --text-primary:   #F2F2F7;
  --text-secondary: #AEAEB2;
  --text-tertiary:  #8E8E93;
  --text-disabled:  #48484A;

  --border-color:  rgba(255,255,255,0.08);
  --glass-border:  rgba(255,255,255,0.08);
  --grid-line:     rgba(255,255,255,0.08);

  --shadow-card:  0 2px 12px rgba(0,0,0,0.40);
  --shadow-hover: 0 4px 20px rgba(0,0,0,0.50);
  --shadow-modal: 0 12px 48px rgba(0,0,0,0.60);
  --mask-bg:      rgba(0,0,0,0.55);

  --blur-card:  30px;
  --blur-modal: 40px;
  /* 主色/状态色/图表色板不变 */
}

/* 打印强制纯白（规避渐变背景影响打印） */
@media print {
  :root, .dark {
    --bg-gradient: #FFFFFF;
    --glass-bg: #FFFFFF;
    --content-bg: #FFFFFF;
    --table-core-bg: #FFFFFF;
    --table-row-odd: #FFFFFF;
    --table-row-even: #FFFFFF;
  }
}
```

### 2.5 色板常量单源（tokens.ts）

```ts
// web/src/theme/tokens.ts
export const PALETTE = {
  primary: '#007AFF', success: '#34C759', error: '#FF3B30',
  warning: '#FF9500', info: '#007AFF',
  purple: '#5856D6', pink: '#FF2D92', teal: '#30B0C7',
  yellow: '#FFCC00', magenta: '#AF52DE', cyan: '#64D2FF', gray: '#8E8E93',
} as const;

export const CHART_COLORS = [
  '#007AFF', '#FF3B30', '#34C759', '#FF9500', '#5856D6',
  '#FF2D92', '#30B0C7', '#FFCC00', '#AF52DE', '#64D2FF',
] as const; // C1-C10

export const TEXT = {
  light:  { primary: '#1C1C1E', secondary: '#3A3A3C', tertiary: '#8E8E93', disabled: '#C7C7CC' },
  dark:   { primary: '#F2F2F7', secondary: '#AEAEB2', tertiary: '#8E8E93', disabled: '#48484A' },
} as const;

export const GLASS = {
  light: { bg: 'rgba(255,255,255,0.65)', border: 'rgba(255,255,255,0.5)', blur: '24px' },
  dark:  { bg: 'rgba(40,40,42,0.6)', border: 'rgba(255,255,255,0.08)', blur: '30px' },
} as const;

export const RADIUS = { card: 20, button: 12, input: 10, tag: 8, capsule: 999 } as const;
export const FONT_FAMILY = `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Microsoft YaHei', sans-serif`;
```

---

## 三、Ant Design 5 ConfigProvider token 配置方案

### 3.1 亮色主题 token（完整 TypeScript）

```ts
// web/src/theme/lightTheme.ts
import type { ThemeConfig } from 'antd';
import { PALETTE, TEXT, RADIUS, FONT_FAMILY } from './tokens';

export const lightTheme: ThemeConfig = {
  token: {
    colorPrimary:    PALETTE.primary,   // #007AFF
    colorSuccess:    PALETTE.success,   // #34C759
    colorError:      PALETTE.error,     // #FF3B30
    colorWarning:    PALETTE.warning,   // #FF9500
    colorInfo:       PALETTE.info,      // #007AFF
    colorTextBase:   TEXT.light.primary,   // #1C1C1E
    colorBgBase:     '#FFFFFF',
    colorText:       TEXT.light.primary,
    colorTextSecondary: TEXT.light.secondary,
    colorTextTertiary:  TEXT.light.tertiary,
    colorTextDisabled:  TEXT.light.disabled,
    colorBorder:     'rgba(0,0,0,0.06)',
    colorBorderSecondary: 'rgba(0,0,0,0.04)',
    borderRadius:    RADIUS.input,      // 10 全局基准
    borderRadiusLG:  RADIUS.card,       // 20
    borderRadiusSM:  RADIUS.tag,        // 8
    fontSize:        14,
    fontFamily:      FONT_FAMILY,
    wireframe:       false,
  },
  components: {
    // 毛玻璃组件 token 定制（backgroundColor 用 rgba）
    Modal: {
      contentBg:   'rgba(255,255,255,0.8)',
      headerBg:    'transparent',
      titleColor:  TEXT.light.primary,
      contentColor: TEXT.light.secondary,
      borderRadiusLG: RADIUS.card,
    },
    Drawer: {
      contentBg:   'rgba(255,255,255,0.8)',
      headerBg:    'transparent',
      colorText:   TEXT.light.primary,
    },
    Card: {
      colorBgContainer: 'transparent', // 透明，由 .glass-card 控制底色
      headerBg: 'transparent',
      paddingLG: 20,
      borderRadiusLG: RADIUS.card,
    },
    Table: {
      headerBg:        'rgba(0,122,255,0.06)',
      headerColor:     TEXT.light.primary,
      rowHoverBg:      'rgba(0,122,255,0.08)',
      rowSelectedBg:   'rgba(0,122,255,0.12)',
      rowSelectedHoverBg: 'rgba(0,122,255,0.16)',
      borderColor:     'rgba(0,0,0,0.06)',
      cellPaddingBlock: 10,
      cellPaddingInline: 12,
      headerSplitColor: 'transparent',
    },
    Button: { borderRadius: RADIUS.button, controlHeight: 36 },
    Input:  { borderRadius: RADIUS.input, activeBorderColor: PALETTE.primary, hoverBorderColor: PALETTE.primary },
    InputNumber: { borderRadius: RADIUS.input },
    Select: { borderRadius: RADIUS.input },
    Tag:    { borderRadiusSM: RADIUS.tag },
    Tooltip:{ colorBgSpotlight: 'rgba(255,255,255,0.85)', colorTextLightSolid: TEXT.light.primary },
    Menu:   { itemBg: 'transparent', itemSelectedBg: 'rgba(0,122,255,0.12)', itemSelectedColor: PALETTE.primary },
    Segmented: { itemSelectedBg: '#FFFFFF', trackBg: 'rgba(0,0,0,0.04)', borderRadius: RADIUS.capsule, borderRadiusSM: RADIUS.capsule },
  },
};
```

### 3.2 暗色主题 token 预留（P1 方向）

```ts
// web/src/theme/darkTheme.ts (P1)
import type { ThemeConfig } from 'antd';
import { PALETTE, TEXT } from './tokens';

export const darkTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: PALETTE.primary, colorSuccess: PALETTE.success,
    colorError: PALETTE.error, colorWarning: PALETTE.warning,
    colorTextBase: TEXT.dark.primary, colorBgBase: '#1C1C1E',
    colorText: TEXT.dark.primary, colorTextSecondary: TEXT.dark.secondary,
    colorTextTertiary: TEXT.dark.tertiary, colorTextDisabled: TEXT.dark.disabled,
    // borderRadius/fontSize/fontFamily 与 lightTheme 一致（复用常量）
  },
  components: {
    Modal:  { contentBg: 'rgba(40,40,42,0.8)', headerBg: 'transparent' },
    Drawer: { contentBg: 'rgba(40,40,42,0.8)', headerBg: 'transparent' },
    Card:   { colorBgContainer: 'transparent' },
    Table:  { headerBg: 'rgba(0,122,255,0.12)', rowHoverBg: 'rgba(0,122,255,0.16)' },
    // ... 其余与 light 对称
  },
};
```

### 3.3 ConfigProvider 动态切换实现

```tsx
// web/src/App.tsx（节选）
import { ConfigProvider, App as AntdApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useThemeStore } from './store/themeStore';
import { lightTheme } from './theme/lightTheme';
import { darkTheme } from './theme/darkTheme';

function App() {
  const theme = useThemeStore((s) => s.theme);
  const current = theme === 'dark' ? darkTheme : lightTheme;
  return (
    <ConfigProvider theme={current} locale={zhCN}>
      <AntdApp>
        <AppRouter />
      </AntdApp>
    </ConfigProvider>
  );
}
```

> 切换时 `themeStore` 变更触发 `App` 重渲染，`ConfigProvider` 接收新 `theme` 对象，AntD 全量重算 token 并重渲染子树，无需手动 `key` 重置。

---

## 四、Tailwind CSS 配置方案

### 4.1 tailwind.config.ts

```ts
// web/tailwind.config.ts
import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false }, // [P1-2] 关闭 preflight，避免覆盖 AntD 基础样式
  theme: {
    extend: {
      colors: {
        // 引用 CSS 变量，运行时随 :root/.dark 翻转
        primary:   'var(--color-primary)',
        success:   'var(--color-success)',
        error:     'var(--color-error)',
        warning:   'var(--color-warning)',
        info:      'var(--color-info)',
        'text-primary':   'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary':  'var(--text-tertiary)',
        'glass-bg':       'var(--glass-bg)',
        'content-bg':     'var(--content-bg)',
        'border-glass':   'var(--glass-border)',
      },
      backdropBlur: {
        card:    '24px',
        modal:   '30px',
        tooltip: '16px',
        mask:    '4px',
      },
      borderRadius: {
        card:    'var(--radius-card)',
        button:  'var(--radius-button)',
        input:   'var(--radius-input)',
        tag:     'var(--radius-tag)',
        capsule: 'var(--radius-capsule)',
      },
      boxShadow: {
        card:  'var(--shadow-card)',
        hover: 'var(--shadow-hover)',
        modal: 'var(--shadow-modal)',
      },
      backgroundImage: {
        'ios-gradient': 'var(--bg-gradient)',
      },
      transitionProperty: {
        theme: 'background-color, color, border-color, box-shadow',
      },
    },
  },
  plugins: [],
} satisfies Config;
```

### 4.2 自定义 utility class（glass.css，@layer utilities 注入）

```css
/* web/src/theme/glass.css —— 详见第五章完整实现，此处为声明入口 */
@layer utilities {
  .glass-card  { /* 见 5.1 */ }
  .glass-nav   { /* 见 5.2 */ }
  .glass-modal { /* 见 5.3 */ }
  .glass-tooltip { /* 见 5.4 */ }
}
```

### 4.3 preflight 处理

- 沿用 v2 方案 P1-2 决策：`corePlugins: { preflight: false }`，Tailwind 不注入 reset，避免覆盖 AntD 基础样式（button 背景重置、border 重置等）。
- 盒模型 `box-sizing: border-box` 由 AntD 全局样式保证；如需可手动在 `index.css` 补一行 `*,*::before,*::after{box-sizing:border-box}`。
- `.glass-*` 通过 `@layer utilities` 注入，优先级低于 AntD 组件样式但可被业务 className 覆盖，与 preflight 关闭不冲突。

---

## 五、毛玻璃效果 CSS 实现方案

### 5.1 .glass-card 完整 CSS

```css
.glass-card {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--blur-card)) saturate(1.8);
  -webkit-backdrop-filter: blur(var(--blur-card)) saturate(1.8);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  /* GPU 加速：提升为合成层，避免重绘抖动 */
  will-change: backdrop-filter;
  transform: translateZ(0);
  transition: box-shadow 0.25s ease, transform 0.25s ease;
}
.glass-card:hover {
  box-shadow: var(--shadow-hover);
  transform: translateY(-2px);
}
```

### 5.2 .glass-nav（侧边栏/顶部栏）

```css
.glass-nav {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--blur-card)) saturate(1.8);
  -webkit-backdrop-filter: blur(var(--blur-card)) saturate(1.8);
  border-right: 1px solid var(--glass-border);  /* 侧边栏 */
  /* 顶部栏改 border-bottom: 1px solid var(--glass-border); */
  box-shadow: var(--shadow-card);
  position: sticky; /* 或 fixed，由布局决定 */
  z-index: 100;
  will-change: backdrop-filter;
  transform: translateZ(0);
}
```

### 5.3 .glass-modal（弹窗/抽屉面板）

```css
.glass-modal {
  background: rgba(255,255,255,0.8);
  backdrop-filter: blur(var(--blur-modal)) saturate(1.8);
  -webkit-backdrop-filter: blur(var(--blur-modal)) saturate(1.8);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-modal);
  will-change: backdrop-filter;
  transform: translateZ(0);
}
/* 遮罩层轻微模糊 */
.glass-mask {
  background: var(--mask-bg);
  backdrop-filter: blur(var(--blur-mask));
  -webkit-backdrop-filter: blur(var(--blur-mask));
}
```

### 5.4 .glass-tooltip（ECharts Tooltip）

```css
.glass-tooltip {
  background: rgba(255,255,255,0.85);
  backdrop-filter: blur(var(--blur-tooltip)) saturate(1.8);
  -webkit-backdrop-filter: blur(var(--blur-tooltip)) saturate(1.8);
  border: 1px solid var(--glass-border);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
  color: var(--text-primary);
  padding: 8px 12px;
}
```

### 5.5 降级方案（@supports 检测 + 性能模式开关）

```css
/* 不支持 backdrop-filter 时，降级为纯色半透明（保留可读性） */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass-card, .glass-nav, .glass-modal, .glass-tooltip {
    background: var(--content-bg); /* rgba(255,255,255,0.9) 近白，保证可读 */
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

/* 性能模式：data-perf="low" 时全局关闭模糊（低端设备/大量玻璃元素场景） */
:root[data-perf="low"] .glass-card,
:root[data-perf="low"] .glass-nav,
:root[data-perf="low"] .glass-modal,
:root[data-perf="low"] .glass-tooltip {
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  background: var(--content-bg);
  will-change: auto;
  transform: none;
}
```

> 性能模式开关：`document.documentElement.setAttribute('data-perf', 'low')`，由 `themeStore.perfMode` 驱动；可在首屏检测 `navigator.hardwareConcurrency < 4` 或用户手动开启"省电模式"时触发。

### 5.6 性能优化要点

| 手段 | 作用 |
|---|---|
| `will-change: backdrop-filter` | 提示浏览器提前创建合成层，减少首帧卡顿 |
| `transform: translateZ(0)` | 强制 GPU 合成层，避免滚动时重绘抖动 |
| `blur` 半径控制（≤30px） | 模糊半径越大 GPU 占用越高；卡片 24px、弹窗 30px 为可读性与性能平衡点 |
| `saturate(1.8)` | 增强透出内容饱和度，弥补半透明发灰 |
| 限制毛玻璃元素数量 | 单屏不超过 8 个 `backdrop-filter` 元素；表格"壳毛玻璃+芯近白"正是为此——仅外层 1 个 blur，芯区纯色 |
| `contain: layout paint` | 对静态玻璃卡片加容器隔离，减少重排范围（按需） |

---

## 六、ECharts 主题配置方案

### 6.1 亮色 ECharts theme（完整）

```ts
// web/src/theme/echartsLightTheme.ts
import { CHART_COLORS, TEXT } from './tokens';

export const echartsLightTheme = {
  color: [...CHART_COLORS], // C1-C10
  backgroundColor: 'transparent', // 透明，由卡片容器提供近白底
  textStyle: { fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif', color: TEXT.light.secondary },
  grid: {
    left: 48, right: 24, top: 32, bottom: 40,
    containLabel: true,
  },
  categoryAxis: {
    axisLine:  { lineStyle: { color: 'rgba(60,60,67,0.16)' } },
    axisTick:  { show: false },
    axisLabel: { color: TEXT.light.secondary, fontSize: 12 },
    splitLine: { show: true, lineStyle: { color: 'rgba(60,60,67,0.08)', type: 'dashed' } },
  },
  valueAxis: {
    axisLine:  { show: false },
    axisTick:  { show: false },
    axisLabel: { color: TEXT.light.secondary, fontSize: 12 },
    splitLine: { lineStyle: { color: 'rgba(60,60,67,0.08)' } },
  },
  legend: {
    textStyle: { color: TEXT.light.primary, fontSize: 13 },
    icon: 'circle', itemWidth: 8, itemHeight: 8,
  },
  tooltip: {
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderColor: 'rgba(255,255,255,0.5)',
    borderWidth: 1,
    borderRadius: 12,
    padding: [8, 12],
    textStyle: { color: TEXT.light.primary, fontSize: 13 },
    extraCssText: 'backdrop-filter: blur(16px) saturate(1.8); -webkit-backdrop-filter: blur(16px) saturate(1.8); box-shadow: 0 2px 12px rgba(0,0,0,0.06);',
  },
  // 柱状图圆角
  bar: { itemStyle: { borderRadius: [6, 6, 0, 0] } },
  // 折线 sparkline 风格
  line: { itemStyle: { color: CHART_COLORS[0] }, lineStyle: { width: 2 }, areaStyle: { opacity: 0.12 } },
} as const;
```

### 6.2 暗色 ECharts theme 预留（P1 方向）

```ts
// web/src/theme/echartsDarkTheme.ts (P1)
export const echartsDarkTheme = {
  ...echartsLightTheme,
  textStyle: { ...echartsLightTheme.textStyle, color: TEXT.dark.secondary },
  categoryAxis: { ...echartsLightTheme.categoryAxis,
    axisLine: { lineStyle: { color: 'rgba(255,255,255,0.16)' } },
    axisLabel: { color: TEXT.dark.secondary },
    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } } },
  valueAxis: { ...echartsLightTheme.valueAxis,
    axisLabel: { color: TEXT.dark.secondary },
    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } } },
  legend: { textStyle: { color: TEXT.dark.primary } },
  tooltip: { backgroundColor: 'rgba(40,40,42,0.85)', borderColor: 'rgba(255,255,255,0.08)',
    textStyle: { color: TEXT.dark.primary } },
  // color 数组不变
};
```

### 6.3 主题动态注入实现

```ts
// web/src/lib/echartsSetup.ts
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { echartsLightTheme, echartsDarkTheme } from '../theme';

echarts.use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);
echarts.registerTheme('ios-light', echartsLightTheme as any);
echarts.registerTheme('ios-dark', echartsDarkTheme as any);

export { echarts };
```

```tsx
// 图表组件切换重绘
// echarts-for-react 的 ReactECharts 接收 theme prop；切换时 theme 变化触发内部 init/setOption
<ReactECharts
  ref={chartRef}
  echarts={echarts}
  theme={currentTheme === 'dark' ? 'ios-dark' : 'ios-light'}
  option={option}
  notMerge={false}
/>
// 主题切换时：themeStore 变化 → currentTheme 变化 → ReactECharts 重新 init(theme) + setOption(option)
// 已有实例可通过 chartRef.getEchartsInstance().dispose() 后重新 init 保证 theme 生效
```

### 6.4 图表卡片容器与 canvas 边界处理（关键）

- **canvas 区近白底，不依赖父级 `backdrop-filter` 透传**：图表外层用 `.glass-card`（毛玻璃壳），但 ECharts canvas 容器内嵌一个 `bg-[var(--content-bg)]`（rgba 近白 0.9）的"画布芯"div，canvas 落在近白芯上。
- 原因：① `backdrop-filter` 不会透传到子级 canvas 像素，canvas 自身透明会露出渐变背景导致网格线对比度不足；② 近白底保证坐标轴文字（#3A3A3C）可读性；③ 与"包壳不包肉"原则一致。
- 结构：`.glass-card > .chart-core(bg-content) > ReactECharts(backgroundColor: transparent)`。

```tsx
<div className="glass-card p-5">
  <div className="chart-core rounded-[var(--radius-card)] bg-[var(--content-bg)] p-3">
    <ReactECharts theme="ios-light" option={option} />
  </div>
</div>
```

---

## 七、主题切换架构

### 7.1 主题状态管理（Zustand）

```ts
// web/src/store/themeStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ThemeMode = 'light' | 'dark';
type PerfMode = 'auto' | 'low';

interface ThemeState {
  theme: ThemeMode;
  perfMode: PerfMode;
  setTheme: (t: ThemeMode) => void;
  toggle: () => void;
  setPerfMode: (p: PerfMode) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      perfMode: 'auto',
      setTheme: (t) => { set({ theme: t }); applyTheme(t, get().perfMode); },
      toggle:  () => { const t = get().theme === 'light' ? 'dark' : 'light'; get().setTheme(t); },
      setPerfMode: (p) => { set({ perfMode: p }); applyTheme(get().theme, p); },
    }),
    { name: 'theme', partialize: (s) => ({ theme: s.theme, perfMode: s.perfMode }) }
  )
);

// 应用主题到 DOM
export function applyTheme(theme: ThemeMode, perf: PerfMode) {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  // 系统性能检测（auto 模式下低端设备降级）
  const low = perf === 'low' || (perf === 'auto' && (navigator.hardwareConcurrency ?? 8) < 4);
  root.setAttribute('data-perf', low ? 'low' : 'high');
}

// 初始化（main.tsx 调用一次）
export function initTheme() {
  const { theme, perfMode } = useThemeStore.getState();
  applyTheme(theme, perfMode);
}
```

### 7.2 持久化

- localStorage 键：`theme`（zustand persist 自动序列化为 `{"state":{"theme":"light","perfMode":"auto"},"version":0}`）。
- 读取：`useThemeStore` 初始化时 persist 自动 hydrate。

### 7.3 切换完整数据流

```
用户点击 Toggle
   │
   ▼
themeStore.toggle() → set({theme}) + applyTheme()
   │
   ├──① document.documentElement.classList.toggle('dark')
   │      └→ CSS 变量 :root↔.dark 翻转
   │           └→ Tailwind utility (var) + glass.css + inline style 自动重渲染
   │
   ├──② persist 写 localStorage['theme']
   │
   ├──③ App.tsx 订阅 themeStore → ConfigProvider theme={darkTheme|lightTheme}
   │      └→ AntD 全量 token 重算 + 子树重渲染
   │
   └──④ 图表组件订阅 themeStore → ReactECharts theme prop 切换
          └→ echarts.dispose() + init(theme) + setOption(option) 重绘
```

### 7.4 系统主题跟随（P1）

```ts
// 监听 prefers-color-scheme，首次访问无 localStorage 时跟随系统
const mql = window.matchMedia('(prefers-color-scheme: dark)');
if (!localStorage.getItem('theme')) {
  useThemeStore.getState().setTheme(mql.matches ? 'dark' : 'light');
}
mql.addEventListener('change', (e) => {
  // 仅当用户未手动设置时跟随（需标志位 userOverride）
  if (!userOverride) useThemeStore.getState().setTheme(e.matches ? 'dark' : 'light');
});
```

### 7.5 切换过渡动画

```css
/* 全局过渡：颜色类属性 0.3s，避免布局抖动 */
html.theme-transition,
html.theme-transition * {
  transition: background-color 0.3s ease, color 0.3s ease,
              border-color 0.3s ease, box-shadow 0.3s ease;
}
/* 切换时临时加 class，过渡结束移除，避免日常 hover 也走 0.3s */
```

> 实现细节：toggle 时 `root.classList.add('theme-transition')`，`setTimeout(300ms)` 后移除。ECharts canvas 不受 CSS transition 影响，靠 setOption 重绘。

---

## 八、业务组件封装层

### 8.1 组件清单与职责

| 组件 | 职责 | 关键技术 |
|---|---|---|
| `GlassCard` | 通用毛玻璃卡片容器 | `.glass-card` + 可选标题/操作区 |
| `GlassTable` | 毛玻璃壳 + 近白表格芯双层表格 | AntD Table token override + 壳芯嵌套 |
| `GlassNav` | 毛玻璃侧边栏/顶部栏 | `.glass-nav` + 折叠态 |
| `GlassModal` | 毛玻璃弹窗 | AntD Modal + `.glass-modal` className |
| `GlassDrawer` | 毛玻璃抽屉 | AntD Drawer + `.glass-modal` |
| `GlassTooltip` | ECharts 毛玻璃 Tooltip | ECharts theme tooltip 配置 |
| `SegmentedControl` | iOS 分段控制器（Tab 切换） | AntD Segmented token 定制 |
| `StatusCapsule` | 灵动岛风格状态胶囊 | `.glass-card` + capsule radius |

### 8.2 各组件 Props 设计与关键实现

#### GlassCard

```tsx
interface GlassCardProps {
  title?: React.ReactNode;
  extra?: React.ReactNode;       // 右上操作区
  padding?: number;              // 默认 20
  hoverable?: boolean;           // 是否启用 hover 抬升，默认 true
  children: React.ReactNode;
  className?: string;
}
// 关键：外层 div.glass-card，标题区 border-b glass-border，内容区 bg-transparent
```

#### GlassTable（壳毛玻璃 + 芯近白，关键）

```tsx
interface GlassTableProps<T> extends Omit<TableProps<T>, ''> {
  density?: 'compact' | 'standard' | 'comfortable'; // 36/44/52px 行高
  glassShell?: boolean; // 默认 true，外层毛玻璃壳
}
// 关键实现：
// 1. 外层 .glass-card（毛玻璃壳，blur 24px）
// 2. 内层 .table-core（bg-[var(--table-core-bg)]，不加 backdrop-filter）
// 3. AntD Table 落在芯上，token 已配置 headerBg/rowHoverBg/斑马纹
// 4. density 映射 size: 'small'|'middle'|'large' + cellPaddingBlock
```

```tsx
export function GlassTable<T>({ density = 'standard', glassShell = true, ...props }: GlassTableProps<T>) {
  const sizeMap = { compact: 'small', standard: 'middle', comfort: 'large' } as const;
  const padMap = { compact: 8, standard: 10, comfort: 14 };
  return (
    <div className={glassShell ? 'glass-card p-4' : ''}>
      <div className="table-core rounded-[var(--radius-card)] bg-[var(--table-core-bg)] overflow-hidden">
        <ConfigProvider theme={{ components: { Table: { cellPaddingBlock: padMap[density] } } }}>
          <Table<T> size={sizeMap[density]} {...props} />
        </ConfigProvider>
      </div>
    </div>
  );
}
```

#### GlassNav

```tsx
interface GlassNavProps {
  collapsed: boolean;            // 折叠态 64px / 展开 220px
  position: 'side' | 'top';
  children: React.ReactNode;
}
// 关键：aside.glass-nav，宽度 transition 0.2s，position: 'side' 用 border-r，'top' 用 border-bottom
```

#### GlassModal / GlassDrawer

```tsx
interface GlassModalProps extends ModalProps {}
// 关键：Modal 的 className 注入 .glass-modal，maskClassName 注入 .glass-mask
// 通过 ConfigProvider Modal token contentBg=rgba(0.8) + className blur 双保险
<Modal className="glass-modal" maskClassName="glass-mask" {...props} />

interface GlassDrawerProps extends DrawerProps {}
<Drawer className="glass-modal" rootClassName="" {...props} />
```

#### GlassTooltip（ECharts）

```tsx
// 非组件，而是 ECharts theme 配置（见 6.1 tooltip 节）
// 业务侧只需：option.tooltip = { confine: true, ...theme.tooltip }
// extraCssText 注入 backdrop-filter 实现毛玻璃
```

#### SegmentedControl

```tsx
interface SegmentedControlProps {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
  block?: boolean; // 是否撑满父容器
}
// 关键：AntD Segmented，token 已定制 trackBg=rgba(0,0,0,0.04) + itemSelectedBg=#FFF + borderRadius=capsule
// 外层包一层 .glass-card 的浅底（rgba 0.5）增强 iOS 质感
```

#### StatusCapsule

```tsx
interface StatusCapsuleProps {
  type?: 'success' | 'error' | 'warning' | 'info';
  children: React.ReactNode;
  pulse?: boolean; // 灵动岛呼吸动画
}
// 关键：span.glass-card rounded-capsule px-3 py-1 text-xs
// pulse 时加 @keyframes 呼吸动画（scale 1→1.02）
```

---

## 九、文件结构规划

```
web/
├─ src/
│  ├─ theme/
│  │  ├─ tokens.ts                 # 色板/文字/玻璃/圆角常量单源（light+dark）
│  │  ├─ variables.css             # :root + .dark CSS 变量定义（唯一真相源）
│  │  ├─ glass.css                 # .glass-card/.glass-nav/.glass-modal/.glass-tooltip + 降级
│  │  ├─ lightTheme.ts             # AntD 亮色 ConfigProvider token
│  │  ├─ darkTheme.ts              # AntD 暗色 token（P1）
│  │  ├─ echartsLightTheme.ts      # ECharts 亮色主题 JSON
│  │  ├─ echartsDarkTheme.ts       # ECharts 暗色主题（P1）
│  │  ├─ echartsSetup.ts           # echarts.use + registerTheme
│  │  └─ index.ts                  # 统一导出
│  ├─ components/
│  │  └─ glass/
│  │     ├─ GlassCard.tsx
│  │     ├─ GlassTable.tsx
│  │     ├─ GlassNav.tsx
│  │     ├─ GlassModal.tsx
│  │     ├─ GlassDrawer.tsx
│  │     ├─ GlassTooltip.ts        # ECharts tooltip option 工厂
│  │     ├─ SegmentedControl.tsx
│  │     ├─ StatusCapsule.tsx
│  │     └─ index.ts
│  ├─ store/
│  │  ├─ themeStore.ts             # Zustand theme/perf 状态 + applyTheme/initTheme
│  │  └─ ...（authStore 等原有 store）
│  ├─ lib/
│  │  └─ echartsSetup.ts → 见 theme/echartsSetup.ts（或 lib 引用 theme）
│  ├─ App.tsx                      # ConfigProvider 动态切换入口
│  ├─ main.tsx                     # initTheme() + import variables.css/glass.css
│  └─ index.css                    # 全局基础（box-sizing、bg-gradient body）
├─ tailwind.config.ts              # darkMode:'class' + colors→var + backdropBlur + radius
└─ index.html
```

> 与 v2 方案 `web/src/components/`（通用 Layout/Table/Dialog/HasPermission）共存：`components/glass/` 为新增毛玻璃组件层，`components/layout/AppLayout.tsx` 内部改用 `GlassNav` 包壳。

---

## 十、迁移清单（v2 方案修订项）

| v2 章节 | 修订内容 | 工作量 |
|---|---|---|
| **3.2 技术栈（前端）** | 表格"样式"行补充：CSS 变量层（`theme/variables.css`）、毛玻璃 utility（`theme/glass.css`）、ECharts 主题（`theme/echarts*.ts`）、`tokens.ts` 常量单源；Tailwind 行补充 `darkMode:'class'`、colors 引用 CSS 变量、backdropBlur 扩展 | 小 |
| **3.3 架构分层** | 前端 `web/` 目录树补充 `theme/` 目录、`components/glass/` 目录、`store/themeStore.ts`；架构图 Layer 1-4 标注 | 小 |
| **第十章 前端展示规范** | 全面替换为 iOS 毛玻璃规范：10.x 新增色板（亮 P0/暗 P1）、布局尺寸、表格双层结构、组件规范、ECharts 规范、主题切换机制；保留 10.1 数值单位/10.2 对齐/10.3 精度（红涨绿跌与 iOS 红/绿一致，色值统一 #FF3B30/#34C759） | 中 |
| **T01 基础设施任务** | 增加：主题系统搭建（`theme/` 全量文件 + `tailwind.config.ts` 改造 + `main.tsx` 引入 variables.css/glass.css + `themeStore` + `App.tsx` ConfigProvider 接入 + `echartsSetup`） | 中 |
| **依赖包** | 补充确认：`DOMPurify`（v2 已有）、`sanitize-html`（v2 已有）；**无需新增第三方包**——毛玻璃为纯 CSS（backdrop-filter），主题切换为现有 Zustand + AntD ConfigProvider，无额外依赖 | 无 |
| **附录 关键文件路径** | 新增 `theme/` 7 文件、`components/glass/` 8 文件、`store/themeStore.ts`；`tailwind.config.ts` 说明由"preflight:false"扩展为完整毛玻璃配置 | 小 |

**工作量估算**：

| 模块 | 人日 | 说明 |
|---|---|---|
| 主题基础设施（CSS 变量 + tokens + Tailwind + glass.css） | 1.5 | 含降级与性能开关 |
| AntD token 配置（light + 组件 override） | 1.0 | Modal/Drawer/Card/Table/Segmented |
| ECharts 主题 + 动态注入 | 0.5 | light theme + registerTheme |
| 主题切换（themeStore + ConfigProvider + 重绘） | 0.5 | 含过渡动画 |
| 毛玻璃业务组件（8 个） | 2.0 | GlassTable 双层结构最重 |
| 现有页面接入（Layout/Dashboard/Indicators） | 1.5 | 替换容器为 GlassCard/GlassNav |
| 暗色预留（P1 方向性，不计 P0） | — | P1 单独排期 |
| **P0 合计** | **≈ 7 人日** | |

---

## 十一、风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| **backdrop-filter 浏览器兼容性** | Firefox 早期版本、部分企业内嵌浏览器（基于旧 Chromium）不支持 | `@supports not` 降级为 `--content-bg` 近白纯色（5.5）；降级后仍保证可读性，仅损失玻璃质感；目标浏览器为现代 Chromium/WebKit，兼容性可控 |
| **AntD 组件深度定制成本** | Table/Modal/Drawer 的 token override + className 注入工作量大，部分样式 token 不暴露需 CSS 覆盖 | P0 优先用 ConfigProvider `components` token（官方支持，升级安全）；仅 token 不够处用 `.glass-*` className 覆盖；Table 斑马纹/行 hover 用 token（headerBg/rowHoverBg/rowSelectedBg 已支持）；遗留硬覆盖集中到 `glass.css` 便于维护 |
| **ECharts canvas 与 backdrop-filter 渲染边界** | canvas 透明会透出渐变背景，网格线对比度不足；backdrop-filter 不透传到 canvas | 强制"图表卡片 = 玻璃壳 + 近白芯"双层结构（6.4），canvas 落在 `--content-bg` 近白芯上，`backgroundColor:'transparent'` 仅相对芯；与"包壳不包肉"一致 |
| **性能风险（大量毛玻璃元素 GPU 内存）** | 单屏多个 backdrop-filter 元素导致 GPU 合成层过多，低端设备卡顿 | ① 表格"壳毛玻璃+芯近白"将 blur 元素从 N 行收敛为 1 个；② `data-perf="low"` 性能模式全局关模糊（5.5）；③ `will-change` + `translateZ(0)` 仅对静态玻璃元素启用，动态元素慎用；④ 单屏 glass 元素 ≤8 个为设计约束 |
| **暗色主题预留充分性** | P0 若硬编码色值，P1 暗色改造工作量爆炸 | 强制 P0 全量使用 CSS 变量（无硬编码 hex 进业务组件）；`tokens.ts` 已定义 dark 变体；AntD/ECharts 主题文件已预留 dark 版；P1 仅需启用 `.dark` class + 接入 darkTheme/echartsDarkTheme，预计 1-2 人日 |
| **preflight 关闭副作用** | Tailwind 不注入 reset，部分原子类（如 `border` 默认颜色）行为变化 | 业务样式以 AntD 为基准 + 显式 `border-color`；`glass.css` 中 `.glass-*` 显式声明 border；不依赖 preflight 默认值 |
| **打印场景渐变背景** | 渐变背景 + 毛玻璃导致打印耗墨且看不清 | `@media print` 强制 `--bg-gradient`/`--glass-bg` 为纯白（2.4 已含） |

---

*本方案基于产品经理《iOS 毛玻璃风格 UI 设计规范》，在 v2 方案技术栈基础上落地"CSS 变量单源 → AntD token / Tailwind / ECharts 三方同步 → 毛玻璃业务组件"四层架构，P0 亮色全量交付，P1 暗色平滑预留。*
