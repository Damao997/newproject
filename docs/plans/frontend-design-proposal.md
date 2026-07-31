# 浙江壹品慧财年经营数据分析平台 — 前端设计方案

> **版本**: v3.4  
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
  /* 基础色（暖中性：色相 24-30，与品牌橙同族，避免冷灰蓝与橙的冲突） */
  --background: 0 0% 100%;          /* 页面背景：纯白 */
  --foreground: 24 10% 10%;        /* 主文本：暖近黑 */
  --page: 30 30% 98%;              /* 内容区底色，与卡片白底形成层次 */

  /* 卡片与表面 */
  --card: 0 0% 100%;                /* 卡片背景 */
  --card-foreground: 24 10% 10%;
  --popover: 0 0% 100%;             /* 浮层（Dropdown/Select/Tooltip）背景 */
  --popover-foreground: 24 10% 10%;
  --muted: 30 25% 96%;             /* 禁用/表头背景 */
  --muted-foreground: 25 8% 45%;   /* 辅助文字 */

  /* 主题色 */
  --primary: 25 95% 53%;           /* 品牌橙：#F97316 */
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
  --ring: 25 95% 53%;             /* Focus 光环（同 primary） */

  /* 图表序列色：橙主导 + 和谐化多色，13 色覆盖分类色板全部槽位 */
  --chart-1: 25 95% 53%;   --chart-2: 200 78% 45%;  --chart-3: 160 84% 39%;
  --chart-4: 38 92% 50%;   --chart-5: 262 58% 60%;  --chart-6: 25 12% 55%;
  --chart-7: 340 68% 55%;  --chart-8: 190 58% 42%;  --chart-9: 95 42% 42%;
  --chart-10: 12 68% 48%;  --chart-11: 280 42% 55%; --chart-12: 45 72% 44%;
  --chart-13: 210 20% 52%;

  /* 圆角 */
  --radius: 0.75rem;               /* 12px — 卡片级别 */
  /* 派生：md = calc(var(--radius) - 2px), sm = calc(var(--radius) - 4px) */
}
```

**令牌使用约束（P0 强制）**

- 业务代码禁止十六进制色值与 Tailwind 调色板类（`bg-blue-500`、`text-green-600`、`bg-slate-50` 等），一律使用上表令牌映射出的类名。
- 多彩强调位（KPI 图标、快捷入口、分类标签）使用 `bg-chart-N/10 text-chart-N`，四色轮换固定为 `chart-1 / chart-2 / chart-3 / chart-5`。
- 白底上的小字号状态文本用 `-strong` 变体；图标与色块用 base 令牌。
- ECharts（canvas 渲染）与 antd `theme.token` 无法读取 CSS 变量，统一从 `web/src/lib/chart-theme.ts` 取 hex 镜像：`CHART_SERIES`（序列色）、`CHART_INK`（坐标轴/网格/浮层）、`THEME_HEX`（antd 语义色）。该文件是全仓唯一允许出现 hex 的位置，修改颜色时必须与 `globals.css` 同步。
- Tailwind 配置 `darkMode: 'class'`：平台维持纯亮色，`dark:` 变体不会被系统偏好触发。

### 3.2 财务专用色

| 用途 | 色值 | 说明 |
|------|------|------|
| 收入/利润增长 | `#FF3B30`（`text-finance-red`） | 红涨，符合 A 股/国内财报习惯 |
| 成本/下降 | `#34C759`（`text-finance-green`） | 绿跌 |
| 预算达标 | `text-success-strong` | 达成率 ≥ 95% |
| 预算预警 | `text-warning-strong` | 达成率 85%-95% |
| 预算严重偏离 | `text-destructive` | 达成率 < 85% |

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
- 高度：40px（默认）/ 36px（sm，`h-9`）/ 44px（lg）
- 圆角：calc(var(--radius) - 2px) = 10px
- 字体：14px / 500
- 过渡：all 0.15s ease
- 点击反馈：active: scale(0.97)
- Focus：box-shadow: 0 0 0 2px hsl(var(--ring) / 0.3)

变体：
┌─────────────┬─────────────────────────────┐
│ primary     │ 橙底白字，hover 加深          │
│ secondary   │ 灰底深字，带边框              │
│ outline     │ 白底灰边框，hover 灰背景       │
│ ghost       │ 透明，hover 灰背景             │
│ destructive │ 红底白字，删除/危险操作        │
│ link        │ 无底色，primary 色文字 + hover 下划线 │
└─────────────┴─────────────────────────────┘
```

> 变体一律以 Design Token 类名实现（`bg-primary`/`text-primary-foreground`/`ring-ring`），**禁止硬编码色值**，保证换色只需改 `globals.css`。

### 4.2 Card

```
- 背景：hsl(var(--card)) = 白色
- 边框：1px solid hsl(var(--border)) = #E9E2DB
- 圆角：var(--radius) = 12px
- 阴影：shadow-sm（默认），hover 时 shadow-md
- 内边距：card-header / card-content 统一 `p-6`（24px，content 顶部由 `pt-0` 衔接）
- 过渡：`transition-shadow duration-200 ease-brand`（写在 Card 基类，页面不重复声明）
```

### 4.3 Input / Select

```
- 高度：40px
- 圆角：10px
- 边框：1px solid hsl(var(--input))（`border-input`）
- Focus：`focus-visible:ring-2 ring-ring ring-offset-2`（光环取 `--ring` = 品牌橙）
- 背景：白色
- 字体：14px，正文色纯黑（`text-black`，保证表单可读性）
- 占位符色：`placeholder:text-muted-foreground`
```

### 4.4 Table（数据表格）

```
容器：
- 边框：1px solid hsl(var(--border))
- 圆角：12px
- overflow: hidden

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
- 背景：rgba(0, 0, 0, 0.4)
- 动画：fadeIn 0.2s

内容：
- 背景：白色
- 圆角：12px
- 边框：1px solid hsl(var(--border))
- 阴影：shadow-xl
- 动画：fadeInScale 0.25s
- 最大宽度：28rem（默认）/ 32rem（大）
```

---

## 5. 页面设计规范

### 5.1 全局布局

左侧固定侧边栏 + 顶部细顶栏。实现见 `components/layout/{main-layout,sidebar,header,nav-items}.tsx`。

```
┌──────────┬───────────────────────────────────────┐
│ Sidebar  │  Header (56px)                        │
│ 展开240px│  - 财年选择器 + 用户头像下拉           │
│ 收起 64px│  - 底部 1px 分割线 + shadow-sm         │
│          ├───────────────────────────────────────┤
│ Logo+品牌│  Main Content                          │
│ ──────── │  - max-width: 1536px (max-w-screen-2xl)│
│ 导航项   │  - padding: 24px 16px → lg:32px 32px   │
│ (按权限) │  - 独立纵向滚动                        │
│ ──────── │                                        │
│ 收起按钮 │                                        │
└──────────┴───────────────────────────────────────┘
```

**侧边栏规则**：
- 展开 `w-60`(240px) / 收起 `w-16`(64px)，宽度过渡 `duration-200 ease-brand`；收起态仅显示图标并以 Tooltip 补名称（含收起/展开按钮本身），收起状态经 `localStorage`(`sidebar-collapsed`) 持久化。
- 导航项按 `usePermission()` 过滤，仅展示当前角色具备 view 权限的模块（对齐《安全与权限规范》§2.2），资源码见 `nav-items.ts`。
- 激活态：`bg-gradient-to-r from-primary/[0.12] to-primary/[0.04]` + `font-semibold text-primary` + 左侧 3px 圆角竖条；非激活 hover 走 `bg-accent hover:text-accent-foreground`。
- `<768px`：侧边栏隐藏，改为顶栏汉堡按钮唤起的抽屉（含遮罩，路由切换自动关闭）。

**顶栏规则**：
- 桌面端仅承载全局财年选择器与用户菜单（品牌标识在侧边栏顶部）；移动端额外显示汉堡按钮 + 品牌标识。
- 全局财年选择影响看板/指标/数据浏览的期间候选，状态存于 `periodStore`。
- 内容区背景为 `bg-page`（`--page`，暖白），卡片保持纯白形成层次。

### 5.2 登录页

- 居中卡片布局，max-width 400px
- 卡片：白色 + 细边框 + 圆角 12px
- 输入框：username / password
- 操作：记住我（Switch）+ 登录按钮（Primary，全宽）
- 底部：公司信息 + 版本号

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

> 依据：`docs/文档与代码差异对齐报告-2026-07-30.md` §五、§六(3)。本次为**纯文档同步，前端代码零改动**。


### v3.0（2026-07-21）

- 初版：纸质感方案，替换 v2 毛玻璃 + AntD 全量 + Framer Motion。

---

*文档版本：v3.4 | 初版 2026-07-21 / 更新 2026-07-31 | 设计负责人：蟹蟹 🦀*
