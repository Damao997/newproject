# 浙江壹品慧财年经营数据分析平台 — UI设计规范 v2.0（macOS 风格增强版）

> **版本**：v2.0（macOS 风格增强版）
> **触发条件**：AI 编写前端页面 / 组件 / 样式 / 图表 / 主题切换 / 前端动画(Framer Motion) / 图标(Lucide) 时，以本文档 + `references/frontend.md` 为 UI 权威参考
> **自包含**：AI 阅读本文档后，可独立完成所有 UI 层面的开发工作
> **适用范围**：色彩体系 + 布局与间距 + 图表数据可视化 + 亮/暗双主题切换 + 流体交互动画 + 组件命名
> **优先级**：亮色主题 P0（主交付） / 暗色主题 P1（后补）
> **增强规范**：技术上以《前端开发规范（模块 4 - macOS 风格增强版）》（`references/frontend.md`）为权威增强依据。本文档保留详细设计令牌（色板 / CSS 变量 / 组件 / 图表 / 主题切换），并新增第十二章对齐动画引擎、图标库、组件命名与测试要求。
> **产出**：产品经理 许清楚（设计规范）+ 架构师 高见远（技术方案）

---

## 一、设计原则与风格定位

### 1.1 核心定位

将 iOS 毛玻璃美学引入财务数据后台，**在保证数据可读性与专业感的前提下提升视觉品质**。财务平台的核心价值是"准确呈现数据"，因此毛玻璃效果是**服务于层级区分与视觉呼吸感**的手段，而非目的。

### 1.2 数据可读性优先

| 原则 | 说明 |
|------|------|
| **数据可读性 > 视觉装饰** | 涉及精确数值读取的区域（表格单元格、KPI 数字、图表数据点）必须保持高对比度纯色或极弱透明背景，毛玻璃仅用于容器外壳 |
| **层级靠透明度+模糊度区分** | 背景层（渐变底色）→ 容器层（毛玻璃卡片 0.6-0.75 透明 + blur 20-30px）→ 内容层（表格/图表内白底或近白底 0.85-0.95 透明） |
| **克制模糊半径** | 财务场景 blur 控制在 16-30px，避免过度模糊导致文字边缘发虚；移动端可适当降低 |
| **彩色渐变作为氛围而非主体** | 渐变背景仅出现在页面留白处，被卡片覆盖后透出的色彩量需可控，不喧宾夺主 |

### 1.3 "包壳不包肉"原则

**使用毛玻璃的场景（容器级）：**

- 侧边栏、顶部导航栏（始终毛玻璃，固定吸顶/吸左）
- 页面级内容卡片（KPI 卡、图表卡、表格容器卡）
- 弹窗 Modal / 抽屉 Drawer 的遮罩与面板
- 登录页登录卡片
- 浮动通知 / 灵动岛风格状态胶囊

**不使用毛玻璃的场景（内容级，改用半透明纯色或纯色）：**

- 密集数据表格的**表头行与数据行内部背景**——使用 `rgba(255,255,255,0.85-0.92)` 近白半透明，**不施加 backdrop-filter**，保证数字清晰
- 表格单元格内文字、数字——纯色文字，无透明
- 富文本编辑器（TipTap）编辑区——纯白/近白底，避免模糊干扰排版
- 图表 canvas 绘图区内部——纯色或极弱透明，毛玻璃仅作用于图表外层卡片
- 表单输入框聚焦态——纯白底 + iOS 蓝色聚焦边框

> **核心口诀**：毛玻璃包"壳"，不包"肉"。壳是容器卡片/导航/弹窗；肉是表格行、数字、图表、编辑区。

### 1.4 红正绿负色标约定

中国市场惯例：正数（涨/盈利）用红色，负数（跌/亏损）用绿色。本规范**保持此惯例**，但色值统一替换为 iOS 系统色，使整体风格协调：

| 业务含义 | 新色值（iOS） | 说明 |
|---------|-------------|------|
| 正数 / 涨 / 盈利 | **#FF3B30**（iOS Red） | 饱和度更柔和 |
| 负数 / 跌 / 亏损 | **#34C759**（iOS Green） | — |
| 平 / 持平 | **#8E8E93**（iOS Gray） | 中性灰 |

**注意**：iOS Blue #007AFF 作为 Primary 主色用于按钮/链接/选中态，**不与"红涨绿跌"冲突**——主色用于交互，涨跌色用于数值语义，两者职责分离。

---

## 二、色板规范

### 2.1 亮色主题完整色板（P0）

#### 2.1.1 主色与辅助色

| 色名 | HEX | RGB | 用途 |
|------|-----|-----|------|
| Primary（iOS Blue） | #007AFF | 0, 122, 255 | 主按钮、链接、选中态、Focus 边框、Active 导航项 |
| Green（iOS Green） | #34C759 | 52, 199, 89 | 负数/跌/亏损数值、成功状态 |
| Red（iOS Red） | #FF3B30 | 255, 59, 48 | 正数/涨/盈利数值、错误/危险状态 |
| Orange（iOS Orange） | #FF9500 | 255, 149, 0 | 警告、待处理、中等优先级 Tag |
| Purple（iOS Purple） | #5856D6 | 88, 86, 214 | 辅助分类、图表第二序列、特殊标记 |
| Pink（iOS Pink） | #FF2D92 | 255, 45, 146 | 辅助分类、图表序列、高亮强调 |
| Teal（iOS Teal） | #30B0C7 | 48, 176, 199 | 图表序列补充色 |
| Yellow（iOS Yellow） | #FFCC00 | 255, 204, 0 | 提示、图表序列 |
| Gray（iOS Gray） | #8E8E93 | 142, 142, 147 | 中性、禁用、次要信息 |

#### 2.1.2 状态色

| 状态 | 色名 | HEX | 用途 |
|------|------|-----|------|
| Success | iOS Green | #34C759 | 操作成功、导入成功、健康状态 |
| Warning | iOS Orange | #FF9500 | 警告提示、阈值临近 |
| Error | iOS Red | #FF3B30 | 错误、失败、超阈值、危险操作 |
| Info | iOS Blue | #007AFF | 信息提示、进行中 |

#### 2.1.3 背景色（页面渐变 + 毛玻璃层）

| 色名 | HEX | 用途 |
|------|-----|------|
| 渐变起点（浅蓝） | #E3F0FF | 页面渐变背景左上 |
| 渐变中点（浅紫） | #EDE7FF | 页面渐变背景中部 |
| 渐变中点2（浅粉） | #FFE9F3 | 页面渐变背景右下偏移 |
| 渐变终点（浅青） | #E0F7F4 | 页面渐变背景右下 |
| 毛玻璃卡片底色 | rgba(255,255,255,0.65) | 卡片/导航半透明白底 |
| 内容层底色 | rgba(255,255,255,0.90) | 表格/图表内近白底 |

> 渐变方向：`linear-gradient(135deg, #E3F0FF 0%, #EDE7FF 40%, #FFE9F3 75%, #E0F7F4 100%)`，四色柔和过渡，角度 135°。渐变需固定在视口（`background-attachment: fixed`），滚动时保持稳定。

#### 2.1.4 文字色

| 色名 | HEX | 用途 |
|------|-----|------|
| 主文字 | #1C1C1E | 标题、表格数字、正文主体 |
| 次要文字 | #3A3A3C | 次要说明、表头副标题 |
| 辅助文字 | #8E8E93 | 占位符、提示、时间戳 |
| 禁用文字 | #C7C7CC | 禁用态 |
| 反白文字 | #FFFFFF | 深色按钮/Tag 上文字、主色按钮文字 |

#### 2.1.5 边框与分割线

| 色名 | 色值 | 用途 |
|------|------|------|
| 卡片边框 | rgba(255,255,255,0.6) | 毛玻璃卡片 1px 半透明白边框，增强浮层感 |
| 分割线 | rgba(60,60,67,0.12) | 表格行分割线、卡片内分隔 |
| 输入框边框（默认） | rgba(60,60,67,0.18) | 表单输入框默认态 |
| 输入框边框（聚焦） | #007AFF | Focus 态 iOS 蓝 |
| 选中态背景 | rgba(0,122,255,0.1) | 选中行/选中项淡蓝底 |

#### 2.1.6 图表色板（ECharts C1-C10）

| 序号 | HEX | 用途 |
|------|-----|------|
| C1 | #007AFF | 主序列（iOS Blue） |
| C2 | #FF3B30 | 第二序列 / 涨 |
| C3 | #34C759 | 第三序列 / 跌 |
| C4 | #FF9500 | 第四序列 |
| C5 | #5856D6 | 第五序列 |
| C6 | #FF2D92 | 第六序列 |
| C7 | #30B0C7 | 第七序列 |
| C8 | #FFCC00 | 第八序列 |
| C9 | #AF52DE | 第九序列（紫罗兰补充） |
| C10 | #64D2FF | 第十序列（浅蓝补充） |

> 图表网格线：`rgba(60,60,67,0.08)`；坐标轴文字：`#3A3A3C`；图例文字：`#1C1C1E`。

### 2.2 暗色主题（P1，预留方向）

| 维度 | 暗色适配原则 |
|------|-------------|
| 渐变背景 | 改为深色低饱和渐变（如 #1C1C1E → #2C2C2E → #1A1A2E），四色保留色相但亮度降至 15-25% |
| 毛玻璃透明度 | 透明度**降低**至 0.4-0.55（暗色下高透明会糊成一团），blur 提升至 30-40px |
| 卡片底色 | rgba(40,40,42,0.6)（iOS 深灰半透明） |
| 文字色 | 主文字 #F2F2F7、次要 #AEAEB2、辅助 #8E8E93 |
| 涨跌色 | 保持 #FF3B30 / #34C759 不变（在暗底上对比度足够） |
| 图表网格线 | rgba(255,255,255,0.08) |
| 边框 | rgba(255,255,255,0.12) |
| 主色/状态色/图表色板 | C1-C10 保持不变（iOS 暗色模式下强调色不变），仅背景与文字翻转 |

### 2.3 涨跌色标汇总

| 业务语义 | 色值 | 应用 |
|---------|------|------|
| 涨/正数/盈利 | #FF3B30（iOS Red） | 数值文字、Tag、图表柱/线 |
| 跌/负数/亏损 | #34C759（iOS Green） | 数值文字、Tag、图表柱/线 |
| 持平 | #8E8E93（iOS Gray） | 数值文字 |

---

## 三、布局与间距规范

### 3.1 整体布局结构

- **侧边栏**：宽 220px（展开）/ 64px（折叠），毛玻璃 `rgba(255,255,255,0.7)` + `backdrop-filter: blur(24px)`，固定左侧
- **顶部导航栏**：高 56px，毛玻璃 `rgba(255,255,255,0.7)` + `backdrop-filter: blur(24px)`，固定吸顶
- **内容区**：页面渐变背景（固定），内容卡片浮于其上

### 3.2 间距规格

| 间距项 | 数值 |
|--------|------|
| 页面左右边距 | 24px |
| 页面顶部边距 | 56px（导航高）+ 24px |
| 卡片间距 | 16px |
| 卡片内边距 | 20px |
| 组件间距 | 12px |
| 表格单元格内边距 | 12px x 10px |
| 表头行高 | 44px |
| 数据行高 | 40-48px |
| 模块区块间距 | 24px |

### 3.3 表格密度（三层模式）

采用**"毛玻璃壳 + 近白表格芯"**双层结构：

- 外层容器卡片：毛玻璃 `rgba(255,255,255,0.65)` + `blur(24px)` + 圆角 20px
- 表格本体背景：`rgba(255,255,255,0.92)` 近白半透明，不加 backdrop-filter
- 表头行：`rgba(0,122,255,0.06)` 淡蓝底
- 数据行：奇数行 `rgba(255,255,255,0.6)` / 偶数行 `rgba(255,255,255,0.85)`
- 行 Hover：`rgba(0,122,255,0.08)` / 选中：`rgba(0,122,255,0.12)`
- 密度切换：
  - 紧凑档（36px）— `size="small"` + `cellPaddingBlock: 8`
  - 标准档（44px）— `size="middle"` + `cellPaddingBlock: 10`
  - 舒适档（52px）— `size="large"` + `cellPaddingBlock: 14`

### 3.4 圆角系统

| 元素 | 圆角 |
|------|------|
| 卡片 | 20px |
| 大按钮 | 12px |
| 小按钮 | 10px |
| 输入框 | 10px |
| Tag | 8px |
| 胶囊（灵动岛风格） | 999px |
| 头像 | 999px |

### 3.5 阴影系统

| 层级 | 阴影值 |
|------|--------|
| 卡片默认 | `0 2px 12px rgba(0,0,0,0.06)` |
| 卡片 Hover | `0 4px 20px rgba(0,0,0,0.1)` |
| 弹窗/抽屉 | `0 12px 48px rgba(0,0,0,0.16)` |
| 导航栏 | `0 1px 0 rgba(0,0,0,0.04)` |
| 主按钮 | `0 2px 8px rgba(0,122,255,0.3)` |

---

## 四、CSS 变量体系

### 4.1 完整 CSS 变量定义

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

### 4.2 tokens.ts 常量单源机制

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

### 4.3 三层主题一致性策略

**常量单源 + 双向同步**：

1. **色板常量单源**：`tokens.ts` 用 TS `as const` 定义全部色值及 dark 变体，JS 侧唯一来源。
2. **CSS 变量由常量对齐**：`variables.css` 的 `:root` / `.dark` 值与 `tokens.ts` 一一对应。运行时 Tailwind utility / glass.css / inline-style 统一 `var(--color-*)`。
3. **AntD token 引用常量**：`lightTheme.ts` 直接 `import { PALETTE } from './tokens'`，hex 一致，AntD 色彩运算可用。
4. **ECharts theme 引用常量**：`echartsLightTheme.ts` 同样 `import { CHART_COLORS, TEXT } from './tokens'`。
5. **切换一致性**：亮→暗仅需三步 — (1) `documentElement.classList.toggle('dark')`；(2) `ConfigProvider` 换 `darkTheme`；(3) ECharts 实例 `setOption(merge)` 重绘。三者读取同一套 `tokens.dark`，天然一致。

### 4.4 变量命名规范

| 分类 | 命名格式 | 示例 |
|------|---------|------|
| 色彩 | `--color-{语义}` | `--color-primary`, `--color-success` |
| 背景 | `--bg-{语义}`, `--glass-bg`, `--content-bg`, `--table-*-bg` | `--bg-gradient`, `--table-row-hover` |
| 文字 | `--text-{层级}` | `--text-primary`, `--text-secondary` |
| 边框 | `--border-color`, `--glass-border` | — |
| 阴影 | `--shadow-{场景}` | `--shadow-card`, `--shadow-modal` |
| 圆角 | `--radius-{场景}` | `--radius-card`, `--radius-capsule` |
| 模糊 | `--blur-{场景}` | `--blur-card`, `--blur-modal` |
| 图表 | `--grid-line` | — |

> 命名一律小写连字符；语义优先于色相（`--color-success` 而非 `--color-green`），便于暗色复用。

---

## 五、Ant Design 5 ConfigProvider Token

### 5.1 亮色主题 token 配置

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
    colorTextBase:   TEXT.light.primary,
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
    Tooltip: { colorBgSpotlight: 'rgba(255,255,255,0.85)', colorTextLightSolid: TEXT.light.primary },
    Menu:   { itemBg: 'transparent', itemSelectedBg: 'rgba(0,122,255,0.12)', itemSelectedColor: PALETTE.primary },
    Segmented: { itemSelectedBg: '#FFFFFF', trackBg: 'rgba(0,0,0,0.04)', borderRadius: RADIUS.capsule, borderRadiusSM: RADIUS.capsule },
  },
};
```

### 5.2 暗色主题 token 预留（P1）

```ts
// web/src/theme/darkTheme.ts (P1)
import type { ThemeConfig } from 'antd';
import { PALETTE, TEXT, RADIUS, FONT_FAMILY } from './tokens';

export const darkTheme: ThemeConfig = {
  algorithm: undefined, // P1 接入时改为 theme.darkAlgorithm
  token: {
    colorPrimary: PALETTE.primary, colorSuccess: PALETTE.success,
    colorError: PALETTE.error, colorWarning: PALETTE.warning,
    colorTextBase: TEXT.dark.primary, colorBgBase: '#1C1C1E',
    colorText: TEXT.dark.primary, colorTextSecondary: TEXT.dark.secondary,
    colorTextTertiary: TEXT.dark.tertiary, colorTextDisabled: TEXT.dark.disabled,
    borderRadius: RADIUS.input, borderRadiusLG: RADIUS.card, borderRadiusSM: RADIUS.tag,
    fontSize: 14, fontFamily: FONT_FAMILY,
  },
  components: {
    Modal:  { contentBg: 'rgba(40,40,42,0.8)', headerBg: 'transparent' },
    Drawer: { contentBg: 'rgba(40,40,42,0.8)', headerBg: 'transparent' },
    Card:   { colorBgContainer: 'transparent' },
    Table:  { headerBg: 'rgba(0,122,255,0.12)', rowHoverBg: 'rgba(0,122,255,0.16)' },
    // 其余与 light 对称，P1 时补全
  },
};
```

### 5.3 ConfigProvider 动态切换实现

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

## 六、Tailwind CSS 配置

### 6.1 tailwind.config.ts

```ts
// web/tailwind.config.ts
import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: { preflight: false }, // 关闭 preflight，避免覆盖 AntD 基础样式
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

### 6.2 glass.css 工具类

```css
/* web/src/theme/glass.css */

/* === .glass-card === */
.glass-card {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--blur-card)) saturate(1.8);
  -webkit-backdrop-filter: blur(var(--blur-card)) saturate(1.8);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-card);
  box-shadow: var(--shadow-card);
  will-change: backdrop-filter;
  transform: translateZ(0);
  transition: box-shadow 0.25s ease, transform 0.25s ease;
}
.glass-card:hover {
  box-shadow: var(--shadow-hover);
  transform: translateY(-2px);
}

/* === .glass-nav（侧边栏/顶部栏） === */
.glass-nav {
  background: var(--glass-bg);
  backdrop-filter: blur(var(--blur-card)) saturate(1.8);
  -webkit-backdrop-filter: blur(var(--blur-card)) saturate(1.8);
  border-right: 1px solid var(--glass-border);  /* 侧边栏 */
  /* 顶部栏改 border-bottom: 1px solid var(--glass-border); */
  box-shadow: var(--shadow-card);
  position: sticky;
  z-index: 100;
  will-change: backdrop-filter;
  transform: translateZ(0);
}

/* === .glass-modal（弹窗/抽屉面板） === */
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

/* === .glass-tooltip（ECharts Tooltip） === */
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

/* === 降级方案：不支持 backdrop-filter 时降级为纯色半透明 === */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass-card, .glass-nav, .glass-modal, .glass-tooltip {
    background: var(--content-bg);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

/* === 性能模式：data-perf="low" 时全局关闭模糊 === */
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

### 6.3 preflight 说明

- `corePlugins: { preflight: false }`：Tailwind 不注入 reset，避免覆盖 AntD 基础样式。
- 盒模型 `box-sizing: border-box` 由 AntD 全局样式保证；如需可手动在 `index.css` 补 `*,*::before,*::after{box-sizing:border-box}`。
- `.glass-*` 通过 `@layer utilities` 注入，优先级低于 AntD 组件样式但可被业务 className 覆盖。

---

## 七、毛玻璃组件封装（8 个组件）

### 7.1 GlassCard — 通用毛玻璃卡片容器

**用途**：统一包装所有页面卡片（KPI 卡、图表卡、表格容器卡）。

**关键 Props**：

```tsx
interface GlassCardProps {
  title?: React.ReactNode;
  extra?: React.ReactNode;       // 右上操作区
  padding?: number;              // 默认 20
  hoverable?: boolean;           // 是否启用 hover 抬升，默认 true
  children: React.ReactNode;
  className?: string;
}
```

**关键实现**：外层 `div.glass-card`，标题区 `border-b glass-border`，内容区 `bg-transparent`。

### 7.2 GlassTable — 毛玻璃壳 + 近白表格芯双层表格

**用途**：所有数据表格的容器，解决密集表格的毛玻璃性能与可读性问题。

**关键 Props**：

```tsx
interface GlassTableProps<T> extends TableProps<T> {
  density?: 'compact' | 'standard' | 'comfortable'; // 36/44/52px 行高
  glassShell?: boolean; // 默认 true，外层毛玻璃壳
}
```

**关键实现**：

```tsx
export function GlassTable<T>({ density = 'standard', glassShell = true, ...props }: GlassTableProps<T>) {
  const sizeMap = { compact: 'small', standard: 'middle', comfortable: 'large' } as const;
  const padMap = { compact: 8, standard: 10, comfortable: 14 };
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

> **核心价值**：外层 1 个 blur 元素 + 内层近白纯色芯，同时解决性能（blur 从 N 行收敛为 1 个）与可读性（数字清晰）。

### 7.3 GlassNav — 毛玻璃侧边栏/顶部栏

**用途**：侧边栏与顶部导航栏的毛玻璃容器。

**关键 Props**：

```tsx
interface GlassNavProps {
  collapsed: boolean;            // 折叠态 64px / 展开 220px
  position: 'side' | 'top';
  children: React.ReactNode;
}
```

**关键实现**：`aside.glass-nav`，宽度 `transition 0.2s`，`position: 'side'` 用 `border-r`，`'top'` 用 `border-bottom`。

### 7.4 GlassModal — 毛玻璃弹窗

**用途**：所有 Modal 弹窗的毛玻璃皮肤。

**Props**：`extends ModalProps`。

**关键实现**：

```tsx
<Modal className="glass-modal" maskClassName="glass-mask" {...props} />
```

通过 ConfigProvider Modal token `contentBg=rgba(0.8)` + className `blur` 双保险。

### 7.5 GlassDrawer — 毛玻璃抽屉

**用途**：所有 Drawer 抽屉的毛玻璃皮肤。

**Props**：`extends DrawerProps`。

**关键实现**：

```tsx
<Drawer className="glass-modal" {...props} />
```

### 7.6 GlassTooltip — ECharts 毛玻璃 Tooltip

**用途**：ECharts 图表 hover 时的毛玻璃 tooltip。

**关键实现**：非独立 React 组件，而是 ECharts theme 配置中的 tooltip 节。业务侧只需：

```ts
option.tooltip = {
  confine: true,
  backgroundColor: 'rgba(255,255,255,0.85)',
  borderColor: 'rgba(255,255,255,0.5)',
  borderRadius: 12,
  extraCssText: 'backdrop-filter: blur(16px) saturate(1.8); -webkit-backdrop-filter: blur(16px) saturate(1.8); box-shadow: 0 2px 12px rgba(0,0,0,0.06);',
};
```

### 7.7 SegmentedControl — iOS 风格分段控制器

**用途**：Tab 切换场景（如财务指标表格的期间维度切换）。

**关键 Props**：

```tsx
interface SegmentedControlProps {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
  block?: boolean; // 是否撑满父容器
}
```

**关键实现**：AntD Segmented，token 已定制 `trackBg=rgba(0,0,0,0.04)` + `itemSelectedBg=#FFF` + `borderRadius=capsule`。外层包一层 `.glass-card` 浅底（rgba 0.5）增强 iOS 质感。

### 7.8 StatusCapsule — 灵动岛风格状态胶囊

**用途**：顶部通知、状态提示的胶囊样式。

**关键 Props**：

```tsx
interface StatusCapsuleProps {
  type?: 'success' | 'error' | 'warning' | 'info';
  children: React.ReactNode;
  pulse?: boolean; // 灵动岛呼吸动画
}
```

**关键实现**：`span` 标签，`rounded-capsule px-3 py-1 text-xs` 外加 `.glass-card` 底。`pulse` 时加 `@keyframes` 呼吸动画（scale 1->1.02）。

---

## 八、ECharts 主题配置

### 8.1 亮色 ECharts 主题（完整）

```ts
// web/src/theme/echartsLightTheme.ts
import { CHART_COLORS, TEXT } from './tokens';

export const echartsLightTheme = {
  color: [...CHART_COLORS], // C1-C10
  backgroundColor: 'transparent', // 透明，由卡片容器提供近白底
  textStyle: {
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
    color: TEXT.light.secondary,
  },
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

### 8.2 暗色 ECharts 主题预留（P1）

```ts
// web/src/theme/echartsDarkTheme.ts (P1)
import { echartsLightTheme } from './echartsLightTheme';
import { TEXT } from './tokens';

export const echartsDarkTheme = {
  ...echartsLightTheme,
  textStyle: { ...echartsLightTheme.textStyle, color: TEXT.dark.secondary },
  categoryAxis: {
    ...echartsLightTheme.categoryAxis,
    axisLine: { lineStyle: { color: 'rgba(255,255,255,0.16)' } },
    axisLabel: { color: TEXT.dark.secondary },
    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
  },
  valueAxis: {
    ...echartsLightTheme.valueAxis,
    axisLabel: { color: TEXT.dark.secondary },
    splitLine: { lineStyle: { color: 'rgba(255,255,255,0.08)' } },
  },
  legend: { textStyle: { color: TEXT.dark.primary } },
  tooltip: {
    backgroundColor: 'rgba(40,40,42,0.85)',
    borderColor: 'rgba(255,255,255,0.08)',
    textStyle: { color: TEXT.dark.primary },
  },
  // color 数组不变
};
```

### 8.3 主题注册与动态注入

```ts
// web/src/theme/echartsSetup.ts
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { echartsLightTheme, echartsDarkTheme } from './index';

echarts.use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);
echarts.registerTheme('ios-light', echartsLightTheme as any);
echarts.registerTheme('ios-dark', echartsDarkTheme as any);

export { echarts };
```

```tsx
// 图表组件中切换重绘（echarts-for-react）
<ReactECharts
  ref={chartRef}
  echarts={echarts}
  theme={currentTheme === 'dark' ? 'ios-dark' : 'ios-light'}
  option={option}
  notMerge={false}
/>
```

> 主题切换时：`themeStore` 变化 → `currentTheme` 变化 → `ReactECharts` 重新 `init(theme)` + `setOption(option)`。已有实例可通过 `chartRef.getEchartsInstance().dispose()` 后重新 init 保证 theme 生效。

### 8.4 图表卡片双层结构（关键）

图表 canvas 透明会透出渐变背景导致网格线对比度不足。必须采用**"玻璃壳 + 近白芯"**双层结构：

```tsx
<div className="glass-card p-5">
  <div className="chart-core rounded-[var(--radius-card)] bg-[var(--content-bg)] p-3">
    <ReactECharts theme="ios-light" option={option} />
  </div>
</div>
```

- canvas 区近白底，不依赖父级 `backdrop-filter` 透传
- 近白底保证坐标轴文字（#3A3A3C）可读性
- 与"包壳不包肉"原则一致

### 8.5 图表类型规格

| 图表类型 | 规格 |
|---------|------|
| sparkline（迷你图） | 无坐标轴，折线 2px iOS 蓝，渐变填充 |
| 趋势折线图 | 主线 iOS 蓝 2.5px + 区域渐变填充 |
| 柱状图 | 圆角柱 `barBorderRadius [6,6,0,0]` |
| 堆叠柱状图 | C1-C5，每段圆角顶部 |
| 饼图 | C1-C8，扇间 2px 白色间隙 |

---

## 九、主题切换架构

### 9.1 Zustand themeStore（persist）

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

### 9.2 切换完整数据流（5 步）

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

### 9.3 切换过渡动画

```css
/* 全局过渡：颜色类属性 0.3s，避免布局抖动 */
html.theme-transition,
html.theme-transition * {
  transition: background-color 0.3s ease, color 0.3s ease,
              border-color 0.3s ease, box-shadow 0.3s ease;
}
```

> 实现细节：toggle 时 `root.classList.add('theme-transition')`，`setTimeout(300ms)` 后移除。ECharts canvas 不受 CSS transition 影响，靠 setOption 重绘。

### 9.4 系统主题跟随（P1 预留）

```ts
// 监听 prefers-color-scheme，首次访问无 localStorage 时跟随系统
const mql = window.matchMedia('(prefers-color-scheme: dark)');
if (!localStorage.getItem('theme')) {
  useThemeStore.getState().setTheme(mql.matches ? 'dark' : 'light');
}
mql.addEventListener('change', (e) => {
  if (!userOverride) useThemeStore.getState().setTheme(e.matches ? 'dark' : 'light');
});
```

### 9.5 性能降级

```css
/* data-perf="low" 时全局关闭模糊——5.5 已定义 */
/* 低端设备自动检测：navigator.hardwareConcurrency < 4 时 perfMode 自动设为 'low' */
```

### 9.6 打印样式

```css
/* @media print 强制纯白——已在 variables.css 末尾定义 */
```

---

## 十、组件视觉规范（按模块）

### 10.1 登录页

- 全屏渐变背景 + 居中毛玻璃登录卡片（400px 宽，blur 30px，圆角 24px）
- iOS 蓝登录按钮
- 输入框聚焦态 iOS 蓝边框

### 10.2 首页看板

- KPI 卡片：毛玻璃 + 指标名 14px + 主数值 28px + 涨跌胶囊 Tag + sparkline 迷你图
- 趋势图卡片：毛玻璃壳 + 内层图表区近白底（双层结构）
- 快捷入口：胶囊形 chip，毛玻璃底

### 10.3 财务指标表格

- Tab 切换：iOS 风格 SegmentedControl（毛玻璃底 + 选中项白色滑块）
- 表格双层结构（壳毛玻璃 + 芯近白）
- 数值列居中对齐，涨跌红正绿负染色
- Tag：圆角 8px，半透明底色

### 10.4 分析报告（TipTap）

- 报告容器卡片：毛玻璃壳
- 编辑区：**纯白底** rgba(255,255,255,0.95)，不加 backdrop-filter
- 工具栏：毛玻璃胶囊条

### 10.5 弹窗 Modal / 抽屉 Drawer

- 遮罩：rgba(0,0,0,0.25) + blur(4px)
- 面板：毛玻璃 rgba(255,255,255,0.8) + blur(30px) + 圆角 20px

### 10.6 导航

- 侧边栏：毛玻璃 + Active 项 iOS 蓝文字 + 淡蓝底 + 左侧 3px 指示条
- 顶部栏：毛玻璃 + 面包屑 + 搜索框 + 用户头像 + 主题切换开关

### 10.7 通知

- 灵动岛风格圆角胶囊（999px），毛玻璃底 + 状态色文字，从顶部居中下沉

---

## 十一、前端展示规范

### 11.1 数值单位展示规则

| 模块 | 展示格式 | 说明 |
|------|---------|------|
| 首页看板 | `1,234.56 万` | 金额除以 10000，带"万"后缀 |
| 财务指标 | `1,234.56` | 金额除以 10000，无后缀（纯数值对比） |
| 数据浏览 | `1,234.56` | 同财务指标，纯数值 |
| 数据管理其他 | `1,234.56` | 统一万元数值，无后缀 |

**实现函数**（`web/src/lib/utils.ts`）：
- `formatMoney(value)` → 万元 + "万" 后缀（首页看板）
- `formatMoneyWan(value)` → 万元纯数值（财务指标/数据管理）

### 11.2 表格对齐规范

| 列类型 | 对齐方式 |
|--------|---------|
| 指标名称/科目名称 | **左对齐** |
| 数值列（金额、百分比） | **居中对齐** |
| 操作列 | **居中对齐** |

### 11.3 数值精度

- **金额**：保留 2 位小数
- **百分比**（同比/环比/达成率）：保留 2 位小数
- **变动标识**：正数变动显示 `+` 前缀，红色 Tag；负数变动显示 `-` 前缀，绿色 Tag
- **色标方向**：固定为 cn（红涨绿跌），色值使用 iOS Red #FF3B30 / iOS Green #34C759

### 11.4 AI 润色交互流程（5 阶段）

| 交互阶段 | 前端行为 |
|----------|----------|
| 1. 选中文本 | 用户在 TipTap 编辑器中选中要润色的段落 |
| 2. 触发润色 | 点击工具栏"AI 润色"按钮，选择风格（正式/简明/通俗） |
| 3. 流式预览 | 右侧浮层/侧边栏 SSE 流式展示润色结果（不覆盖编辑器原文） |
| 4. 确认/取消 | 用户对比原文与润色结果：确认→替换原文；取消→保留原文 |
| 5. 多次润色 | 可对同一段落多次润色（每次都是基于原文，非叠加） |

> **禁止行为**：AI 流式输出不得直接覆盖编辑器内容，必须通过预览→确认流程。

### 11.5 AI 追加分析展示规范

| 展示要素 | 说明 |
|----------|------|
| **ai_suggested 标识** | AI 生成的段落旁显示图标标识 |
| **免责声明** | 段落底部固定显示"本段内容由 AI 辅助生成，最终数据以指标表为准" |
| **数据来源标注** | AI 文本引用数值时标注"据指标表显示" |
| **HTML 标记** | AI 生成内容包裹在 `<div data-ai-suggested="true">...</div>` 中 |

### 11.6 前端权限控制

| 展示要素 | 说明 |
|----------|------|
| **按钮级权限** | 前端通过 `hasPermission('data:import:upload')` 判断按钮可见性。无权限的按钮隐藏或禁用 |
| **菜单级权限** | 前端通过 `hasPermission('admin:users:view')` 判断菜单项可见性 |
| **路由级权限** | 前端路由守卫校验用户是否有该页面的 view 权限，无权限跳转 403 页面 |
| **权限缓存** | [P2-S1 预留] 登录后前端一次性拉取用户完整权限列表，存入 Zustand authStore |

---

## 十二、macOS 风格增强对齐（模块 4 前端开发规范 / references/frontend.md）

> 本章为 2026-07-20 文档对齐内容，将《前端开发规范（模块 4 - macOS 风格增强版）》（`references/frontend.md`）的要求落到本 UI 设计规范，确保文档库一致。**仅文档同步，代码实现见后续排期。** 本文档的视觉令牌（色板 / 圆角 / 玻璃工艺 / 阴影）与 frontend.md §2 完全一致，本章只补充"新增项"与"调整项"。

### 12.1 风格语言升级（iOS 毛玻璃 → macOS 风格增强版）

- 设计语言由 iOS 毛玻璃升级为 **macOS Big Sur / Monterey** 风格，强调"通透感 / 层级感 / 原生质感"。
- **视觉令牌不变**：主色 iOS Blue `#007AFF`、涨跌色 `#FF3B30`/`#34C759`（红涨绿跌）、圆角体系（卡片 20 / 按钮 12 / 输入 10 / 胶囊 999）、玻璃工艺（`blur(24px) saturate(180%)` + `rgba(255,255,255,0.65)` 亮 / `rgba(30,30,30,0.65)` 暗）均维持原样。
- 玻璃容器高阶描边：亮色 `1px solid rgba(255,255,255,0.4)`，暗色 `1px solid rgba(255,255,255,0.12)`（模拟光线折射，见 variables.css `--glass-border`）。

### 12.2 动画引擎：Framer Motion（新增，替代部分 CSS Transition）

- **用途**：布局动画、弹簧物理效果、手势交互，承担原本由 CSS Transition 实现的流体交互。
- **微交互**：
  - 点击反馈：所有可点击元素 `whileTap={{ scale: 0.96 }}`，模拟物理按压。
  - Hover 反馈：卡片/按钮 `whileHover` 轻微上浮 `y: -2px` 并增强阴影。
  - 加载状态：骨架屏（Skeleton）配合呼吸动画，**禁止**旋转 Spinner。
- **过渡动画**：
  - 统一缓动：`cubic-bezier(0.32, 0.72, 0, 1)`（Expo Ease Out，非线性加速减速）。
  - 页面切换：淡入淡出 `opacity` + 轻微位移 `y: 10px -> 0`。
  - 模态框弹出：`scale: 0.95 -> 1` + `opacity: 0 -> 1`，时长 250ms。
  - 列表增删：使用 `LayoutAnimation`，删除项时后续项平滑上移填补空缺。
- **滚动与导航**：启用 CSS `scroll-behavior: smooth`；自定义宽 6px 半透明滚动条，默认隐藏、滚动时显示，Hover 变不透明灰。

### 12.3 图标库：Lucide React（新增，贴近 SF Symbols）

- **定位**：线条风格更接近 macOS SF Symbols，比 Ant Design 默认图标更精致圆润，用于工具栏 / 导航 / 状态图标，尺寸 16px / 20px。
- **共存策略**：复杂业务图标（如 ProTable 内置、表单校验态）保留 `@ant-design/icons`；**不强制全量替换**。

### 12.4 Tailwind 插件：tailwindcss-animate

- 新增 `tailwindcss-animate` 插件，提供 macOS 风格缓动 / 进入退出动画工具类；`tailwind.config.ts` 的 `plugins` 由 `[]` 改为注册该插件。

### 12.5 组件命名对齐（新增 MacOSCard / GlassSidebar；WindowHeader 已移除）

frontend.md 引入新基础布局组件名，与本文档既有 `Glass*` 组件**并存并逐步迁移**：

| 新组件（frontend.md） | 对应既有组件（本文档） | 说明 |
|----------------------|----------------------|------|
| `MacOSCard` | `GlassCard` | 通用毛玻璃卡片容器，强化 macOS 窗口质感 |
| `GlassSidebar` | `GlassNav`（position:'side'） | 毛玻璃侧边栏，选中态圆角矩形 `bg-blue-500/10` + 蓝色文字 |
| ~~`WindowHeader`~~ | （AppLayout 内联头部） | **已移除（2026-07-20 产品决策）**：红绿灯标题栏（关闭/最小化/最大化彩色圆点 + 居中标题）不纳入交付。登录后直接进入「侧边栏 + 顶栏 + 内容区」布局，不再保留 macOS 窗口拟物头部。 |

- 既有 `GlassTable` / `GlassModal` / `GlassDrawer` / `GlassTooltip` / `SegmentedControl` / `StatusCapsule` 继续保留。
- 迁移完成后移除旧 `GlassCard` / `GlassNav`（见 12.8）。
- 移除 WindowHeader 后，顶栏（`GlassNav` position:'top'）承担页面标题与操作入口，详见第十三章 Demo 实现对照。

### 12.6 工程与测试：Vitest（核心逻辑覆盖率 ≥80%）

- 测试框架由"无"升级为 **Vitest**（+ `@testing-library/react` + `@testing-library/jest-dom` + `jsdom`）。
- 目标：核心逻辑（格式化、权限判断、图表 option 构造、主题切换）覆盖率 **≥80%**。
- 命名 / 样式 / 暗色预留 / 内存管理（敏感数据仅存 Zustand 内存态，禁止 localStorage）要求与本文档及 frontend.md §5 一致。

### 12.7 缓动 / 微交互 / 过渡 / 滚动条 / 骨架屏速查

| 维度 | 取值 / 行为 |
|------|------------|
| 缓动函数 | `cubic-bezier(0.32, 0.72, 0, 1)` |
| 点击 | `whileTap scale 0.96` |
| Hover | `whileHover y:-2px` + 阴影增强 |
| 页面切换 | `opacity` 淡入 + `y:10px->0` |
| 模态框 | `scale 0.95->1` + `opacity 0->1`，250ms |
| 列表 | `LayoutAnimation` 平滑上移填补 |
| 滚动条 | 宽 6px，半透明，默认隐藏，滚动显，Hover 不透明灰 |
| 加载 | 骨架屏 + 呼吸动画（禁用 Spinner） |

### 12.8 移除与调整项

- **术语**：统一由"iOS 毛玻璃"升级为"macOS 风格增强版"；颜色命名（iOS Blue / Red / Green）保留不变。
- **图标**：`@ant-design/icons` 不移除，仅新增 Lucide 用于工具栏 / 导航（见 12.3）。
- **待移除（迁移完成后）**：旧 `GlassCard`、`GlassNav`；届时本文档第七章节对应条目标注废弃。
- **已移除（2026-07-20 产品决策）**：`WindowHeader`（红绿灯窗口头部）。前端 Demo 同步删除对应 DOM 与 `.window-header` / `.traffic` / `.light.*` / `.window-title` 全部 CSS，移动端遮罩定位由 `inset: var(--window-header-h) 0 0 0` 修正为 `inset: 0`。详见第十三章。
- **保持不变**：色板、圆角、玻璃工艺、阴影体系、CSS 变量、AntD token、ECharts 主题、Zustand themeStore 主题切换机制（frontend.md 与本文档完全兼容）。

---

## 十三、前端 Demo（纯前端 vanilla 实现）实现对照

> **同步声明（2026-07-20 确立）**：`demo/` 为纯前端交互验证 Demo，**与本文档第一~四、七、十二章的设计令牌严格对齐**。本章为「as-built」实现对照，**与代码 `demo/` 双向同步**：任何对 `demo/` 的样式 / 结构 / 交互改动，必须同步回填本章对应小节。
>
> **技术栈偏差**：Demo 采用原生 **HTML + CSS + JavaScript**，**未引入** React / Ant Design 5 / Tailwind / ECharts / Zustand / Framer Motion。图表用自绘 SVG（`charts.js`）替代 ECharts 主题，图标用自绘 Lucide 风格线性 SVG（`icons.js`，48 枚）替代 Lucide React；动效用原生 CSS `transition` + `@keyframes` 实现与 12.7 等价的缓动 / 微交互。

### 13.1 设计令牌映射（demo `:root` → 规范条款）

| Demo CSS 变量 | 取值 | 对应规范 | 备注 |
|------|------|------|------|
| `--color-primary` | #007AFF | 2.1.1 / 4.1 | iOS Blue，主按钮/选中/Focus |
| `--color-success` / `--color-error` | #34C759 / #FF3B30 | 2.1.2 / 2.3 | **绿跌红涨**（红涨绿跌反直觉但符合中国财务习惯）；`.up`=error 红、`.down`=success 绿 |
| `--color-warning` / `--color-info` | #FF9500 / #007AFF | 2.1.2 | 警告 / 信息 |
| `--color-purple` / `--color-pink` / `--color-teal` / `--color-cyan` / `--color-gray` | 同 2.1.1 | 2.1.1 / 4.1 | 图表辅助色 |
| `--bg-gradient` | `linear-gradient(135deg,#E3F0FF 0%,#EDE7FF 40%,#FFE9F3 75%,#E0F7F4 100%)` | 2.1.3 | 固定视口（`background-attachment:fixed`） |
| `--glass-bg` | rgba(255,255,255,0.65) | 2.1.3 / 4.1 | 卡片毛玻璃底 |
| `--glass-bg-strong` | rgba(255,255,255,0.72) | 3.1（侧/顶栏 0.7 近似） | **Demo 新增**：侧边栏/顶栏用更强毛玻璃 |
| `--content-bg` / `--table-core-bg` | 0.90 / 0.92 | 2.1.3 / 4.1 | 近白内容/表格芯 |
| `--table-header-bg` / `--table-row-odd/even/hover/selected` | 0.06 / 0.60 / 0.85 / 0.08 / 0.12（蓝） | 3.3 | 双层表格 |
| `--text-primary/secondary/tertiary/disabled` | #1C1C1E / #3A3A3C / #8E8E93 / #C7C7CC | 2.1.4 | |
| `--border-glass` / `--border-divider` / `--border-input` | rgba(255,255,255,0.6) / rgba(60,60,67,0.12) / rgba(60,60,67,0.18) | 2.1.5（对应 `--glass-border`/`--border-color`/输入边框） | 命名差异，取值一致 |
| `--radius-card/btn/btn-sm/input/tag/pill` | 20 / 12 / 10 / 10 / 8 / 999 | 3.4 | `--radius-pill` 对应规范 `--radius-capsule` |
| `--shadow-card/card-hover/modal/nav/btn-primary` | 见 3.5 | 3.5 | `--shadow-card-hover`/`--shadow-nav`/`--shadow-btn-primary` 为 Demo 显式命名 |
| `--sidebar-w` / `--sidebar-w-collapsed` / `--topbar-h` | 220 / 64 / 56 | 3.1 | |
| `--ease-mac` | cubic-bezier(0.32,0.72,0,1) | 12.7 | 统一缓动 |

### 13.2 组件实现对照

| 组件（Demo class） | 关键实现（与规范一致处） |
|------|------|
| **登录页** `.login-view` / `.login-card` | 居中卡片 max-width 400px、padding 36/32/28、`pop-in .45s`；`.login-logo-mark` 52px·r14·渐变 `#0A84FF→#007AFF`；输入框 h44、左内距 40（图标位）、Focus 环 `0 0 0 3px rgba(0,122,255,.18)`；主按钮 `.btn-lg` h48、字距 4px |
| **侧边栏/导航** `.sidebar`(`.glass-nav`) / `.nav-item` | w220·折叠 64、边框 `rgba(255,255,255,.5)`、`.glass-bg-strong`；`.nav-item` r12·gap12，**选中态** `rgba(0,122,255,.10)` + 主色文字（与 3.1 `bg-blue-500/10` 等价）、`:active` `scale(.97)`；`.nav-group-label` 11px 三级灰；`.user-chip`/`.avatar` 34px·渐变 `#FF9500→#FF2D92` |
| **顶栏** `.topbar`(`.glass-nav`) | h56、padding 0 20、底边 `rgba(255,255,255,.5)` + `--shadow-nav`；标题 17px/700；`.data-asof` 12px 三级灰；`.menu-toggle` 桌面隐藏、≤900 显示 |
| **KPI 卡片** `.kpi` | 数值 26px/700、标签 13px 三级灰、`.kpi-spark` 高 36px 迷你趋势线；`.kpi-trend` 配 `.up`(红)/`.down`(绿)/`.flat`(灰) |
| **趋势图** `.chart-wrap` | **自绘 SVG**（`charts.js`）：`sparkline` 迷你趋势线、`combo` 收入/成本/毛利 折线+柱状组合（同比/环比切换）、`ring` 环形进度；配色沿用图表色板 C1/C2/C3 |
| **事业部概览** `.bu-track`/`.bu-fill` | 条形 `r999`、填充渐变 `#0A84FF→#007AFF`、`width` 过渡 `.8s` |
| **预警** `.alert-item` | 底 `rgba(255,59,48,.06)`、r12、图标 error 红 |
| **表格（双层）** `.table-card`/`.table-core`/`.gt` | 外层 r16·`overflow:hidden`·`--table-core-bg`·边框 `rgba(255,255,255,.6)`；表头 `sticky` + `--table-header-bg`；单元格 `11px 14px`（规范 12×10 近似）、奇偶行、Hover `0.08`；**合计行** `rgba(0,122,255,.10)` + 顶边 `2px rgba(0,122,255,.3)` |
| **弹窗** `.modal-mask`/`.modal` | 遮罩 `rgba(0,0,0,.28)` + `fade-in .2s`；弹窗 `max-w 480`/`wide 640`、底 `rgba(255,255,255,.78)`、`blur(24px)`、r20、`modal-in .25s scale .95→1`（与 12.7 一致） |
| **Toast** `.toast-root`/`.toast` | 顶部居中（top 16px、z200）、暗色玻璃 `rgba(40,40,42,.82)` + `blur(16px)`、r14、图标按类型着色（success 绿 / error 红 / info 青） |
| **分段控制器** `.segmented`/`.seg-item` | 胶囊底 `rgba(0,0,0,.05)`、激活项 `#fff` + 主色 + 阴影（iOS 风格，等同 7.7） |
| **Tag / 胶囊** `.tag`/`.pill` | r8，变体 blue/green/red/gray/orange；`.pill` r999（灵动岛风格，等同 7.8） |
| **导入拖拽区** `.dropzone` | 虚线 `2px dashed rgba(0,122,255,.35)`、r16；拖拽/悬停态转主色 + `rgba(0,122,255,.06)` |
| **角色卡 / 权限矩阵 / 占位页 / 浮动菜单 / 分页 / 空态** | `.role-grid` auto-fill minmax(220,1fr)；`.matrix` 勾叉配 success/error；`.placeholder` 居中说明；`.menu-pop` 暗玻璃 `rgba(255,255,255,.85)`+`blur(20px)` r12 z120；`.pager` r9、激活主色；`.empty` 居中 |
| **财年滚动对比页** `.fy-pair`/`.fy-yearcard`/`.fy-metric` | 导航新增「财年滚动」（`calendar-clock`）；双卡片(去年/今年)顶边色区分（今年蓝 `--color-primary` / 去年灰 `--text-tertiary`）、`.fy-yeartag` 胶囊、`.fy-metrics` 2 列网格（收入/成本/毛利/费用）；日期选择器 `.fy-date-input` 复用 Focus 环 `0 0 0 3px rgba(0,122,255,.18)`；对比表/自测表复用 `.gt`；通过/失败配 `.ok-pass`(绿)/`.fail`(红)；`.fy-rule` 信息提示条 `rgba(0,122,255,.06)` 底 + 蓝边 |

### 13.3 交互动效状态（Interaction States）

| 状态 | 实现 |
|------|------|
| **Hover** | `.btn` 底 `rgba(255,255,255,.85)`；`.hoverable` `translateY(-2px)` + `--shadow-card-hover`；`.nav-item` `rgba(0,0,0,.05)`；`.icon-btn` `rgba(0,0,0,.06)` |
| **Active（按压）** | `.btn` `scale(.96)`；`.nav-item` `scale(.97)`；`.icon-btn` `scale(.92)`（呼应 12.7 `whileTap scale .96`） |
| **Focus** | 输入框/下拉/搜索：`border-color` 主色 + `box-shadow 0 0 0 3px rgba(0,122,255,.18)` |
| **Disabled** | `.btn:disabled` `opacity .5` + `not-allowed` |
| **显隐切换** | **`[hidden]{display:none!important}`** 全局重置，确保登录/主界面、`scrim`、预览区等 `hidden` 属性真正生效（修复初版 `.login-view`/`.app-view` 的 `display:flex` 覆盖 bug） |
| **页面切换** | `.page` `page-in`：`opacity` 淡入 + `translateY(10px→0)` `.35s`（呼应 12.7） |
| **弹窗/菜单进入** | `modal-in` `scale .95→1` + `opacity` `.25s` / `.15s` |
| **登录卡片** | `pop-in` `scale .95→1` `.45s` |
| **Toast** | `toast-in` `translateY(-12px→0)` `.3s` |
| **滚动条** | WebKit 8px、`rgba(0,0,0,.18)`、Hover `.32`；`.content` `scroll-behavior:smooth` |
| **缓动** | 统一 `--ease-mac: cubic-bezier(0.32,0.72,0,1)`（Expo Ease Out） |

### 13.4 响应式断点（Responsive）

| 断点 | 行为 |
|------|------|
| `> 1100px` | KPI 5 列；`.cols-2`/`cols-2b` 两列；侧边栏常驻展开 |
| `≤ 1100px` | KPI 3 列；`.cols-2`/`cols-2b` 转单列 |
| `≤ 900px` | 显示 `.menu-toggle`；侧边栏转 `fixed` 抽屉（`translateX(-100%)` → `.open` 滑入，`.28s`）；`.scrim` 遮罩 `inset:0` z25；KPI 2 列；`.data-asof` 隐藏；内容 padding 16 |
| `≤ 560px` | KPI 1 列；顶栏标题 15px；卡片 padding 16 |
| 表格 | `.table-scroll` `overflow-x:auto` 横向滚动，移动端不挤压 |

### 13.5 文件结构与运行

```
demo/
├─ index.html          # 登录页 + 应用框架（侧边栏/顶栏/内容）+ 弹窗/Toast 挂载点
├─ css/styles.css      # 完整设计系统（单文件 CSS 变量驱动，见 13.1）
├─ js/
│  ├─ icons.js         # 自绘 Lucide 风格线性图标库（48 枚，16/18/20px）
│  ├─ data.js          # 演示数据（KPI/趋势/指标/用户/批次/科目/权限矩阵…）
│  ├─ charts.js        # 轻量自绘 SVG 图表（sparkline / combo / ring）
│  ├─ views.js         # 各页面 HTML 渲染（纯函数）
│  ├─ fiscal.js        # 财年滚动逻辑（纯函数，浏览器+Node 双兼容）
│  └─ app.js           # 控制器：路由/登录/弹窗/Toast/交互
├─ test/
│  └─ fiscal.test.js   # 财年逻辑 Node 测试（期望 vs 实际，11 项）
└─ server.js           # 本地静态预览（node server.js → http://127.0.0.1:8140/）
```

- 本地预览：`node demo/server.js`，访问 `http://127.0.0.1:8140/`（默认 `admin`/`123456`，任意账号密码可登，角色仅影响功能可见性）。
- 云端持久预览：已部署 CloudStudio（链接见交付记录），跨会话可用。

### 13.6 与规范偏差登记（随代码同步）

| 偏差项 | 说明 | 同步动作 |
|------|------|------|
| **图表引擎** | 自绘 SVG（`charts.js`）替代 ECharts C1-C10 主题 | 配色沿用图表色板；如后续接回 ECharts，需回填 8.x |
| **图标库** | 自绘 Lucide 风格 SVG（`icons.js`）替代 Lucide React | 风格/尺寸（16/18/20）与 12.3 一致 |
| **WindowHeader** | **已移除**（红绿灯窗口头部） | 见 12.5 / 12.8，DOM 与 `.window-header`/`.traffic`/`.light.*`/`.window-title` CSS 全删 |
| **框架/状态** | 原生 JS 路由 + 内存状态，替代 React Router / Zustand | 主题切换（仅亮色）由 CSS 变量承载，无 `.dark` 类 |
| **CSS 变量命名差异** | `--radius-pill`(↔规范`--radius-capsule`)、`--border-divider`/`--border-glass`(↔`--border-color`/`--glass-border`) | 取值完全一致，仅命名不同 |
| **Demo 新增变量** | `--glass-bg-strong` / `--color-primary-rgb` / `--shadow-card-hover` / `--shadow-nav` / `--shadow-btn-primary` / `--sidebar-w` / `--topbar-h` / `--ease-mac` | 上表已登记，规范变量体系（4.1）可择机补入 |

### 13.7 财年滚动对比页（2026-07-20 新增）

**业务含义**：财年 = 每年 **4 月 1 日 ~ 次年 3 月 31 日**（如 FY2025 = 2025-04-01 ~ 2026-03-31，以「起始年」命名）。页面展示「去年」与「今年」两个财年对比，且该关系随**当前日期自动逐年滚动**——进入新财年时，「去年」切换为上一完整财年、「今年」切换为当前进行中财年。

**逻辑模块 `js/fiscal.js`（纯函数，浏览器 `window.Fiscal` 与 Node `module.exports` 双兼容）**
- `fiscalStartYear(date)`：月 ≥ 4 → 当年；否则 → 去年。
- `fyPair(date)` → `{ current, previous }`：今年 = `currentFiscalYear(date)`；去年 = `makeFy(current.startYear - 1)`。
- `status(fy, asOf)`：`asOf > fy.end` → `complete`，否则 `in-progress`（结束日当天仍算进行中）。
- `parseDate('YYYY-MM-DD')` / `toISO(date)` / `dateOnly(d)`：边界比较与格式化。
- 共享用例 `Fiscal.TEST_SCENARIOS`（滚动场景）× `Fiscal.TEST_STATUS`（完整状态），UI 自测表与 Node 测试 `test/fiscal.test.js` 均引用，**避免期望漂移**。

**页面结构 `V.fiscal()`（`views.js`）**
1. 工具条：日期选择器 `#fy-date`（默认今天，可手动切换验证任意时点）+「用今天」「运行全部测试」。
2. 规则提示条 `.fy-rule`：标注当前判定基准日期。
3. 双卡片 `.fy-pair`：去年 / 今年，各含 FY 标签、区间（`startYear-04 ~ startYear+1-03`）、状态 Tag（完整财年 green / 进行中 orange）、四项指标值。
4. 核心指标同比表（去年 vs 今年，红涨绿跌 `trendCls`）。
5. 逻辑自测表：场景 / 测试日期 / 期望(FY今年/FY去年) / 实际 / 结果(✓/✗)，头部显示 `✓ N/N 通过`。

**交互（`app.js`）**：`#fy-date` change → 写 `AppState.fyDate` 并重渲染；`fy-today` → 重置为今天；`fy-test` → Toast 汇总通过数。`ROLE_NAV` 全部角色均可见（viewer 亦可看，只读无导出）。

**测试覆盖**（`test/fiscal.test.js`，`node demo/test/fiscal.test.js`）：4 类场景 × 连续财年周期，全部 11 项 PASS——
- 场景1 财年中期：2026-08-15 → 今年 FY2026 / 去年 FY2025
- 场景2 临界点：2026-03-31（FY2025 末日）→ FY2025/FY2024；2026-04-01（FY2026 首日）→ FY2026/FY2025
- 场景3 跨年归属：2025-12-15、2026-01-15 → 均属 FY2025（去年 FY2024）
- 场景4 连续周期：2024-08-15 / 2025-08-15 / 2026-08-15 → FY2024~FY2023 / FY2025~FY2024 / FY2026~FY2025（覆盖 FY2023~FY2026 共 4 个财年，≥ 3 周期）
- 完整状态：FY2025 在 2026-03-31 为 `in-progress`、2026-04-01 为 `complete`；FY2026 在 2026-08-15 为 `in-progress`

**Mock 数据**：`D.fyData`（按 `startYear` 索引的整财年合计，万元）含 FY2023/FY2024/FY2025/FY2026 四周期，FY2026 标注「进行中，数据截至当前」。

> **变更纪律**：自本章确立起，任何 `demo/` 的颜色 / 字体 / 间距 / 圆角 / 阴影 / 组件样式 / 交互状态 / 响应式调整，必须在同一工作流内同步更新本第十三章与对应第一~四 / 七 / 十二章条目，保持代码实现与规范文件的严格一致。

---

## 附录

### A. 文件结构树

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
│  ├─ App.tsx                      # ConfigProvider 动态切换入口
│  ├─ main.tsx                     # initTheme() + import variables.css/glass.css
│  └─ index.css                    # 全局基础（box-sizing、bg-gradient body）
├─ tailwind.config.ts              # darkMode:'class' + colors→var + backdropBlur + radius
└─ index.html
```

### B. 工作量估算（P0）

| 模块 | 人日 | 说明 |
|------|------|------|
| 主题基础设施（CSS 变量 + tokens + Tailwind + glass.css） | 1.5 | 含降级与性能开关 |
| AntD token 配置（light + 组件 override） | 1.0 | Modal/Drawer/Card/Table/Segmented |
| ECharts 主题 + 动态注入 | 0.5 | light theme + registerTheme |
| 主题切换（themeStore + ConfigProvider + 重绘） | 0.5 | 含过渡动画 |
| 毛玻璃业务组件（8 个） | 2.0 | GlassTable 双层结构最重 |
| 现有页面接入（Layout/Dashboard/Indicators） | 1.5 | 替换容器为 GlassCard/GlassNav |
| 暗色预留（P1，不计 P0） | — | P1 单独排期 |
| **P0 合计** | **≈ 7 人日** | |

### C. v2 方案迁移清单

| v2 章节 | 修订内容 |
|---------|----------|
| **3.2 技术栈（前端）** | 补充 CSS 变量层（`theme/variables.css`）、毛玻璃 utility（`theme/glass.css`）、ECharts 主题（`theme/echarts*.ts`）、`tokens.ts` 常量单源；Tailwind 补充 `darkMode:'class'`、colors 引用 CSS 变量、backdropBlur 扩展 |
| **3.3 架构分层** | 前端目录树补充 `theme/` 目录、`components/glass/` 目录、`store/themeStore.ts`；架构图 Layer 1-4 标注 |
| **第十章 前端展示规范** | 全面替换为 iOS 毛玻璃规范：新增色板（亮 P0/暗 P1）、布局尺寸、表格双层结构、组件规范、ECharts 规范、主题切换机制；保留 10.1 数值单位/10.2 对齐/10.3 精度（红涨绿跌色值统一 #FF3B30/#34C759） |
| **T01 基础设施任务** | 增加主题系统搭建（`theme/` 全量文件 + `tailwind.config.ts` 改造 + `main.tsx` 引入 variables.css/glass.css + `themeStore` + `App.tsx` ConfigProvider 接入 + `echartsSetup`） |
| **依赖包** | 无需新增第三方包——毛玻璃为纯 CSS（backdrop-filter），主题切换为现有 Zustand + AntD ConfigProvider |
| **附录 关键文件路径** | 新增 `theme/` 7 文件、`components/glass/` 8 文件、`store/themeStore.ts` |

### D. 风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| **backdrop-filter 浏览器兼容性** | Firefox 早期版本、部分企业内嵌浏览器不支持 | `@supports not` 降级为 `--content-bg` 近白纯色；目标浏览器 Chrome 88+ / Safari 14+ |
| **AntD 组件深度定制成本** | token override + className 注入工作量大 | P0 优先用 ConfigProvider `components` token（官方支持）；遗留硬覆盖集中到 `glass.css` |
| **ECharts canvas 与 backdrop-filter 渲染边界** | canvas 透明透出渐变背景，网格线对比度不足 | 强制"玻璃壳 + 近白芯"双层结构，canvas 落在 `--content-bg` 近白芯上 |
| **大量毛玻璃元素 GPU 内存** | 低端设备卡顿 | 表格"壳毛玻璃+芯近白"将 blur 从 N 行收敛为 1 个；`data-perf="low"` 性能模式全局关模糊；单屏 glass 元素 <= 8 个为设计约束 |
| **暗色主题预留充分性** | P0 若硬编码色值，P1 暗色改造工作爆炸 | P0 强制全量使用 CSS 变量（禁止硬编码 hex 进业务组件）；P1 仅需启用 `.dark` class + 接入 darkTheme/echartsDarkTheme |
| **preflight 关闭副作用** | Tailwind 不注入 reset，部分原子类行为变化 | 业务样式以 AntD 为基准 + 显式 `border-color`；`.glass-*` 显式声明 border |
| **打印场景渐变背景** | 耗墨且看不清 | `@media print` 强制 `--bg-gradient`/`--glass-bg` 为纯白 |

---

*本文档 v2.0（macOS 风格增强版）由产品经理许清楚《iOS 毛玻璃 UI 设计规范》+ 架构师高见远《iOS 毛玻璃技术落地方案》+ 主理人齐活林《页面风格变更规划》三份文档合并而成，并依据《前端开发规范（模块 4 - macOS 风格增强版）》（`references/frontend.md`）对齐动画引擎、图标库、组件命名与测试要求，为浙江壹品慧财年经营数据分析平台 UI 开发的权威参考。*
