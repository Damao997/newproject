# 响应式断点与移动端预览

> AntD 风格 · 5 档断点 · 移动端优先（mobile-first）

本文档定义全站响应式策略：5 档断点、设备壳预览、关键页面 390px 适配策略、横向/纵向布局切换规则。

---

## 1. 5 档断点

| 断点 | 区间 | 设备 | 布局策略 | 侧栏 | 字号基数 |
| --- | --- | --- | --- | --- | --- |
| `mobile-portrait` | ≤ 480px | iPhone SE / 12 mini | 单列 + 底部 tab bar | 抽屉式 | 13px |
| `mobile-landscape` | 481-768px | iPhone 横屏 / 小平板 | 单列 + 顶部菜单按钮 | 抽屉式 | 13px |
| `tablet` | 769-1024px | iPad | 双列 + 80px 折叠侧栏 | 80px 折叠 | 14px |
| `desktop` | 1025-1440px | 主流笔电 | 多列 + 240px 完整侧栏 | 240px | 14px |
| `wide` | ≥ 1441px | 外接显示器 | 多列 + 更大留白 | 240px | 14px |

**CSS 变量**：
```css
:root {
  --bp-1: 480px;   /* mobile-portrait 上限 */
  --bp-2: 768px;   /* mobile-landscape 上限 */
  --bp-3: 1024px;  /* tablet 上限 */
  --bp-4: 1440px;  /* desktop 上限 */
}
```

**策略**：**移动端优先（mobile-first）**，断点用 `min-width` 升序：
```css
/* 默认（mobile） */
.kpi-grid { grid-template-columns: 1fr; }

/* ≥ 481px */
@media (min-width: 481px) { .kpi-grid { grid-template-columns: 1fr 1fr; } }

/* ≥ 769px */
@media (min-width: 769px) { .kpi-grid { grid-template-columns: repeat(4, 1fr); } }
```

**Tailwind 工具类对应**：
| 断点 | 前缀 |
| --- | --- |
| mobile-portrait（默认） | （无前缀） |
| mobile-landscape | `sm:` (≥640px，接近 481-768 段) |
| tablet | `md:` (≥768px) |
| desktop | `lg:` (≥1024px) |
| wide | `xl:` (≥1280px) / `2xl:` (≥1536px) |

> **注**：项目以 `min-width` 升序实现，Tailwind 默认也是移动端优先，与 antd 风格一致。

---

## 2. 设备壳预览

设计稿提供 3 个设备壳示意，用于关键页面在 390/768/1024 三档下的视觉表现：

### 2.1 iPhone 12 mini（390 × 844 → 缩放至 320 × 568）

```
┌──────────────────┐
│ ▓▓▓▓ notch ▓▓▓▓ │
├──────────────────┤
│ ← 月份切换  ▾    │  ← AppBar 40px
├──────────────────┤
│ KPI  KPI         │  ← 2 列 KPI 卡
│ KPI  KPI         │
├──────────────────┤
│ Chart            │  ← 折线图（响应式高度 64px）
├──────────────────┤
│ Table            │  ← 列表
│  ·····           │
├──────────────────┤
│  仪表  数据  我   │  ← 底部 TabBar 44px
└──────────────────┘
```

### 2.2 iPad 竖屏（768 × 1024 → 缩放至 380 × 580）

```
┌──────────────────┐
│  ☰  标题    搜索  │  ← AppBar
├──────────────────┤
│ 80│   KPI × 4     │  ← 80px 折叠侧栏
│ px│  Chart         │
│ 侧│  Table         │
│ 栏│                │
└──────────────────┘
```

### 2.3 iPad 横屏 / 桌面（1024+ → 540 × 640）

```
┌──────────────────────────────────┐
│  ☰ 面包屑       主题  通知  用户 │
├──────┬───────────────────────────┤
│ 160  │  KPI × 4                  │
│ 侧栏 │  Chart                    │
│      │  Chart                    │
│  仪表 │  Table                    │
│  数据 │                            │
│  报表 │                            │
└──────┴───────────────────────────┘
```

---

## 3. 关键页面 390px 适配策略

### 3.1 仪表盘 / 经营分析

| 桌面布局 | 移动端改造 |
| --- | --- |
| 4 列 KPI 卡 | **2 列**（grid-cols-2） |
| 2 列图表（主+副） | **单列堆叠** |
| 表格 | **横滑**（`overflow-x-auto`） |
| 顶部 4 菜单 | **底部 tab bar**（仅 4 个核心入口） |

### 3.2 报表 / 列表

| 桌面布局 | 移动端改造 |
| --- | --- |
| 表格行（多列） | **卡片化**（行 → 卡） |
| 工具栏（按钮组） | **折叠到"更多"** |
| 筛选器横排 | **抽屉式筛选** |
| 分页（10/20/50） | **加载更多**（"点击加载更多"按钮） |

### 3.3 表单

| 桌面布局 | 移动端改造 |
| --- | --- |
| 2 列字段 | **单列堆叠** |
| 标签左对齐 | **标签上对齐**（`flex-col`） |
| 模态居中 | **底部弹出 sheet** |
| 提交按钮右下 | **底部固定吸底** |

### 3.4 详情页

| 桌面布局 | 移动端改造 |
| --- | --- |
| Tabs 横排 | **横向滚动 Tabs**（`overflow-x-auto`） |
| 左右双列 | **单列堆叠** |
| 面包屑 | **返回箭头**（点击回上一页） |
| 操作按钮横排 | **右上角下拉菜单**（"⋯"） |

---

## 4. 布局切换规则

### 4.1 侧栏行为

```
≤ 768px  : 抽屉式（默认隐藏，点击 ☰ 唤起）
769-1024 : 80px 折叠（仅图标，hover 显示 tooltip）
≥ 1025  : 240px 完整（可手动折叠为 64px）
```

**实现**：
```typescript
const isMobile = useMediaQuery('(max-width: 768px)')
const isTablet = useMediaQuery('(min-width: 769px) and (max-width: 1024px)')
const isDesktop = useMediaQuery('(min-width: 1025px)')

return {
  sidebarVariant: isMobile ? 'drawer' : isTablet ? 'mini' : 'full'
}
```

### 4.2 顶栏行为

- **桌面**：固定 56px，左对齐面包屑，右对齐操作区
- **移动**：固定 56px，左对齐返回箭头 + 当前页标题，右对齐"⋯"菜单

### 4.3 主区内边距

| 断点 | 内边距 |
| --- | --- |
| mobile-portrait | 12px |
| mobile-landscape | 16px |
| tablet | 20px |
| desktop | 24px |
| wide | 32px |

### 4.4 字号缩放

| 断点 | 标题 | 正文 | 辅助 |
| --- | --- | --- | --- |
| mobile-portrait | 16px | 13px | 12px |
| mobile-landscape | 18px | 13px | 12px |
| tablet+ | 20px | 14px | 12px |

---

## 5. 关键页面适配清单

| 路由 | 移动端优先级 | 关键改造 | 状态 |
| --- | --- | --- | --- |
| `/dashboard` | P0 | KPI 2 列 + 图表单列 + tab bar | ✅ |
| `/dashboard/analysis/keymetrics` | P0 | 4 KPI 改 2 列 + 趋势图单列 | ✅ |
| `/data/browse` | P1 | 表格卡化 + 抽屉筛选 | ✅ |
| `/reports/...` | P1 | 表格卡化 + 加载更多 | ✅ |
| `/transactions/...` | P1 | Tab 横滑 + 操作下拉 | ✅ |
| `/admin/users` | P2 | 表格卡化 + 抽屉筛选 | ✅ |
| `/tools/enterprise-lookup` | P2 | 搜索区纵向 + 详情卡堆叠 | ✅ |
| `/login` | P0 | 单列 + 表单居中 | ✅ |
| `/no-access` | P0 | 居中卡（移动友好） | ✅ |

**优先级说明**：
- **P0**：必须移动友好（高频使用）
- **P1**：基本可用（核心功能）
- **P2**：后台类（管理员/工具）

---

## 6. 触控优化

### 6.1 触控目标

- 最小触控区：**44 × 44 px**（iOS HIG）
- 按钮内边距：≥ 12px
- 列表项高度：≥ 48px

### 6.2 手势

- **左滑**：列表项操作（编辑/删除）—— 在 ProTable 移动模式启用
- **下拉刷新**：列表页顶部 —— `react-pull-to-refresh` 库
- **右滑返回**：详情页 —— `react-router` 内置手势

### 6.3 键盘

- **iOS**：自动阻止输入框被键盘遮挡（`scrollIntoView`）
- **Android**：`windowSoftInputMode="adjustResize"`

---

## 7. 性能优化

### 7.1 图片

- `srcset` + `sizes` 提供 1x/2x/3x
- WebP 优先（fallback PNG）
- `loading="lazy"`（首屏外）

### 7.2 表格

- 移动端分页：每页 10 条
- 列隐藏：移动端隐藏次要列（`responsive: ['md']`）
- 虚拟滚动：> 100 行时启用（`react-window`）

### 7.3 路由懒加载

```typescript
const Dashboard = lazy(() => import('./pages/dashboard'))
const Reports = lazy(() => import('./pages/reports'))
```

移动端首屏 JS 体积控制在 **< 200KB**（gzip）。

---

## 8. 测试断点

开发时在 Chrome DevTools 切换以下 5 档验证：

| 档位 | 宽 × 高 | 用途 |
| --- | --- | --- |
| iPhone SE | 375 × 667 | mobile-portrait 下限 |
| iPhone 12 | 390 × 844 | mobile-portrait 主流 |
| iPhone 横屏 | 844 × 390 | mobile-landscape |
| iPad 竖屏 | 768 × 1024 | tablet 下限 |
| iPad 横屏 | 1024 × 768 | tablet 主流 |
| 桌面 | 1440 × 900 | desktop 下限 |
| 外接显示器 | 1920 × 1080 | wide 验证 |

**CI 视觉回归**：通过 Playwright 在 5 档断点截图，纳入 PR review。

---

## 9. 文件索引

- **断点定义**：`web/tailwind.config.ts`（screens 配置）
- **媒体查询 hook**：`web/src/hooks/use-media-query.ts`
- **侧栏响应式**：`web/src/components/app-sidebar.tsx`（drawer/mini/full 三态）
- **页面容器**：`web/src/components/page-container.tsx`
- **设计稿**：`antd-style-design/pages/responsive-mobile.html`
- **设计快照**：`web/src/pages/design/responsive.tsx`（开发用预览）
