# 浙江壹品慧财年经营数据分析平台 — 前端设计方案

> **版本**: v3.1  
> **日期**: 2026-07-21  
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
  /* 基础色 */
  --background: 0 0% 100%;          /* 页面背景：纯白 */
  --foreground: 222 84% 5%;        /* 主文本：深灰近黑 */
  
  /* 卡片与表面 */
  --card: 0 0% 100%;                /* 卡片背景 */
  --card-foreground: 222 84% 5%;
  --popover: 0 0% 100%;             /* 浮层（Dropdown/Select/Tooltip）背景 */
  --popover-foreground: 222 84% 5%;
  --muted: 210 40% 96%;            /* 禁用/表头背景 */
  --muted-foreground: 215 16% 47%; /* 辅助文字 */
  
  /* 主题色 */
  --primary: 25 95% 53%;           /* 品牌橙：#F97316 */
  --primary-foreground: 0 0% 100%;
  --secondary: 210 40% 96%;        /* 次要背景 */
  --secondary-foreground: 222 47% 11%;
  --accent: 210 40% 96%;           /* 强调背景（ghost/outline hover 态） */
  --accent-foreground: 222 47% 11%;
  
  /* 状态色 */
  --destructive: 0 84% 60%;        /* 删除/错误：#EF4444 */
  --destructive-foreground: 210 40% 98%;
  --success: 160 84% 39%;          /* 成功/达成：#10B981 */
  --warning: 38 92% 50%;            /* 警告/待审：#F59E0B */
  
  /* 边框与输入 */
  --border: 214 32% 91%;            /* 边框：#E2E8F0 */
  --input: 214 32% 91%;
  --ring: 25 95% 53%;             /* Focus 光环（同 primary） */
  
  /* 圆角 */
  --radius: 0.75rem;               /* 12px — 卡片级别 */
  /* 派生：md = calc(var(--radius) - 2px), sm = calc(var(--radius) - 4px) */
}
```

### 3.2 财务专用色

| 用途 | 色值 | 说明 |
|------|------|------|
| 收入/利润增长 | `#FF3B30`（红） | 红涨，符合 A 股/国内财报习惯 |
| 成本/下降 | `#34C759`（绿） | 绿跌 |
| 预算达标 | `#16A34A` | 达成率 ≥ 95% |
| 预算预警 | `#F59E0B` | 达成率 85%-95% |
| 预算严重偏离 | `#EF4444` | 达成率 < 85% |

### 3.3 字体

全站统一微软雅黑（非 Windows 环境回退 `system-ui`），不引入 Web Font，避免内网首屏字体加载抖动。

| 层级 | 字体族 | 大小 | 字重 | 用途 |
|------|--------|------|------|------|
| Display | `font-sans`（Microsoft YaHei / 微软雅黑 / system-ui） | 24px | 700 | 页面标题 |
| Heading | `font-sans` | 18px | 600 | 卡片标题 |
| Body | `font-sans` | 14px | 400 | 正文、表格内容 |
| Caption | `font-sans` | 12px | 400 | 辅助文字、时间戳 |
| **Number** | `font-num`（微软雅黑 + `font-feature-settings: "tnum"`） | 13-14px | 400/500 | **金额/数量/比率等一切数字**，等宽数字保证表格纵向对齐 |

**约束**：
- 表单输入正文使用纯黑（`text-black`），保证财务录入场景可读性。
- 数字列一律加 `font-num`；**禁止**使用 Inter / Noto Sans SC / JetBrains Mono（v3.0 曾规定，已废止）。


### 3.4 阴影

| 层级 | 阴影值 | 用途 |
|------|--------|------|
| `shadow-sm` | `0 1px 3px 0 rgb(0 0 0 / 0.05)` | 按钮、输入框 |
| `shadow-md` | `0 4px 6px -1px rgb(0 0 0 / 0.08)` | 卡片 hover |
| `shadow-lg` | `0 25px 50px -12px rgb(0 0 0 / 0.25)` | Dialog、Dropdown |

---

## 4. 组件规范

### 4.1 Button

```
基础样式：
- 高度：40px（默认）/ 32px（sm）/ 44px（lg）
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
- 边框：1px solid hsl(var(--border)) = #E2E8F0
- 圆角：var(--radius) = 12px
- 阴影：shadow-sm（默认），hover 时 shadow-md
- 内边距：card-header 20px 24px 12px, card-content 20px 24px
- 过渡：box-shadow 0.2s ease
```

### 4.3 Input / Select

```
- 高度：40px
- 圆角：10px
- 边框：1px solid #E2E8F0（`border-input`）
- Focus：`focus-visible:ring-2 ring-ring ring-offset-2`（光环取 `--ring` = 品牌橙）
- 背景：白色
- 字体：14px，正文色纯黑（`text-black`，保证表单可读性）
- 占位符色：#64748B（`placeholder:text-muted-foreground`）
```

### 4.4 Table（数据表格）

```
容器：
- 边框：1px solid #E2E8F0
- 圆角：12px
- overflow: hidden

表头：
- 背景：#F1F5F9
- 字体：12px / 500
- 颜色：#64748B
- 内边距：12px 16px
- **对齐：所有标题行单元格一律居中**（含金额列表头）

行：
- 字体：14px
- 内边距：14px 16px
- 边框：顶部 1px solid #E2E8F0
- hover：背景 #F8FAFC
- 过渡：background 0.15s ease

关键列（按 `account_subject.value_type` 分型渲染，见 `lib/utils.ts` 的 `formatMetricValue`）：
- **amount（金额）**：`font-num` + 右对齐 + 千分位 2 位小数（`formatMoneyWan`），单位"万"以小字后缀独立渲染，数值内不含"万"字
- **quantity（数量）**：`font-num` + 右对齐 + 千分位整数（`formatQuantity`），无小数
- **ratio（比率）**：`font-num` + 右对齐 + 百分比 1 位小数（`formatPercent`）
- 达成率列：Badge 组件（rounded-full，success/warning 语义色）
- 同比列：红涨绿跌（`finance.red`/`finance.green`），font-weight: 500
```

### 4.5 Badge

```
- 圆角：9999px（胶囊形）
- 内边距：2px 10px
- 字体：12px / 500

语义变体（实现见 `components/ui/badge.tsx`）：
┌──────────────┬──────────────────────────────────────────┐
│ default      │ bg-primary + text-primary-foreground（橙底白字） │
│ secondary    │ bg-secondary + text-secondary-foreground   │
│ success      │ bg-green-100 + text-green-800              │
│ warning      │ bg-amber-100 + text-amber-800              │
│ destructive  │ bg-destructive + text-destructive-foreground │
│ outline      │ 无底色，text-foreground + 边框              │
└──────────────┴──────────────────────────────────────────┘
```

### 4.6 Tabs

```
容器：
- 背景：#F1F5F9
- 圆角：10px
- 内边距：4px
- 宽度：fit-content

触发器：
- 默认：透明背景，#64748B 文字
- 激活：白色背景，#0F172A 文字，shadow-sm
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
- 边框：1px solid #E2E8F0
- 阴影：shadow-lg
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
│ 收起 64px│  - 底部 1px 分割线 #E2E8F0             │
│          ├───────────────────────────────────────┤
│ Logo+品牌│  Main Content                          │
│ ──────── │  - max-width: 1280px (max-w-7xl), 居中 │
│ 导航项   │  - padding: 32px 24px (py-8 px-6)     │
│ (按权限) │  - 独立纵向滚动                        │
│ ──────── │                                        │
│ 收起按钮 │                                        │
└──────────┴───────────────────────────────────────┘
```

**侧边栏规则**：
- 展开 `w-60`(240px) / 收起 `w-16`(64px)，收起态仅显示图标并以 Tooltip 补名称；收起状态经 `localStorage`(`sidebar-collapsed`) 持久化。
- 导航项按 `usePermission()` 过滤，仅展示当前角色具备 view 权限的模块（对齐《安全与权限规范》§2.2），资源码见 `nav-items.ts`。
- 激活态：`bg-primary/10 text-primary` + 左侧 3px 圆角竖条。
- `<768px`：侧边栏隐藏，改为顶栏汉堡按钮唤起的抽屉（含遮罩，路由切换自动关闭）。

**顶栏规则**：
- 桌面端仅承载全局财年选择器与用户菜单（品牌标识在侧边栏顶部）；移动端额外显示汉堡按钮 + 品牌标识。
- 全局财年选择影响看板/指标/数据浏览的期间候选，状态存于 `periodStore`。

### 5.2 登录页

- 居中卡片布局，max-width 400px
- 卡片：白色 + 细边框 + 圆角 12px
- 输入框：username / password
- 操作：记住我（Switch）+ 登录按钮（Primary，全宽）
- 底部：公司信息 + 版本号

### 5.3 首页看板

- **KPI 卡片区**：5 张等宽卡片（1 行 5 列），每张包含：
  - 标题（Caption 色）+ 数值（Display 字体，28px）+ 同比（Badge 色）
  - 底部迷你趋势图（ECharts，高度 40px，无网格线）
- **趋势图区**：12 个月柱状图，保留网格线（财务数据需精确读数）
- **事业部概览**：进度条形式显示预算执行率
- **预警提醒**：amber 色 Alert 卡片，顶部可关闭

### 5.4 财务指标页

- **筛选栏**：Tab 切换（经营指标 / 静态指标）+ 公司/月份/科目下拉
- **数据表格**：ProTable（虚拟滚动、固定列、可排序）
  - 列：公司 | 科目 | 月份 | 本月实际 | 预算 | 达成率 | 同比
  - 金额右对齐，字体 JetBrains Mono
  - 达成率用 Badge 显示（success/warning）
  - 同比红涨绿跌
- **操作栏**：导出 Excel + 导入数据按钮
- **分页**：底部居中，页码按钮 Ghost 样式，当前页 Primary

### 5.5 数据导入页

- **拖拽上传区**：虚线边框（2px dashed #E2E8F0），hover 边框转 `primary`（品牌橙）
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
  background: linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 50%, #F1F5F9 75%);
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
| `≥1280px` | 桌面 | 完整布局，5 列 KPI 卡片 |
| `1024-1279px` | 小桌面 | 4 列 KPI，侧边栏收起 |
| `768-1023px` | 平板 | 2 列 KPI，表格横向滚动 |
| `<768px` | 手机 | 1 列 KPI，卡片垂直堆叠，底部固定导航 |

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

*文档版本：v3.1 | 初版 2026-07-21 / 更新 2026-07-30 | 设计负责人：蟹蟹 🦀*
