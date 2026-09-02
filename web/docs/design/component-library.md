# 组件库总览 · 设计↔开发对照手册

> AntD 风格 · 全站复用 UI 组件 · 财年经营数据分析平台

本文档梳理全站 UI 组件：基础组件（Button/Card/Input 等）、业务组件（KpiCard/Heatmap/RingProgress 等）、图表组件、容器组件。所有组件位于 `web/src/components/ui/`，业务页面按需组合。

---

## 1. 基础组件

### 1.1 Button · 按钮

**文件**：`ui/button.tsx`  
**API**：`variant` (`default` / `destructive` / `outline` / `secondary` / `ghost` / `link`) · `size` (`sm` / `default` / `lg` / `icon`) · `asChild`

通过 **CVA**（class-variance-authority）映射变体，确保 antd 风格：

| variant | 主样式 | 用途 |
| --- | --- | --- |
| `default` | `bg-primary text-primary-foreground hover:bg-primary/90` | 主操作 |
| `destructive` | `bg-destructive text-destructive-foreground` | 危险操作（删除/作废） |
| `outline` | `border border-input bg-background hover:bg-accent` | 次要操作 |
| `secondary` | `bg-secondary text-secondary-foreground` | 辅助操作 |
| `ghost` | `hover:bg-accent hover:text-accent-foreground` | 透明背景 |
| `link` | `text-primary underline-offset-4 hover:underline` | 文字按钮 |

**与 Antd Button 共存**：业务页面使用本地 `Button`；ProTable 列内嵌操作按钮使用 `AntdButton`（从 `ui/antd-button.tsx` 引入）。

### 1.2 Card · 卡片

**文件**：`ui/card.tsx`  
**变体**：
- 默认：白底 + 8px 圆角 + 1px 边框 + `--antd-shadow-1` 阴影
- 紧凑：`CardCompact` — 无 padding，用于行内卡片
- 突出：`Card` + `className="border-primary"` — 强调边框
- 渐变 hero：用于 enterprise-lookup 搜索区

**子组件**：`CardHeader` / `CardTitle` / `CardDescription` / `CardContent` / `CardFooter` / `CardAction`

### 1.3 Input / Textarea / Select

| 组件 | 文件 | 关键属性 |
| --- | --- | --- |
| Input | `ui/input.tsx` | `placeholder` / `disabled` / `prefix` / `suffix` |
| Textarea | `ui/textarea.tsx` | `rows` / `autoSize` |
| Select | `ui/select.tsx` | Radix 包装；支持搜索/多选/分组 |
| Checkbox | `ui/checkbox.tsx` | Radix 包装；indeterminate 态 |
| Switch | `ui/switch.tsx` | AntdSwitch 包装；`size: 'small' \| 'default'` |

### 1.4 Tabs · 标签页

**文件**：`ui/tabs.tsx`（Radix UI Tabs 包装）  
**API**：`defaultValue` / `value` / `onValueChange`  
**子组件**：`TabsList` / `TabsTrigger` / `TabsContent`

视觉对齐 antd：下划线高亮 2px + 主色，选中态用 `text-primary border-b-2 border-primary`。

### 1.5 Dialog / Sheet / Drawer

| 组件 | 文件 | 用途 |
| --- | --- | --- |
| `Dialog` | `ui/dialog.tsx` | 模态弹窗（Radix Dialog） |
| `Sheet` | `ui/sheet-shell.tsx` | 侧滑抽屉 |
| `ConfirmDialog` | `ui/confirm-dialog.tsx` | 确认弹窗（高危操作） |
| Antd Modal | `ui/antd-modal.tsx` | 与 ProTable 配合的大型表单 |

### 1.6 DropdownMenu · 下拉菜单

**文件**：`ui/dropdown-menu.tsx`（Radix DropdownMenu）  
**API**：标准 Radix 风格，支持 `Sub` / `CheckboxItem` / `RadioItem`。

### 1.7 Tooltip / Popover

| 组件 | 文件 | 用途 |
| --- | --- | --- |
| Tooltip | `ui/tooltip.tsx` | 文字提示（hover 300ms 延迟） |
| Popover | `ui/popover.tsx` | 浮层卡片（可含交互） |

### 1.8 Badge / Pill / Tag · 标签

| 组件 | 文件 | 用途 |
| --- | --- | --- |
| `Badge` | `ui/badge.tsx` | 数字徽标 |
| `Pill` | `ui/pill.tsx` | 圆角标签（状态色 6 级） |
| `RankBadge` | `ui/rank-badge.tsx` | 排名徽章（金/银/铜渐变） |

### 1.9 EmptyState · 空状态

**文件**：`ui/empty-state.tsx`  
**API**：`icon` / `title` / `description` / `action`  
**样式**：居中、72px 图标（muted-foreground 色）、12px 文字、底部可选 CTA 按钮。

### 1.10 Skeleton · 骨架屏

| 组件 | 文件 | 用途 |
| --- | --- | --- |
| `Skeleton` | `ui/skeleton.tsx` | 基础矩形/圆形骨架 |
| `SkeletonBlocks` | `ui/skeleton-blocks.tsx` | 预设骨架（KPI 行/表格行/卡片） |

动效：`animate-shimmer`（2s 线性循环，从左到右的浅色高光）。

### 1.11 MonthPicker · 月份选择器

**文件**：`ui/month-picker.tsx`  
**API**：`value` / `onChange` / `placeholder`  
**特性**：支持范围选择、快捷键（←/→ 切月）、月份键盘输入。

### 1.12 AlertLight · 轻提示

**文件**：`ui/alert-light.tsx`  
**API**：`variant: 'info' | 'success' | 'warning' | 'destructive'` / `title` / `description` / `icon`  
**样式**：左侧 4px 主色边 + 浅色背景 + 图标 + 文字，**无边框**以减少视觉负担。

### 1.13 AntdProvider · Antd 上下文

**文件**：`ui/antd-provider.tsx`  
**作用**：将 Antd ConfigProvider 的 theme token 与 4 套侧边栏风格联动：
- `colorPrimary` ← `--primary`
- `colorSuccess` ← `--success`
- `colorWarning` ← `--warning`
- `colorError` ← `--destructive`
- `colorInfo` ← `--info`
- `borderRadius` ← `6px`（antd-radius-md）
- `fontFamily` ← `--font-sans`

通过 CSS 变量订阅 + `useMemo` 重算，主题切换时 ProTable / Antd Modal 同步更新。

### 1.14 AntdSize

**文件**：`ui/antd-size.ts`  
**作用**：常量定义（`'small' | 'middle' | 'large'`），用于 Antd 组件 size 属性的类型提示。

---

## 2. 业务组件

### 2.1 KpiCard · 关键指标卡

**文件**：`ui/kpi-card.tsx`  
**API**：
- `label: string` — 指标名
- `value: ReactNode` — 主值（通常大字号 + mono）
- `delta?: { value: string; trend: 'up' | 'down' | 'flat' }` — 同比/环比
- `color?: 'primary' | 'info' | 'success' | 'warning' | 'destructive'` — 3px 左侧色条
- `icon?: LucideIcon`
- `footer?: ReactNode` — 底部附加信息（排名/进度条）
- `loading?: boolean`

**视觉**：8px 圆角 + 1px 边框 + 阴影，左侧 3px 色条 + 标签 + 大数字 + 趋势（绿涨红跌，可反转）。

### 2.2 Heatmap · 热力图

**文件**：`ui/heatmap.tsx`  
**API**：
- `data: number[][]` — 二维数据（行 × 列）
- `xLabels: string[]` — X 轴标签
- `yLabels: string[]` — Y 轴标签
- `colorScale?: [string, string, string, string, string]` — 5 档色阶（默认 `['#FFFBE6', '#FFB74D', '#FFA42B', '#FF830F', '#C46208]`）
- `valueFormatter?: (v: number) => string`
- `onCellClick?: (row: number, col: number, value: number) => void`

**视觉**：8px 圆角格子 + 数值居中（背景亮时用 `--ink-10` 深色，背景暗时用白字）+ tooltip 显示明细。

### 2.3 RingProgress · 环形进度

**文件**：`ui/ring-progress.tsx`  
**API**：
- `percent: number` (0-100)
- `size?: number` (默认 120)
- `strokeWidth?: number` (默认 8)
- `color?: string` (默认 `--primary`)
- `trackColor?: string` (默认 `--muted`)
- `label?: ReactNode` — 中心文字
- `subLabel?: ReactNode` — 副标题

**视觉**：SVG circle，stroke-dasharray 控制进度，中心可叠加图标/文字。

### 2.4 Steps · 步骤条

**文件**：`ui/steps.tsx`  
**API**：
- `steps: Array<{ title: string; description?: string; status?: 'wait' | 'process' | 'finish' | 'error' }>`
- `direction?: 'horizontal' | 'vertical'`
- `current: number`

**视觉**：圆形步骤（16px 直径，主色填充为已完成；边框态为进行中；灰为未开始），横向 + 2px 连接线。

### 2.5 StaleBar · 账龄条

**文件**：`ui/stale-bar.tsx`  
**API**：
- `segments: Array<{ label: string; value: number; color: string }>` — 账龄分桶
- `total?: number` — 用于计算百分比
- `showLegend?: boolean` — 是否显示图例

**视觉**：横向堆叠条（高度 12px，圆角 6px），下方图例（色点 + 名称 + 金额 + 占比%）。  
**颜色约定**：0-30 天（蓝）/ 31-60 天（青）/ 61-90 天（黄）/ 91-180 天（橙）/ 180+ 天（红）。

### 2.6 RateBar · 占比条

**文件**：`ui/rate-bar.tsx`  
**API**：
- `value: number` (0-1)
- `color?: string`
- `height?: number` (默认 6)
- `showLabel?: boolean`

**视觉**：横向条（圆角 3px），背景 `--muted`，前景主色。

### 2.7 StatusIndicator · 状态点

**文件**：`ui/status-indicator.tsx`  
**API**：`status: 'online' | 'busy' | 'offline' | 'away'` / `pulse?: boolean`  
**视觉**：8px 圆点，绿/红/灰/黄，`pulse=true` 时附加 `animate-pulse-subtle` 轻量脉冲。

### 2.8 Avatar · 头像

**文件**：`ui/avatar.tsx`  
**API**：`src?` / `name?`（取首字）/ `size?` / `shape?: 'circle' | 'square'`  
**视觉**：32/40/48px 三档，无图片时显示首字（主色底白字）。

### 2.9 FlashMessage · 闪信

**文件**：`ui/flash-message.tsx`  
**API**：`type: 'success' | 'error' | 'info' | 'warning'` / `content: string` / `duration?: number`  
**视觉**：顶部居中浮层（4s 自动消失），主色左 4px 边 + 浅底 + 图标 + 文字。

### 2.10 Label · 表单标签

**文件**：`ui/label.tsx`（Radix Label）  
**API**：`htmlFor` / 标准 label 属性  
**视觉**：13px + 弱化色 + 右下角红色 `*` 标记必填。

### 2.11 TipLabel · 提示标签

**文件**：`ui/tip-label.tsx`  
**API**：`label: string` / `tip: string`  
**视觉**：标签 + 右侧 ⓘ 图标（hover 显示 tooltip）。

### 2.12 Separator · 分割线

**文件**：`ui/separator.tsx`（Radix Separator）  
**API**：`orientation?: 'horizontal' | 'vertical'` / `decorative?`  
**视觉**：1px `--border` 色。

### 2.13 Collapsible · 折叠面板

**文件**：`ui/collapsible.tsx`（Radix Collapsible）  
**API**：标准 Radix API  
**视觉**：6px 圆角 + 1px 边框 + 展开/收起箭头（旋转 90°）。

---

## 3. 图表组件

所有图表基于 ECharts 6 封装，统一接收 `data` + `loading` + `height` + `theme`（自动跟随 4 套风格）。

| 组件 | 文件 | 用途 |
| --- | --- | --- |
| `TrendChart` | `charts/TrendChart.tsx` | 折线/面积图（趋势） |
| `MiniBarChart` | `charts/MiniBarChart.tsx` | 迷你柱状（KPI 卡内嵌） |
| `KpiSparkline` | `charts/KpiSparkline.tsx` | 极简折线（无坐标轴） |
| `KpiCard` | `ui/kpi-card.tsx` | 关键指标卡（支持 sparkline 嵌入） |
| `Heatmap` | `ui/heatmap.tsx` | 热力图（基于 SVG） |
| `RingProgress` | `ui/ring-progress.tsx` | 环形进度（基于 SVG） |
| `StaleBar` | `ui/stale-bar.tsx` | 账龄条（堆叠柱） |
| `Steps` | `ui/steps.tsx` | 步骤条（业务流程） |

**主题联动**：ECharts 实例化时读取 `getComputedStyle(document.documentElement).getPropertyValue('--chart-1')` 等关键变量，主题切换时通过 MutationObserver 监听 `data-sidebar` 属性变化并重渲染。

---

## 4. 容器组件

### 4.1 PageContainer · 页面容器

**文件**：`components/page-container.tsx`  
**API**：
- `title: string` — 页面标题（默认 20px + 600）
- `description?: string` — 副标题（13px + muted-foreground）
- `actions?: ReactNode` — 右上角操作区
- `stickyHeader?: boolean` — 头部吸顶
- `headerRef?: RefObject<HTMLDivElement>` — 用于吸顶逻辑
- `breadcrumb?: ReactNode` — 面包屑

**结构**：
```
<div ref={headerRef} sticky>
  <h1>{title}</h1>
  {description && <p>{description}</p>}
  {actions && <div slot="actions">{actions}</div>}
</div>
<div>{children}</div>
```

### 4.2 StickyHeader Hook

**文件**：`hooks/use-sticky-header.ts`  
**API**：`{ headerRef: RefObject<HTMLDivElement>; stuck: boolean }`  
**逻辑**：监听 `headerRef` 元素进入视口顶部 0 像素时，给父元素加 `is-stuck` 类（阴影 + 模糊背景）。

---

## 5. 复合业务模式

### 5.1 列表页骨架
```
PageContainer
└─ Card (筛选区)
└─ Card (操作按钮 + 表格)
    └─ ProTable
```

### 5.2 详情页骨架
```
PageContainer (含 breadcrumb)
└─ Card (基本信息)
└─ Card (Tab 切换)
    └─ Tabs
        └─ { 各 Tab 内容 }
```

### 5.3 Dashboard 骨架
```
PageContainer
└─ KpiCard 网格 (4 列)
└─ Card (主图表)
└─ 双列：Card + Card
```

### 5.4 表单页骨架
```
PageContainer
└─ Card (含 Form)
    └─ 表单分组 (Fieldset)
        └─ Label + Input
└─ 底部操作栏 (固定吸底)
    └─ 取消 + 保存
```

---

## 6. 文件索引

- **组件实现**：`web/src/components/ui/*.tsx`（40+ 文件）
- **图表实现**：`web/src/components/charts/*.tsx`
- **页面容器**：`web/src/components/page-container.tsx`
- **设计稿可视化**：`antd-style-design/pages/component-library.html`
- **Antd 集成**：`web/src/components/ui/antd-provider.tsx`（ConfigProvider 主题联动）
