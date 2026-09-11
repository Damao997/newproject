# 浙江壹品慧财年经营数据分析平台 — 前端设计方案

> **版本**: v3.5  
> **日期**: 2026-07-31  
> **风格定位**: 简洁专业 / 效率驱动  
> **技术选型**: Radix UI + Shadcn + Tailwind CSS + CSS Animation

---

## 1. 设计哲学

### 1.1 核心原则

| 原则 | 说明 |
|------|------|
| **数据可读性优先** | 财务数据必须清晰、精确、可扫描。任何视觉装饰不得干扰数字阅读。 |
| **效率驱动** | 减少认知负荷，用户能在 3 秒内定位关键信息。 |
| **克制美学** | 纯白底、细边框、微妙阴影。无渐变、无毛玻璃、无过度动画。 |
| **一致性** | 全站使用统一的 Design Token，确保视觉语言一致。 |

### 1.2 与现有方案的区别

| 维度 | 现有方案（v2） | 本方案（v3） |
|------|---------------|-------------|
| 视觉风格 | macOS 毛玻璃（`backdrop-filter`） | 纸质感（白底 + 细边框 + 克制阴影） |
| 动画库 | Framer Motion | 纯 CSS Animation |
| 组件库 | Ant Design 全量 | Ant Design 仅表格（ProTable）+ 其余 Radix/Shadcn |
| 主题 | 亮/暗双主题 | P0 仅亮主题，暗色 P2 |
| 设计系统 | 硬编码样式 | Design Token 变量化 |

---

## 2. 技术栈

```
React 18 + TypeScript 5.5
├── Vite 5（构建工具）
├── Tailwind CSS 3（原子样式）
├── Radix UI（无样式 headless 组件）
├── Shadcn/ui（基于 Radix + Tailwind 的组件）
├── Zustand（状态管理）
├── React Query（数据获取）
├── ECharts 5.5（图表）
├── Ant Design 5（仅 ProTable）
└── Lucide React（图标）
```

### 2.1 为什么不用 Ant Design 全量

- AntD 全量引入约 120KB+（gzip），且样式不可控
- 本方案仅需 ProTable 的虚拟滚动、固定列、可编辑单元格能力
- 其余组件（Button、Form、Modal、Tabs 等）用 Radix + Tailwind 自建，更轻、更可控

> **落地说明**：`antd` 作为 `@ant-design/pro-table` 的必需 peer 依赖仍在 `package.json` 中，但全仓仅 `components/data-table/pro-table-inner.tsx` 引用（`ConfigProvider`），且该文件经 `React.lazy` 动态加载，**不进首屏 chunk**，符合"仅表格"的体积目标。禁止在其他文件 `import from 'antd'`。
> `ui/` 下组件为**基于 Radix 手写封装**（风格参照 Shadcn，但不通过 shadcn CLI 生成），以便完全掌控 Design Token 与中文财务场景细节。


### 2.2 为什么不用 Framer Motion

- Framer Motion 约 50KB+（gzip），80% 动画效果可用 CSS 实现
- 财务数据平台不需要复杂交互动画，CSS `transition` + `@keyframes` 足够
- 减少 bundle 体积，提升首屏加载速度

---

## 3. 设计系统（Design Token）

所有设计令牌使用 CSS 变量管理，支持主题切换预留。

### 3.1 颜色

```css
:root {
  /* 基础色（中性色保持暖调：色相 24-30，与品牌橙同族；页面底色为冷灰 #F5F7FA，形成现代 SaaS 层次） */
  --background: 0 0% 100%;          /* 页面背景：纯白 */
  --foreground: 24 10% 10%;        /* 主文本：暖近黑 */
  --page: 0 0% 100%;                /* 内容区底色：纯白，卡片层次由边框+阴影承担 */

  /* 卡片与表面 */
  --card: 0 0% 100%;                /* 卡片背景 */
  --card-foreground: 24 10% 10%;
  --popover: 0 0% 100%;             /* 浮层（Dropdown/Select/Tooltip）背景 */
  --popover-foreground: 24 10% 10%;
  --muted: 30 25% 96%;             /* 禁用/表头背景 */
  --muted-foreground: 25 8% 45%;   /* 辅助文字 */

  /* 主题色 */
    --primary: 29 100% 53%;           /* 默认品牌橙：#FF830F（可经主题预设切换，见下方主题色块） */
  --primary-foreground: 0 0% 100%;
  --secondary: 30 25% 96%;         /* 次要背景 */
  --secondary-foreground: 25 20% 18%;
  --accent: 30 40% 95%;            /* 强调背景（ghost/outline/导航 hover 态） */
  --accent-foreground: 25 25% 18%;

  /* 状态色 */
  --destructive: 0 84% 60%;        /* 删除/错误：#EF4444 */
  --destructive-foreground: 0 0% 100%;
  --success: 160 84% 39%;          /* 成功/达成：#10B981（图标、色块、填充） */
  --warning: 38 92% 50%;            /* 警告/待审：#F59E0B（图标、色块、填充） */
  --success-strong: 160 84% 26%;   /* 白底小字号成功文本，对比度 ≥ 4.5:1 */
  --warning-strong: 32 90% 36%;    /* 白底小字号警告文本，对比度 ≥ 4.5:1 */
  --info: 205 80% 38%;             /* 中性信息态（进行中/提示），替代蓝色调色板 */

  /* 边框与输入 */
  --border: 30 18% 89%;             /* 边框：#E9E2DB */
  --input: 30 18% 89%;
  --ring: 29 100% 53%;             /* Focus 光环（同 primary） */
      /* 侧边栏浅色风格（默认）：白底 + 浅橙高亮；三风格下 --sidebar-bg 均为 HSL 三元组，经 bg-sidebar-bg 类（hsl() 包装）使用（随 data-sidebar 切换） */
      --sidebar-bg: 0 0% 100%;
      --sidebar-fg: 220 9% 46%;
      --sidebar-icon: 220 9% 64%;
      --sidebar-selected-bg: 33 100% 93%;
      --sidebar-selected-fg: 33 100% 66%;
      --sidebar-border: 220 13% 91%;
      --sidebar-brand-fg: 220 9% 20%;

  /* 图表序列色：橙主导 + 和谐化多色，13 色覆盖分类色板全部槽位 */
  --chart-1: 29 100% 53%;   --chart-2: 200 78% 45%;  --chart-3: 160 84% 39%;
  --chart-4: 38 92% 50%;   --chart-5: 262 58% 60%;  --chart-6: 25 12% 55%;
  --chart-7: 340 68% 55%;  --chart-8: 190 58% 42%;  --chart-9: 95 42% 42%;
  --chart-10: 12 68% 48%;  --chart-11: 280 42% 55%; --chart-12: 45 72% 44%;
  --chart-13: 210 20% 52%;

  /* 圆角 */
  --radius: 0.75rem;               /* 12px — 浮层/对话框级别（Dialog、Dropdown、Select） */
  --radius-card: 0.5rem;           /* 8px — 卡片容器级别（Card 基类） */
  /* 派生：md = calc(var(--radius) - 2px), sm = calc(var(--radius) - 4px) */
}
```

**侧边栏三风格预设（Header 风格切换器）**

- 切换器位于 Header（**风格色块圆点**按钮），选择写入 `html[data-sidebar]`（`themeStore`，localStorage `sidebar-style-storage` 持久化），`globals.css` 中 `:root[data-sidebar='gradient'|'dark']` 块覆盖：交互主色（`--primary` / `--ring` / `--chart-1` / 辅助色）与侧边栏色板（`--sidebar-*`）；主页面恒白（`--background` / `--page` / `--card` 三风格均为纯白），中性色与 `--radius*` 不随风格变化。
- **风格 3 套**（v4.0）：浅色 `light`（默认，橙交互）/ 深紫 `gradient`（#472159，原紫渐变已取消）/ 深色 `dark`（#1F2937）。
- **浅色风格色板**：侧边栏白底 `0 0% 100%` · 未选中文字 `220 9% 46%`（#6B7280）· 图标 `220 9% 64%`（#9CA3AF）· 选中背景 `33 100% 93%`（#FFE8CC）· 选中文字 `33 100% 66%`（#FFB152）· 分界线 `220 13% 91%`（#E5E7EB）· 交互主色橙 `29 100% 53%`（#FF830F）。
- **深紫风格色板**：侧边栏纯色 `281 46% 24%`（#472159 深紫）· 未选中文字 `231 100% 94%`（#E0E7FF）· 选中背景 `239 55% 51%`（#4338CA 亮紫蓝块）· 选中文字纯白 · 交互主色同 #472159。
- **深色风格色板**：侧边栏 `222 47% 11%`（#111827）· 未选中文字 `220 9% 65%`（#9CA3AF）· 选中背景 `222 47% 15%`（#1F2937）· 选中文字纯白 · 交互主色 #1F2937。
- **交互元素跟随规则**（v4.0）：按钮 / 链接 / 图表主色 / 焦点环 / 折叠条 hover 与收起态均使用当前风格的 `--primary`（浅色橙 / 靛蓝 / 深色深灰），与侧边栏主题协调；三种风格下主页面背景恒为纯白。
- **图表主色提亮**（v4.0 修复）：图表序列首位（`--chart-1` / `getChartSeries()[0]`）使用**图表专用提亮色**，与交互主色解耦——浅色橙 `#FF830F` / 靛蓝淡紫 `#BBA9F7` / 深色亮蓝 `#7A9BF2`（白底对比充足），避免靛蓝/深色风格下白底图表主序列发暗。
- 新增风格必须同时更新 `globals.css` 风格块与 `chart-theme.ts` 的 `SIDEBAR_PRESETS`（hex 镜像）。
- ECharts 图表序列主色经 `getChartSeries(sidebarStyle)` 返回（首位跟随风格主色），坐标轴/网格/tooltip 经 `getChartInk()` 取色（主页面恒白，恒亮色），antd token 经 `SIDEBAR_PRESETS[sidebarStyle]` + `THEME_HEX` 注入（恒 lightAlgorithm），均监听 `themeStore` 即时重绘。

**令牌使用约束（P0 强制）**

- 业务代码禁止十六进制色值与 Tailwind 调色板类（`bg-blue-500`、`text-green-600`、`bg-slate-50` 等），一律使用上表令牌映射出的类名。
- 多彩强调位（KPI 图标、快捷入口、分类标签）使用 `bg-chart-N/10 text-chart-N`，四色轮换固定为 `chart-1 / chart-2 / chart-3 / chart-5`。
- 白底上的小字号状态文本用 `-strong` 变体；图标与色块用 base 令牌。
- ECharts（canvas 渲染）与 antd `theme.token` 无法读取 CSS 变量，统一从 `web/src/lib/chart-theme.ts` 取 hex 镜像：`CHART_SERIES`（序列色）、`CHART_INK`（坐标轴/网格/浮层）、`THEME_HEX`（antd 语义色）、`THEME_PRESETS`（品牌主题色预设）。该文件是全仓唯一允许出现 hex 的位置，修改颜色时必须与 `globals.css` 同步。
- Tailwind 配置 `darkMode: 'class'`：亮/暗模式由 Header 主题切换器显式切换（写入 `html.dark`），不跟随系统偏好。

### 3.2 财务专用色

| 用途 | 色值 | 说明 |
|------|------|------|
| 收入/利润增长 | `#FF3B30`（`text-finance-red`） | 红涨，符合 A 股/国内财报习惯 |
| 成本/下降 | `#34C759`（`text-finance-green`） | 绿跌 |
| 预算达标 | `text-success-strong` | 达成率 ≥ 95% |
| 预算预警 | `text-warning-strong` | 达成率 85%-95% |
| 预算严重偏离 | `text-destructive` | 达成率 < 85% |

**语义边界（P0 强制）**：`text-finance-red/green` 仅用于数值涨跌语义（同比、较年初等金额/比率着色，经 `getChangeColor` 统一返回）；操作错误、校验错误、删除按钮一律 `text-destructive`（令牌红），禁止用 finance-red 表达错误态（v3.6 已全量收敛）。

### 3.3 字体

全站统一微软雅黑（非 Windows 环境回退 `system-ui`），不引入 Web Font，避免内网首屏字体加载抖动。

| 层级 | 字体族 | 大小 | 字重 | 用途 |
|------|--------|------|------|------|
| Display | `font-sans`（Microsoft YaHei / 微软雅黑 / system-ui） | 24px | 700 | 页面标题 |
| Heading | `font-sans` | 18px | 600 | 卡片标题（`CardTitle` 组件默认 `text-2xl`，业务卡片标题按本层级以 `text-lg` 覆盖） |
| Body | `font-sans` | 14px | 400 | 正文（表格正文/表头实际为 13px，即 `text-[13px]`，见 §4.4） |
| Caption | `font-sans` | 12px | 400 | 辅助文字、时间戳 |
| **Number** | `font-num`（微软雅黑 + `font-feature-settings: "tnum"`） | 13-14px | 400/500 | **金额/数量/比率等一切数字**，等宽数字保证表格纵向对齐 |

**约束**：
- 表单输入正文使用纯黑（`text-black`），保证财务录入场景可读性。
- 数字列一律加 `font-num`；**禁止**使用 Inter / Noto Sans SC / JetBrains Mono（v3.0 曾规定，已废止）。


### 3.4 阴影

暖调阴影：以褐黑 `rgb(28 20 12)` 替代纯黑，与品牌橙更协调。定义在 `web/tailwind.config.js` 的 `boxShadow`。

| 层级 | 阴影值 | 用途 |
|------|--------|------|
| `shadow-sm` | `0 1px 3px 0 rgb(28 20 12 / 0.05)` | 按钮、输入框、顶栏 |
| `shadow-md` | `0 4px 6px -1px rgb(28 20 12 / 0.08), 0 2px 4px -2px rgb(28 20 12 / 0.06)` | 卡片 hover |
| `shadow-lg` | `0 12px 24px -8px rgb(28 20 12 / 0.12)` | Dropdown、移动端抽屉 |
| `shadow-xl` | `0 25px 50px -12px rgb(28 20 12 / 0.18)` | Dialog、登录卡 |

### 3.5 缓动曲线

| 令牌 | 值 | 用途 |
|------|-----|------|
| `ease-brand` | `cubic-bezier(0.22, 1, 0.36, 1)` | 侧边栏展开/收起、卡片阴影、图表柱体增长 |

---

## 4. 组件规范

### 4.1 Button

```
基础样式：
- 高度：32px（default / sm / icon 均 h-8，见下方尺寸表）；44px（lg，h-11）
- 圆角：10px（calc(var(--radius) - 2px)，lg 为 8px）
- 字体：14px / 500
- 过渡：all 0.15s ease
- 点击反馈：active: scale(0.97)
- Focus：box-shadow: 0 0 0 2px hsl(var(--ring) / 0.3)

尺寸：
┌─────────────┬──────────┬──────────────────┐
│ default     │ h-8 px-4 │ 32px 高          │
│ sm          │ h-8 px-3 │ 32px 高（紧凑）   │
│ lg          │ h-11 px-8│ 44px 高          │
│ icon        │ h-8 w-8  │ 32px 正方形      │
└─────────────┴──────────┴──────────────────┘

变体：
┌─────────────┬─────────────────────────────┐
│ primary     │ 橙底白字，hover 加深          │
│ secondary   │ 灰底深字，带边框              │
│ outline     │ 白底灰边框，hover 灰背景       │
│ ghost       │ 透明，hover 灰背景             │
│ destructive │ 红底白字，删除/危险操作        │
│ link        │ 无底色，primary 色文字 + hover 下划线 │
│ fused       │ 与 bg-page 同色 + 灰描边，hover 描边转品牌橙 │
└─────────────┴─────────────────────────────┘
```

> 变体一律以 Design Token 类名实现（`bg-primary`/`text-primary-foreground`/`ring-ring`），**禁止硬编码色值**，保证换色只需改 `globals.css`。

### 4.2 Card

```
- 背景：hsl(var(--card)) = 白色
- 圆角：var(--radius-card) = 8px
- 边框与阴影：无（v3.9 平面化，内容区不依赖边框/阴影分层）
- 内边距：card-header / card-content 统一 `p-6`（24px，content 顶部由 `pt-0` 衔接）
```

### 4.3 Input / Select

```
- 高度：32px（h-8，紧凑财务场景；表单弹窗内同样 h-8，不区分大档）
- 圆角：8px（rounded-md）
- 边框：1px solid hsl(var(--input))（`border-input`）
- Focus：`focus-visible:ring-2 ring-ring ring-offset-2`（光环取 `--ring` = 品牌橙）
- 背景：白色
- 字体：14px，正文色纯黑（`text-black`，保证表单可读性）
- 占位符色：`placeholder:text-muted-foreground`
```

### 4.4 Table（数据表格）

```
容器（全站统一卡片化）：
- 边框：1px solid hsl(var(--border))
- 圆角：8px（rounded-card）
- overflow: hidden
- 卡头：区块标题/统计信息置于 border-b 行（px-4 py-2.5）
- 筛选/工具条：独立筛选卡（rounded-card p-4），与表格卡以 16px 间距分隔
```

**卡片化特例**：
- 财务指标页筛选条位于 PageContainer actions（sticky 吸顶结构），保持页头形态不包卡；仅表格区包卡。
- 权限管理角色列表为角色卡网格（本身卡片化），不额外套外层 Card（避免嵌套）。
- 企业查询/报告编辑器等已全卡片化页面不再改动。
```
表头：
- 背景：bg-muted/50（暖中性半透明）
- 字体：13px / 500
- 颜色：text-black
- 内边距：h-11 + px-4（紧凑表 h-8）
- **对齐：所有标题行单元格一律居中**（含金额列表头）

行：
- 字体：13px（`text-[13px]`）
- 内边距：p-4（紧凑表 px-4 py-1.5）
- 边框：顶部 1px solid hsl(var(--border))
- hover：背景 bg-muted/50
- 过渡：background 0.15s ease

关键列（按 `account_subject.value_type` 分型渲染，见 `lib/utils.ts` 的 `formatMetricValue`；对齐分场景）：
- **对比型表格**（指标树、覆盖率矩阵等多期间/多维对比）：数值列**居中** + `font-num`
- **明细/交叉宽表**（数据浏览交叉表、往来明细、账龄表等）：数值列**右对齐** + `font-num`
- **amount（金额）**：千分位 2 位小数（`formatMoneyWan`），单位"万"以小字后缀独立渲染，数值内不含"万"字
- **quantity（数量）**：千分位整数（`formatQuantity`），无小数
- **ratio（比率）**：百分比 1 位小数（`formatPercent`）
- 达成率列：Badge 组件（rounded-full，success/warning 语义色）
- 同比列：红涨绿跌（`finance.red`/`finance.green`），font-weight: 500
- 微型状态胶囊（AR/AP 标签、覆盖率格子等）一律使用语义令牌对（`bg-info/10 text-info`、`bg-success/10 text-success-strong`、`bg-warning/15 text-warning-strong`、`bg-destructive/10 text-destructive`、`bg-muted text-muted-foreground`）；**禁止** hex 与 Tailwind 调色板类
```

### 4.5 Badge

```
- 圆角：9999px（胶囊形）
- 内边距：2px 10px
- 字体：12px / 600（`font-semibold`）

语义变体（实现见 `components/ui/badge.tsx`）：
┌──────────────┬──────────────────────────────────────────┐
│ default      │ bg-primary + text-primary-foreground（橙底白字） │
│ secondary    │ bg-secondary + text-secondary-foreground   │
│ success      │ bg-success/10 + text-success-strong        │
│ warning      │ bg-warning/15 + text-warning-strong        │
│ destructive  │ bg-destructive + text-destructive-foreground │
│ outline      │ 无底色，text-foreground + 边框              │
└──────────────┴──────────────────────────────────────────┘
```

### 4.6 Tabs

```
容器：
- 背景：bg-muted
- 圆角：10px
- 内边距：4px
- 宽度：fit-content

触发器：
- 默认：透明背景，text-muted-foreground 文字
- 激活：`data-[state=active]:bg-background` + `text-foreground` + shadow-sm
- 圆角：8px
- 过渡：all 0.15s ease
```

### 4.7 Dialog（Modal）

```
遮罩：
- 背景：bg-black/80（rgba(0, 0, 0, 0.8)）
- 动画：fadeIn 0.2s

内容：
- 背景：白色
- 圆角：8px（sm:rounded-lg）
- 边框：1px solid hsl(var(--border))
- 阴影：shadow-lg
- 动画：fadeInScale 0.25s（data-[state=open]:fade-in-0 + zoom-in-95）
- 最大宽度：28rem（max-w-md，默认）/ 32rem（max-w-lg）/ 42rem（max-w-2xl，含编辑器大内容）/ 48rem（max-w-3xl，宽表）；宽表对比场景可突破至 max-w-4xl

右侧抽屉（Sheet，见 `components/ui/sheet-shell.tsx`，分析抽屉等场景）：
- 遮罩：bg-black/40（与 Dialog 区分层级，抽屉内容更大故遮罩更轻）
- 容器：max-w-xl、border-l bg-background、shadow-lg（对齐 §3.4 抽屉阴影档位）
- 头部：图标 + 标题 + 副标题 + 关闭按钮（aria-label="关闭"，focus ring）
- 行为：role="dialog" aria-modal="true"、初始焦点在关闭按钮、Escape 关闭（含未保存修改确认）
```

### 4.8 筛选器与工具栏（v3.5 新增）

**筛选器行**：
- 布局：`flex flex-wrap items-center gap-2/3`，小屏自动换行不溢出。
- 选择器宽度：`w-full sm:w-[Npx]`（N 取 140/160/200/220），小屏占满整行（正例：`indicators/index.tsx`）。
- 公司/期间选择一律使用共享组件，禁止页面内联实现：
  - 公司单选 → `@/components/filters/company-select` 的 `CompanySelect`（内置"全部公司"，`entitiesOnly` 仅列单体公司）。
  - 公司多选 → 同文件 `CompanyMultiSelect`（空数组语义=全部公司，触发器文案"全部公司 / X / X 等 N 家"）。
  - 期间单选 → `@/components/ui/month-picker` 的 `MonthPicker`（含"全部期间"筛选场景：空值语义=全部，placeholder 传"全部期间"，并传 `allowedPeriods` 限定仅可选有数据期间，对齐原 Select 行为；正例：`reports/analysis-list.tsx`、`reports/index.tsx` 新建对话框）。
- 复选框一律用 `@/components/ui/checkbox` 的 `Checkbox`（Radix 封装，选中态品牌橙；`size="sm"` 用于表格行内紧凑场景），禁止原生 `<input type="checkbox">`（含全选 indeterminate：`checked` 传 `'indeterminate'`）。
- 操作反馈消息一律用 `@/components/ui/flash-message` 的 `FlashMessage`（success→`text-success-strong` / error→`text-destructive` / info→`text-primary`，`autoHideMs` 控制自动消失；表单内联常驻反馈传 0）。
- 共享组件名称统一跟随全局"显示简称"开关（`useCompanyDisplayName`）。

**工具栏**：
- 主动作常驻 ≤ 3 个（高频操作），其余次动作收入"更多"DropdownMenu（`MoreHorizontal` 图标 + "更多"文字）。正例：`report-editor.tsx` 顶部工具栏。
- 同一页面多个 Tab 共用的操作组，抽成局部组件复用，禁止逐 Tab 复制（正例：`data/index.tsx` 的 `ReclassifyMenu`）。
- 危险操作：`variant="destructive"` + `useConfirm` 二次确认。

**无障碍（P0 强制）**：
- 纯图标按钮必须携带 `aria-label`（行内编辑/删除/上移/下移/查看/关闭等）。
- 表单控件必须 `Label htmlFor` + 控件 `id` 关联（Radix `SelectTrigger` 同样接受 `id`）。
- 弹窗须含 `DialogDescription`（Radix 自动关联 `aria-describedby`）。

---

## 5. 页面设计规范

### 5.1 全局布局

左侧固定侧边栏 + 顶部细顶栏。实现见 `components/layout/{main-layout,sidebar,header,nav-items}.tsx`。

```
┌──────────┬───────────────────────────────────────┐
│ Sidebar  │  Header (56px)                        │
│ 展开240px│  - 面包屑 + 风格切换 + 财年选择器     │
│ 收起 64px│  - 头像下拉 · 底部 1px 分割线         │
│ 从页面顶 │  ├───────────────────────────────────┤
│ 部开始   │  Main Content                         │
│ Logo+品牌│  - max-width: 1536px (max-w-screen-2xl)│
│ 导航项   │  - padding: 24px 16px → lg:32px 32px   │
│ (按权限) │  - 独立纵向滚动                        │
│ 版本信息 │                                        │
│右侧圆角 │                                        │
└──────────┴───────────────────────────────────────┘
```

**侧边栏规则**：
- 展开 `w-60`(240px) / 收起 `w-16`(64px)，宽度过渡 `duration-200 ease-brand`；收起态仅显示图标并以 Tooltip 补名称，收起状态经 `localStorage`(`sidebar-collapsed`) 持久化。
- **小尺寸自动折叠**（v3.7）：窗口 <1280px（1024-1279px 区间，对齐 §8 响应式策略）时侧边栏自动进入折叠态；小尺寸下折叠条点击仅会话内临时展开/折叠（不写 localStorage），回到 ≥1280px 自动恢复用户持久化偏好。
- **三风格 + 全高右圆角**（v4.0）：侧边栏为独立列**从页面顶部开始渲染**（覆盖 Header 高度区域），全高贴边；背景由 `--sidebar-bg` 驱动（浅色白 / 深紫 #472159 / 深色 #111827，经 `bg-sidebar-bg` 类 `hsl()` 包装使用），**右侧上下圆角 `rounded-r-card`（8px，与页面卡片圆角一致）+ 左侧直角贴边**（`overflow-hidden` 裁剪背景与折叠条），右侧 `border-r border-sidebar-border` 分界（浅色浅灰 / 深紫同色相 / 深色同色相）。
- **折叠条**（v3.7/v4.0）：侧边栏右缘**透明按钮**（仅箭头图标，无背景条）；展开态箭头 `--sidebar-fg` 60% 半透明，hover 转选中色（`--sidebar-selected-fg`：浅色橙 / 靛蓝白 / 深色白）；收起态箭头选中色常驻 + hover 微放大；含 `aria-label` 与收起态 Tooltip。
- 导航项按 `usePermission()` 过滤，仅展示当前角色具备 view 权限的模块（对齐《安全与权限规范》§2.2），资源码见 `nav-items.ts`。
- 激活态（v4.0）：`bg-sidebar-selected-bg`（浅色=浅橙 #FFE8CC / 靛蓝=亮紫 #4338CA / 深色=#1F2937）+ `font-semibold text-sidebar-selected-fg`（浅色=橙 / 靛蓝=白 / 深色=白）+ 左侧 3px 圆角竖条（`bg-sidebar-selected-fg`）；非激活 `text-sidebar-fg`，hover `bg-sidebar-fg/10`。
- `<768px`：侧边栏隐藏，改为顶栏汉堡按钮唤起的抽屉（含遮罩，路由切换自动关闭）。

**顶栏规则**：
- 顶栏背景 `bg-background`（恒白，与主页面同色，不与侧边栏同步）+ `border-b border-border` 1px 分割线；v4.0 起不再使用顶带深色。
- 桌面端承载侧边栏风格切换器（**三色点横向平铺**：浅色橙 / 深紫 #472159 / 深色深灰，无文字，点击直接切换，选中项深色描边）、全局财年选择器与用户菜单（品牌标识在侧边栏顶部）；移动端额外显示汉堡按钮 + 品牌标识。
- 全局财年选择影响看板/指标/数据浏览的期间候选，状态存于 `periodStore`；风格状态存于 `themeStore`（localStorage `sidebar-style-storage` 持久化）。
- 内容区背景为 `bg-page`（`--page`，恒白，三风格一致），卡片平面化（无边框阴影，v3.9）。

**面包屑规则**：
- **位置（v4.0 上移至顶栏）**：渲染在顶栏 Header 桌面端左侧（品牌标识在侧边栏，Header 左端为面包屑区），`hidden min-w-0 flex-1 items-center md:flex` + 单行截断（`singleLine` prop）；<768px 隐藏（左侧被汉堡+品牌占用）；层级 ≥3 时显示，单级/双级页面不展示。
- 路径链从 `nav-items.ts` 递归匹配当前 pathname 推导（单一数据源）；中间级目录项（如「维度/科目体系」，无独立页面）渲染为纯文本不可点击，叶子项渲染为 Link。
- 样式：12px 灰色（`text-xs text-muted-foreground`）+ `/` 分隔，末级 `font-medium text-foreground`。

**页头标题与描述规则**：
- h1 主标题必须保留：满足文档大纲（屏幕阅读器导航）且单级/双级页面（无面包屑）以标题为唯一页面标识；title 应为子页名（如「账龄分析」），模块归属由面包屑承担。
- 描述默认不常驻展示：有信息增量的描述（功能清单/数据口径/引导文案）作为 `description` 传入，渲染为标题旁 Info 图标 + Tooltip 悬浮（`PageContainer` 内置）；与标题或面包屑重复的冗余描述一律不传。

### 5.2 登录页

- 居中卡片布局，max-width 400px
- 卡片：白色 + 细边框 + 圆角 12px
- 输入框：username / password
- 操作：记住用户名（Switch）+ 登录按钮（Primary，全宽）

### 5.3 首页看板

- **主体/期间筛选**：页头 actions 区含主体维度选择器（全部主体 / 公司 / 汇总主体分组，汇总主体经后端展开为成员合并口径）与期间选择器（跟随全局财年过滤）。
- **KPI 卡片区**：4 张核心指标卡（收入 / 毛利 / 净利润 / 回款），`sm` 2 列、`xl` 4 列，每张包含：
  - 标题（Caption 色）+ 右上角四色轮换图标
  - 大字体区：本月合计（`text-2xl` + `font-num`）+ 月度预算达成率（`text-lg`，按 §3.2 三级语义色：≥95% 绿 / 85-95% 琥珀 / <85% 红；无预算显示 "–" 灰）
  - 小字体区：累计实际 / 同比（红涨绿跌胶囊，`finance.red`/`finance.green`）/ 累计预算达成率（同三级色）
  - 底部迷你趋势图（ECharts sparkline，财年内逐月本月合计）
  - 整卡可点击钻取财务指标页
- **财年趋势卡**：指标 Tabs（收入/毛利/净利润）切换，本月合计柱（品牌橙）+ 上年同期柱（灰蓝）+ 月度预算虚线（紫）；X 轴为所选财年 12 个月，保留网格线（财务数据需精确读数），高度 `h-[260px] lg:h-[320px]`
- **应收账款分布卡**：横向条形图（余额降序），卡头单体/汇总口径 Tabs，期间跟随看板
- **存货品类占比卡**：环形图（品类本期金额占比，与库存管理同源），卡内独立公司筛选，点击扇区跳转库存页
- **预警提醒**：amber/red 色 Alert 列表，标题带未确认计数 Badge（含 error 级时 destructive 变体）
- **快捷入口**：4 个直达按钮（导入数据 / 新建报告 / 财务指标 / 往来分析），hover 边框转 `primary`

### 5.4 财务指标页

- **筛选栏**：Tab 切换（经营指标 / 静态指标）+ 公司/月份/科目下拉
- **数据表格**：ProTable（虚拟滚动、固定列、可排序）
  - 列：公司 | 科目 | 月份 | 本月实际 | 预算 | 达成率 | 同比
  - 金额右对齐，`font-num` 数字字体
  - 达成率用 Badge 显示（success/warning）
  - 同比红涨绿跌
- **操作栏**：导出 Excel + 导入数据按钮
- **分页**：底部居中，页码按钮 Ghost 样式，当前页 Primary

### 5.5 数据导入页

- **拖拽上传区**：虚线边框（2px dashed，`border-border`），hover 边框转 `primary`（品牌橙）
- **模板类型**：Tabs 切换（经营数据 / 静态数据）
- **数据预览**：表格展示前 20 行，表头灰色背景
- **校验结果**：
  - 全部通过：绿色 Banner
  - 有错误：红色 Banner + 错误明细表格（行号、字段、错误描述）
- **操作**：确认导入（Primary）+ 取消（Secondary）

### 5.6 权限管理页

- **统计卡片**：总用户 / 已启用 / 已停用 / 预置角色
- **筛选栏**：角色下拉 + 状态下拉 + 搜索输入框
- **用户表格**：用户名 | 姓名 | 角色（Badge）| 数据范围 | 状态（Badge）| 最近登录 | 操作
- **操作**：编辑（Ghost 按钮）+ 重置密码 / 启用/停用
- **分页**：同财务指标页

---

## 6. 动画规范

### 6.1 入场动画

```css
/* 淡入上移 — 页面内容、卡片 */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
.animate-fade-in { animation: fadeIn 0.3s ease-out forwards; }

/* 缩放淡入 — Dialog、Dropdown */
@keyframes fadeInScale {
  from { opacity: 0; transform: scale(0.95); }
  to   { opacity: 1; transform: scale(1); }
}
.animate-fade-in-scale { animation: fadeInScale 0.25s ease-out forwards; }

/* 左侧滑入 — 侧边栏、菜单 */
@keyframes slideIn {
  from { opacity: 0; transform: translateX(-10px); }
  to   { opacity: 1; transform: translateX(0); }
}
.animate-slide-in { animation: slideIn 0.3s ease-out forwards; }
```

### 6.2 交互反馈

| 元素 | 反馈 | 实现方式 |
|------|------|---------|
| Button | 点击缩小 | `active: transform: scale(0.97)` |
| Button | Hover | `transition: background 0.15s ease` |
| Card | Hover 提升 | `transition: box-shadow 0.2s ease` |
| Table Row | Hover 高亮 | `transition: background 0.15s ease` |
| Input | Focus 光环 | `transition: border-color 0.15s, box-shadow 0.15s` |
| Tooltip | 显示/隐藏 | `transition: opacity 0.15s, visibility 0.15s` |

### 6.3 骨架屏

```css
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
.skeleton {
  background: linear-gradient(
    90deg,
    hsl(var(--muted)) 25%,
    hsl(var(--border)) 50%,
    hsl(var(--muted)) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}
```

### 6.4 不使用以下动画

- ❌ 页面切换过渡（路由动画）
- ❌ 列表项重排动画（layout animation）
- ❌ 复杂的手势动画（拖拽、滑动手势）
- ❌ 弹簧物理动画（spring physics）

---

## 7. 性能优化策略

### 7.1 构建优化

| 策略 | 实现 | 状态 |
|------|------|:----:|
| 代码分割 | 路由级别 `React.lazy()` + `Suspense`（`App.tsx` 9 个页面全部懒加载） | ✅ 已落地 |
| 组件懒加载 | ProTable 动态 import（`pro-data-table.tsx` → `React.lazy(() => import('./pro-table-inner'))`，antd 及 ProTable 不进首屏 chunk） | ✅ 已落地 |
| Tree Shaking | ECharts 按需注册：统一经 `components/charts/echarts-core.ts`（`echarts/core` + `echarts-for-react/lib/core`，仅注册 Bar/Line/Grid/Tooltip/Legend/DataZoom/SVGRenderer）。**新增图表类型必须同步补注册，否则运行时图表空白** | ✅ 已落地（1146KB → 590KB，↓48%） |
| 导出库懒加载 | exceljs / jspdf / docx / file-saver 全部改为函数内 `await import()`（`lib/export.ts`、`report-export.ts`、`import-template.ts`、`transactions/trend-card.tsx`） | ✅ 已落地 |
| 无用依赖清除 | 移除 `xlsx`、`sanitize-html`、`@types/sanitize-html`（前端零引用；HTML 净化用 dompurify，Excel 解析在后端） | ✅ 已落地（-28 包） |
| manualChunks 策略 | 仅保留 `vendor-react` / `vendor-query`。**刻意不再手动分组 echarts/exceljs 等** —— 显式分组会把它们重新拉成静态 chunk，抵消动态 import | ✅ 已落地 |
| 图片优化 | SVG 图标（Lucide React），无位图资源 | ✅ 已落地 |

**实测首屏体积**（`node scripts/measure-bundle.mjs` 解析 `dist/index.html` 的 entry + modulepreload）：

| 项 | 优化前 | 优化后 |
|----|-------|-------|
| 首屏 JS+CSS（gzip） | — | **176.5 kB** |
| `vendor-charts` / `echarts-core` | 1146 kB（gzip 386 kB，**进首屏**） | 590 kB（gzip 202 kB，**按需**） |
| `vendor-excel` / `exceljs` | 938 kB（gzip 271 kB，**进首屏**） | 917 kB（gzip 265 kB，**按需**） |
| jspdf + html2canvas | 进首屏 | 按需（382 kB + 198 kB） |

> 首屏 gzip 176.5 kB 仍略高于 §7.3 的 150 kB 目标，剩余空间主要在 entry chunk（434 kB / gzip 137 kB，含 Radix + axios + zustand + 共享组件）。进一步优化需拆分共享组件层，收益递减，暂不推进。



### 7.2 运行时优化

| 策略 | 实现 |
|------|------|
| 虚拟滚动 | 表格 > 100 行时启用 ProTable 虚拟滚动 |
| 防抖查询 | 搜索框输入 300ms 防抖后触发 API |
| 缓存策略 | React Query `staleTime: 5 * 60 * 1000`（5分钟）|
| 骨架屏 | 首屏用 Skeleton 占位，数据到达后淡入 |
| 图表优化 | ECharts 关闭动画（`animation: false`），提升渲染性能 |

### 7.3 加载策略

```
首屏加载：
├── HTML + CSS（内联关键样式）
├── JS Bundle（gzip 后目标 < 150KB）
│   ├── React + React DOM（~40KB）
│   ├── Tailwind CSS（Purge 后 ~10KB）
│   ├── Zustand + React Query（~20KB）
│   ├── ECharts 核心（~30KB）
│   └── 业务代码（~50KB）
└── 数据 API（并行加载）

目标 FCP < 1.5s, LCP < 2.5s（内网环境）
```

---

## 8. 响应式策略

| 断点 | 设备 | 布局调整 |
|------|------|---------|
| `≥1280px` | 桌面 | 完整布局，4 列 KPI 卡片（`xl:grid-cols-4`） |
| `1024-1279px` | 小桌面 | 2 列 KPI，侧边栏收起 |
| `768-1023px` | 平板 | 2 列 KPI，表格横向滚动 |
| `<768px` | 手机 | 1 列 KPI，卡片垂直堆叠，侧边栏改为汉堡按钮唤起的抽屉（同 §5.1） |

### 8.1 表格移动端处理

- 横向滚动（`overflow-x: auto`）
- 关键列（公司、科目、金额）固定，其余列可滚动
- 筛选栏折叠为顶部抽屉

---

## 9. 开发规范

### 9.1 文件组织

```
src/
├── components/
│   ├── ui/              # 基础组件（Radix 封装：Button, Card, Input, Badge, Tabs, Dialog, Switch, Skeleton, Tooltip, Select, Textarea, Collapsible…）
│   ├── data-table/      # 表格（data-table, pagination, pro-data-table, pro-table-inner[懒加载]）
│   ├── charts/          # 图表封装（TrendChart, KpiSparkline）
│   ├── layout/          # 布局（main-layout, sidebar, header, nav-items, require-permission）
│   ├── subject-tree/    # 科目树面板
│   ├── dimension/       # 维度维护
│   └── indicators/      # 指标页专用组件（分析抽屉等）
├── pages/
│   ├── login/           ├── dashboard/       ├── indicators/
│   ├── transactions/    ├── inventory/       ├── reports/
│   ├── tools/           ├── data/            └── admin/
├── hooks/
│   ├── useAuth.ts       # 认证
│   ├── usePermission.ts # 权限判定（守卫 + 导航过滤）
│   └── api-queries.ts   # React Query hooks 集中定义
├── stores/
│   ├── authStore.ts     # Zustand：登录态
│   └── periodStore.ts   # Zustand：全局财年选择
├── lib/
│   ├── utils.ts         # cn() + 金额/数量/比率格式化
│   ├── api.ts           # API 封装
│   ├── permissions.ts   # 资源码常量
│   ├── ai-stream.ts     # SSE 消费
│   └── constants.ts
├── styles/
│   └── globals.css      # Tailwind + Design Token
└── types/
    └── index.ts
```

> 页面目录已覆盖 9 个模块（含规范初版未列的 `transactions`/`inventory`/`reports`/`tools`，`import` 已并入 `data`），与 `web/src/App.tsx` 路由一一对应。


### 9.2 命名规范

| 类别 | 规范 | 示例 |
|------|------|------|
| 组件 | PascalCase | `KpiCard`, `DataTable` |
| 文件 | kebab-case | `kpi-card.tsx`, `data-table.tsx` |
| Hooks | camelCase, use 前缀 | `useAuth`, `useTableFilter` |
| 类型 | PascalCase, 后缀 | `UserRole`, `KpiDataItem` |
| CSS 类 | Tailwind 类名 | `bg-white border border-gray-200 rounded-xl` |
| 工具函数 | camelCase | `cn()`, `formatCurrency()` |

### 9.3 类名管理

```typescript
// lib/utils.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 使用示例
<button className={cn(
  'btn btn-primary',
  isLoading && 'opacity-50 cursor-not-allowed',
  className
)}>
```

---

## 10. 实施计划（7 人日）

| 阶段 | 天数 | 任务 | 产出 |
|------|------|------|------|
| **Day 1** | 0.5 | Design Token 搭建 + Tailwind 配置 | `globals.css`, `tailwind.config.js` |
| | 0.5 | 基础组件库（Button, Card, Input, Badge, Tabs） | `components/ui/` |
| **Day 2** | 1 | 表格组件（Table + Pagination + ProTable 集成） | `components/data-table/` |
| **Day 3** | 1 | 图表组件（ECharts 封装）+ 看板页面 | `pages/dashboard/` |
| **Day 4** | 1 | 财务指标页 + 筛选/排序/导出 | `pages/indicators/` |
| **Day 5** | 1 | 数据导入页（拖拽上传 + 校验） | `pages/import/` |
| **Day 6** | 1 | 权限管理页 + 登录页 | `pages/admin/`, `pages/login/` |
| **Day 7** | 0.5 | 响应式适配 + 性能优化 | 全端适配 |
| | 0.5 | 联调 + 文档 | 可交付代码 |

---

## 11. 对比总结

| 指标 | 现有方案（v2） | 本方案（v3） | 提升 |
|------|---------------|-------------|------|
| Bundle 体积 | ~280KB（gzip） | ~150KB（gzip） | ↓ 46% |
| 首屏动画依赖 | Framer Motion（50KB） | 纯 CSS（0KB） | 移除 |
| 组件库依赖 | AntD 全量（120KB） | AntD 仅表格（~20KB）+ Shadcn | ↓ 83% |
| 样式可控性 | 低（AntD 样式覆盖困难） | 高（Tailwind 原子类） | 显著提升 |
| 暗色模式 | P0 强制实现 | P2 再做 | 节省 2-3 人日 |
| 设计一致性 | 依赖开发者自律 | Design Token 强制约束 | 显著提升 |
| 可维护性 | 中（散落样式） | 高（组件化 + Token 化） | 显著提升 |

---

> **结论**：本方案在保持「简洁专业」视觉风格的同时，通过「Radix + Shadcn + Tailwind」替换 AntD 全量，「CSS Animation」替换 Framer Motion，「Design Token」替换硬编码样式，实现了更轻量、更可控、更易于维护的前端架构。7 人日即可完成 P0 核心链路（登录 → 看板 → 财务指标 → 数据导入 → 权限管理）的 UI 开发。

---

## 变更记录

### v4.0（2026-08-13）

**侧边栏三风格重构 + 主题系统替换（视觉伴侣渲染评审 + 提问确认）**：

- 彻底替换主题系统：删除 6 套品牌主题色与亮暗模式（`html[data-theme]` / `html.dark` 全部移除），仅保留 3 种侧边栏风格（浅色 / 深紫 / 深色），Header 切换器改为 3 色块圆点；`themeStore` 重构为 `{ sidebarStyle }`（localStorage `sidebar-style-storage`，旧 `brand-theme-storage` 残留自动失效）。
- 主页面恒白：三种风格下 `--background` / `--page` / `--card` 均为纯白；顶栏 `bg-background` + `border-b`（不再与侧边栏同步）。
- 交互元素跟随侧边栏主题色：`--primary` / `--ring` / `--chart-1` / 辅助色按风格切换（浅色橙 #FF830F / 深紫 #472159 / 深色 #1F2937），按钮 / 链接 / 图表主色 / 折叠条 hover 与收起态均跟随；ECharts 恒亮色 ink，antd ProTable 恒 lightAlgorithm（`SIDEBAR_PRESETS` hex 镜像）。
- 侧边栏三风格色板：浅色白底浅橙高亮（#FFE8CC/#FFB152）；深紫纯色 #472159 + 亮紫选中 ≈#3D41C6 + 白字（原紫渐变已取消）；深色 #111827 + #1F2937 选中 + 白字。
- 四角圆角悬浮设计改为**上下填满直角拼接**（同日迭代）：顶栏通栏置顶，侧边栏 Header 下方左侧上下填满（无间距/圆角/阴影），右侧 `border-r border-sidebar-border` 分界；品牌区/导航区/版本区统一背景（`--sidebar-bg` 经 `bg-sidebar-bg` 类 `hsl()` 包装使用）。

### v3.9（2026-08-13）

**纯白主题 + 辅助色主题化 + 内容区平面化（代码 + 文档双向同步）**：

- 新增纯白主题（`theme='white'`）：顶带/界面以白色为主色调（`--brand-surface` 三档 = 纯白 `0 0% 100%`），功能色用深灰蓝 `220 20% 22%`（#2F3542），Logo/导航文字深色；暗色下主色提亮为浅灰蓝 `220 15% 72%`。`themeStore`/`chart-theme.ts` 同步（THEME_KEYS 含 white）。
- 辅助色统一随品牌主题色相：`--secondary`/`--muted`/`--accent`/`--muted-foreground`/`--border`/`--input` 由固定暖灰改为各主题色相浅色调（亮色 L≈88-96%，暗色低饱和 tint L≈24-26%），次要按钮/次要文本/辅助背景/边框全部跟随当前主题。
- 顶带文字自适应：侧边栏/顶栏的 `text-white` 系列改为 `text-brand-surface-foreground` 系列（深色顶带白字/纯白顶带深字）；折叠条 hover 改前景色块 + 反色箭头，主题圆点描边用前景色。
- 内容区平面化：Card 基类去除边框与阴影（含 hover 阴影），页面 4 处显式 `border border-border shadow-sm` 冗余类清除；表格行分隔线/表头浅灰底/输入控件细边框/浮层阴影保留（可读性与层级必需）。

### v3.8（2026-08-13）

**品牌主题色换新 + 深色统一顶带（代码 + 文档双向同步）**：

色板层：
- 主题色 5 套换新：品牌橙 `#FF830F`（`29 100% 53%`，默认）/ 罗兰紫 `#7E6BC4`（`253 43% 59%`）/ 睿智蓝 `#769FCD`（`212 47% 63%`）/ 绯红 `#F85F73`（`352 92% 67%`）/ 翡翠青 `#1FAB89`（`165 69% 40%`）；原「翡翠绿」被翡翠青取代，主题 key 为 `orange/violet/blue/red/teal`（`themeStore` 同步）。
- 顶带统一深色：`--brand-surface/-2/-3` 三档同值 = 各主题深一档色（同色相 L≈40-45%），顶栏/侧边栏/折叠条背景完全一致；`--brand-surface-foreground` 转浅色（白 95%）。
- 暗色面板换新：`html.dark` 全部中性色改为 `#252A34` 系（背景 `220 17% 17%` / 页面 `220 17% 14%` / 卡片 `220 17% 21%` / 边框 `220 17% 26%` / 文字反转 `220 15% 92%`）；暗色主题提亮块按新 5 主题更新。

布局层：
- 侧边栏/顶栏文字浅色化：Logo 文字白色（`text-white`）、导航非激活白色 80% + `hover:bg-white/15`、折叠条箭头白色 70%、hover 改白色渐变；二级/三级子列表按场景区分（深色顶带内联 `onSurface='sidebar'` 浅色文字 / 白底折叠弹层 `popover` 深色文字）。
- 顶栏控件适配深色顶带：汉堡按钮/移动端品牌文字白色、财年图标与占位提示白色 70%、头像改 `bg-white/20 text-white`。
- 主题切换器调色盘图标改为**主题色圆点**（当前主题色实心圆 + 白描边）。

镜像同步：
- `chart-theme.ts`：`THEME_PRESETS` 换新 5 主题 hex（含暗色提亮值）；`DARK_CHART_INK`/`DARK_THEME_HEX` 按 `#252A34` 面板系更新。

### v3.7（2026-08-13）

**侧边栏与色调系统改造（视觉伴侣多轮评审驱动，代码 + 文档双向同步）**：

色板层：
- 新增品牌淡色阶梯变量 `--brand-surface`（顶带）/ `--brand-surface-2`（导航区）/ `--brand-surface-3`（版本区）/ `--brand-surface-foreground`，随 `data-theme` 切换（四主题同色相公式生成）；新增 `html.dark` 完整暗色色板（页面 #0D1117 / 面板 #11161D / 卡片 #161C24 / 文字 #E6EDF3 / 边框 #232B36 系，状态色提亮、primary L 55→60+ 提亮、primary-foreground 转深色）与 `html.dark[data-theme]` 品牌色提亮块。
- `--page` 由冷灰 #F5F7FA 改为纯白，卡片层次改由边框 + 阴影承担。

布局层：
- 侧边栏/顶栏品牌区同色融合为一体化顶带（无 border-b/分隔细线），导航区/版本区靠背景色差分层；选中导航项改白底（暗色面板）+ 品牌色文字 + 3px 指示条。
- 折叠按钮由底部 ghost 按钮改为右边缘全高 5px 细条：展开态透明隐形（hover 品牌色渐变+光晕+加宽），收起态常驻品牌色实心箭头反向。
- 小尺寸（<1280px）侧边栏自动折叠为图标态（matchMedia 监听，不覆盖用户持久化偏好，对齐 §8 响应式策略）。

暗色模式接线：
- `themeStore` 扩展 `{ theme, mode }`（localStorage 持久化）；主题切换器下拉尾部新增亮/暗分段（Sun/Moon）。
- `chart-theme.ts` 新增 `DARK_CHART_INK`/`DARK_THEME_HEX`/`getChartInk(mode)`/`getThemeHex(mode)`，`getChartSeries(theme, mode)` 暗色用提亮主色，`tooltipShell/titleSpan/labelSpan` 改函数接收 ink；11 个 ECharts 消费组件与 antd ProTable（`darkAlgorithm` + 暗色 token）按 mode 接线。
- `text-black` 全量改 `text-foreground`（约 30 处：ui 输入组件、表格表头/行、编辑器、rate-bar 等），暗色自动转浅色。

### v3.6（2026-08-12）

**全局组件一致性整改（审查驱动，代码 + 文档双向同步）**：

代码侧修复：
- 错误提示色收敛：操作错误/校验错误/删除按钮全部改 `text-destructive`，`text-finance-red` 仅保留数值涨跌语义（§3.2 语义边界 P0 强制）。波及 reports 三页、两个分析抽屉、ai-overview-panel、rich-text-editor。
- 新增 `ui/checkbox.tsx`（Radix Checkbox，两档尺寸、支持 indeterminate 全选），替换 7 个文件的原生 `<input type="checkbox">`（公式历史、费用映射、导入批次、往来覆盖度、存货明细、重分类科目多选）。
- 新增 `ui/sheet-shell.tsx` 抽屉共享外壳：统一遮罩 bg-black/40、容器 max-w-xl + shadow-lg、头部/关闭按钮/焦点/Escape 管理；两个分析抽屉（指标/往来）重构接入，往来抽屉关闭按钮补 aria-label。
- 新增 `ui/flash-message.tsx` 统一操作反馈（success→success-strong / error→destructive / info→primary），替换 report-editor / analysis-list 的 msg 段落与两个抽屉的 form.feedback 渲染，flash 状态区分成功/失败语义。
- 报告状态 Badge 映射统一：`lib/constants.ts` 新增 `REPORT_STATUS_LABEL` / `REPORT_STATUS_BADGE_VARIANT`，替换 reports 三页本地常量（此前编辑页全 secondary、列表页 published=default，跨页语义不一致）。
- 无障碍补齐：reports/index 新建报告对话框 4 组 Label 补 `htmlFor`/`id`（CompanySelect、MonthPicker 增补 id 透传）；formula-history-dialog 驳回原因补 Label。
- DataTable 密度 API 统一为 `density` 三档（reports 两页 `dense` → `density="dense"`）。
- 期间选择器对齐共享组件：analysis-list 期间筛选、reports/index 新建对话框期间改 `MonthPicker`（allowedPeriods 限定有数据期间，保持原行为）。
- 全站加载文案统一为全角"加载中…"（transactions 系 7 文件、App.tsx、subject-tree、import-panel、reclassify 面板等 16 处）。

文档侧同步：
- §3.2 补「语义边界」条款（finance 色仅数值涨跌，错误态一律 destructive）。
- §4.1 Button 尺寸表更正为实际实现（h-8 全档 32px、lg h-11），补 fused 变体。
- §4.3 Input/Select 高度更正为 32px（h-8）、圆角 8px。
- §4.7 Dialog 遮罩更正为 bg-black/80、圆角 8px、阴影 shadow-lg、宽度档位表；新增右侧抽屉（Sheet）规范。
- §4.8 补记 MonthPicker「全部期间」筛选用法、Checkbox 与 FlashMessage 组件约束。

### v3.5（2026-07-31）

**UI 组件简化与统一（代码 + 文档双向同步）**：

代码侧重构：
- 新增共享公司选择器 `components/filters/company-select.tsx`（`CompanySelect` 单选 + `CompanyMultiSelect` 多选），替换 5 处页面内联实现（数据浏览、存货管理、往来总览、催收管理、看板存货卡），净删约 150 行重复代码。
- 报告编辑器工具栏收敛：10 个横排按钮 → 3 个主动作（AI 概述/保存章节/发布）+「更多」DropdownMenu（7 项次动作）。
- 数据管理"科目调整/跨公司重分类"合并为 `ReclassifyMenu` 下拉，manage/reclassify 两 Tab 复用。
- 无障碍补齐：28+ 处纯图标按钮补 `aria-label`；admin/reclassify/subject 弹窗表单补 `Label htmlFor` + 控件 `id` 关联。

文档侧同步：
- 新增 §4.8 筛选器与工具栏规范（共享选择器、工具栏主动作收敛、无障碍硬性约束）。

### v3.4（2026-07-31）

**品牌橙主题全量 Token 化（代码 + 文档双向同步）**：

Token 层：
- §3.1 中性色由冷灰蓝（色相 210/222）迁移为暖中性（色相 24-30），与品牌橙同族；新增 `--page`（内容区底色）、`--info`（中性信息态，替代蓝色调色板）、`--success-strong` / `--warning-strong`（白底小字号文本 AA 变体）、`--chart-1 ~ --chart-13`（橙主导 + 和谐化多色序列）。
- §3.4 阴影改暖调（`rgb(28 20 12)`）并补 `shadow-xl`；新增 §3.5 `ease-brand` 缓动令牌。
- `tailwind.config.js` 显式 `darkMode: 'class'`：此前缺省为 `media`，而 CSS 变量无 `.dark` 覆盖，导致系统开启暗色偏好时出现「白底 + 暗色标签」错乱；改为 class 策略后 `dark:` 变体不再被误触发。
- 新增 `web/src/lib/chart-theme.ts` 作为 canvas/antd 的 hex 镜像单一来源（`CHART_SERIES` / `CHART_INK` / `THEME_HEX`）；`lib/chart-colors.ts` 的 `CATEGORY_COLORS` 改为再导出 `CHART_SERIES`。

代码侧修复：
- ProTable 主题对齐：`pro-table-inner.tsx` 的 antd `ConfigProvider` 此前仅设 `fontFamily`，排序/勾选/分页/链接沿用 antd 默认蓝 `#1677FF`；现补齐 `colorPrimary/colorLink/colorSuccess/...` 与 `Table` 组件级令牌。
- 全站 29 个文件的硬编码色清零：13 个文件约 78 处 hex（6 个 ECharts 图表的坐标轴/网格/tooltip、3 组序列色板）、16 个文件约 41 处调色板类（KPI 四色轮换、快捷入口、往来/覆盖度/催收状态胶囊、导入校验横幅、重分类提示条）全部改为令牌或 `chart-theme` 常量。
- 布局与体验：内容区 `max-w-7xl px-6 py-8` → `max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8`（宽屏表格可用宽度 +256px）；页面底色 `bg-slate-50` → `bg-page`；侧边栏激活态改品牌橙渐变 + `font-semibold`，hover 走 `bg-accent`，折叠按钮补 `aria-label` 与收起态 Tooltip；顶栏补 `shadow-sm`；`Card` 基类收敛 `transition-shadow duration-200 ease-brand`（各页面移除重复的 `bg-white`/过渡类）；登录页密码显隐按钮补 focus ring。
- `lib/constants.ts` 的 `FINANCIAL_COLORS.BUDGET_ACHIEVED` 由 `#16A34A` 对齐为 `#10B981`（同 `--success`）。

文档侧同步：
- 本文 §3.1 补令牌使用约束（禁 hex / 禁调色板类 / chart-N 轮换 / strong 变体 / hex 唯一来源 / darkMode）；§3.2 财务色改令牌类名；§5.1 布局图与侧边栏规则按实现更新。
- `docs/references/frontend.md` §2.1-§2.4、§3.1-§3.7 由品牌蓝 `#2563EB` 体系整体更正为品牌橙 + 暖中性；§2.3 字体表移除 Inter / Noto Sans SC，金额列由 JetBrains Mono 更正为 `font-num`。
- `docs/plans/整体方案v3.md` 主色行由 Brand Blue 更正为品牌橙。

### v3.3（2026-07-31）

**看板二期 UI 对齐（代码 + 文档双向同步）**：

代码侧修复：
- KPI 卡 8 处硬编码 hex 全部 Token 化（`text-muted-foreground`、`bg-muted`、`bg-red-50 text-finance-red`、`bg-green-50 text-finance-green`）。
- 预算达成率新增三级语义色（§3.2：≥95% `text-green-600` / 85-95% `text-amber-500` / <85% `text-destructive`；无预算灰色 "–"）。
- KPI 卡大字区字号收敛（26px→`text-2xl`、22px→`text-lg`），防 xl 4 列截断；整卡可点击钻取财务指标页。
- 图表卡加载态由文字改为 `.skeleton` shimmer（§6.3）；应收/存货卡图表高度改响应式 `h-[260px] lg:h-[320px]`。
- 趋势图/应收条形图/存货饼图补 `animation: false`（§7.2）。
- 预警卡标题增加未确认计数 Badge（含 error 级用 destructive 变体）。
- 快捷入口 hover 边框与「导入数据」图标色 Token 化（`hover:border-primary/50`、`bg-primary/10 text-primary`）。

文档侧同步（以实现为准）：
- §5.3 首页看板整节重写为看板二期现状（4 张核心 KPI 卡 / 财年趋势卡 / 应收分布卡 / 存货占比卡 / 预警计数 / 快捷入口）。
- §8 响应式表 KPI 列数由「5 列」更正为「xl 4 列 / sm-lg 2 列 / 手机 1 列」。

### v3.2（2026-07-31）

**设计规范一致性修复（代码 + 文档双向同步）**：

代码侧修复：
- 数字字体统一：`transactions/index.tsx` 内部往来/镜像校验/账龄等表格金额列 `font-mono` 全部改 `font-num`（10 处）；`pagination.tsx` 的 `tabular-nums` 统一为 `font-num`（3 处）；`getChangeColor` 零值由 `text-gray-500` 改 `text-muted-foreground`。
- 表头规范统一：修复 7 个文件中自写 `<table>` 的表头左对齐（collections-tab、reports/index、reports/analysis-list、formula-history-dialog、import-panel×2、transactions 内部往来/镜像表），并移除表头单元格级 `text-right`；表头文字色由 `text-muted-foreground` 统一为 `text-black`（transactions、coverage-tab、collections-tab）。
- 颜色 Token 化：dashboard 预警卡片等 14 处硬编码 hex 改为等价 Token/调色板类（`text-muted-foreground`/`bg-muted`/`text-foreground`/red-amber 系）；`main-layout` 背景 `bg-[#F8FAFC]` 改 `bg-slate-50`；错误提示 `text-red-500` 统一为 `text-destructive`（coverage-tab、collections-tab、import-dialog）；`index.html` theme-color 由 `#FF8C00` 更正为品牌橙 `#F97316`。

文档侧同步（以实现为准）：
- §3.3：Heading 补记 `CardTitle` 默认 `text-2xl` 需按层级覆盖；Body 补记表格实际 13px。
- §4.1 Button sm 高度 32px 更正为 36px；§4.2 Card 内边距更正为统一 `p-6`；§4.5 Badge 字重更正为 600。
- §4.4 表头更正为 13px/500/text-black/bg-muted-50，行字体更正为 13px；数值列对齐改写为分场景规则（对比型表格居中、明细/交叉宽表右对齐）；新增微型状态胶囊调色板条款与禁止硬编码 hex 约束。
- §5.1 补记内容区背景 `slate-50`；§5.4 清除 JetBrains Mono 残留表述；§8 手机端「底部固定导航」更正为抽屉侧边栏。

### v3.1（2026-07-30）

**主色决策落定（以实现为准）**：
- §3.1 `--primary` / `--ring` 由品牌蓝 `221 83% 53%`(#2563EB) 更正为**品牌橙** `25 95% 53%`(#F97316)；`--primary-foreground` 更正为 `0 0% 100%`；`--success` 更正为 `160 84% 39%`(#10B981)。三项均与 `web/src/styles/globals.css` 一致。
- §4.1 Button：primary 描述改「橙底白字」，补 `link` 变体，新增「变体一律用 Design Token 类名、禁止硬编码色值」约束。
- §4.3 Input/Select：Focus 由硬编码 `#2563EB` + rgba 阴影改为 `focus-visible:ring-2 ring-ring ring-offset-2`；补记正文纯黑（`text-black`）。
- §4.5 Badge：语义变体表由硬编码 hex 改为实际 Token/类名（对齐 `components/ui/badge.tsx`）。
- §5.5 拖拽上传区 hover 由「变蓝」改为「转 primary」。

**字体体系改写**：
- §3.3 整表替换为全站微软雅黑（`font-sans`）+ 数字专用 `font-num`（微软雅黑 + `tnum` 等宽数字）；明确废止 Inter / Noto Sans SC / JetBrains Mono；补记表单正文纯黑。

**表格规范细化**：
- §4.4 表头补「所有标题行单元格一律居中」；关键列改按 `value_type` 分型渲染（amount 千分位 2 位小数、quantity 千分位整数、ratio 百分比 1 位小数），单位"万"以小字后缀独立渲染；金额列字体由 JetBrains Mono 改为 `font-num`。

**布局改写**：
- §5.1 由「顶部 Header 承载导航」改写为「左侧 Sidebar（展开 240 / 收起 64，localStorage 持久化，移动端抽屉）+ 顶栏 56px（财年选择 + 用户菜单）+ `max-w-7xl` 内容区」，并补记导航按 `usePermission` 过滤。

**目录结构与依赖说明同步**：
- §9.1 补齐实际 9 个页面模块、`subject-tree`/`dimension`/`indicators` 组件目录、`periodStore`、`api-queries`、`ai-stream`、`permissions` 等（`import/` 已并入 `data/`）。
- §2.1 补「落地说明」：`antd` 作为 ProTable 必需 peer 依赖保留，仅 `pro-table-inner.tsx` 引用且经 `React.lazy` 懒加载，不进首屏；`ui/` 为基于 Radix 手写封装而非 shadcn CLI 产物。
- §7.1 标注已落地项（路由懒加载、ProTable 动态 import）与待办项（ECharts 按需引入、导出库懒加载），并附实测 chunk 体积。

> 依据：`docs/archive/文档与代码差异对齐报告-2026-07-30.md` §五、§六(3)。本次为**纯文档同步，前端代码零改动**。


### v3.0（2026-07-21）

- 初版：纸质感方案，替换 v2 毛玻璃 + AntD 全量 + Framer Motion。

---

*文档版本：v3.5 | 初版 2026-07-21 / 更新 2026-07-31 | 设计负责人：蟹蟹 🦀*
