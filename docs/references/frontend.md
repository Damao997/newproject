# 前端开发规范（模块 4）— v3 纸质感版

> **权威前端方案**：`docs/plans/frontend-design-proposal.md`

---

## 1. 技术栈

```
React 18 + TypeScript 5.5
├── Vite 5（构建工具）
├── Tailwind CSS 3（原子样式 + Design Token CSS 变量化）
├── Radix UI（无样式 headless 组件）
├── Shadcn/ui（基于 Radix + Tailwind 的组件）
├── Ant Design 5（仅 ProTable — 虚拟滚动/固定列/可编辑单元格）
├── Zustand（状态管理）
├── React Query（数据获取/缓存）
├── ECharts 5.5（图表）
└── Lucide React（图标）
```

### 选型理由

| 决策 | 理由 |
|------|------|
| **不用 Ant Design 全量** | 全量 ~120KB（gzip），样式不可控。仅保留 ProTable 的虚拟滚动/固定列能力。 |
| **不用 Framer Motion** | ~50KB（gzip），80% 动画效果可用 CSS 实现。财务数据平台不需要复杂交互动画。 |
| **不用毛玻璃（backdrop-filter）** | 性能开销大（每层 blur 触发 GPU 合成），财务平台数据可读性优先。 |
| **P0 仅亮主题** | 暗色主题为 P2，减少初期 2-3 人日投入。 |

---

## 2. Design Token 速查

### 2.1 颜色

以品牌橙为主色、暖中性为底色。实现见 `web/src/styles/globals.css`，Tailwind 映射见 `web/tailwind.config.js`。

```css
:root {
  --background: 0 0% 100%;          /* 页面背景：纯白 */
  --foreground: 24 10% 10%;        /* 主文本：暖近黑 */
  --card: 0 0% 100%;                /* 卡片背景 */
  --card-foreground: 24 10% 10%;
  --page: 30 30% 98%;              /* 内容区底色（与卡片白底分层） */
  --muted: 30 25% 96%;             /* 禁用/表头背景 */
  --muted-foreground: 25 8% 45%;   /* 辅助文字 */
  --primary: 25 95% 53%;           /* 品牌橙：#F97316 */
  --primary-foreground: 0 0% 100%;
  --secondary: 30 25% 96%;
  --secondary-foreground: 25 20% 18%;
  --accent: 30 40% 95%;            /* hover 面（暖中性） */
  --accent-foreground: 25 25% 18%;
  --destructive: 0 84% 60%;        /* #EF4444 */
  --success: 160 84% 39%;          /* #10B981（图标/填充） */
  --warning: 38 92% 50%;            /* #F59E0B（图标/填充） */
  --success-strong: 160 84% 26%;   /* 白底小字号文本，满足 AA */
  --warning-strong: 32 90% 36%;    /* 白底小字号文本，满足 AA */
  --info: 205 80% 38%;             /* 中性信息态（替代蓝色调色板） */
  --border: 30 18% 89%;            /* #E9E2DB */
  --input: 30 18% 89%;
  --ring: 25 95% 53%;
  --radius: 0.75rem;               /* 12px */
  --chart-1 ~ --chart-13;          /* 图表序列色：橙主导 + 和谐化多色 */
}
```

**硬性约束**

- 禁止在业务代码中出现十六进制色值与 Tailwind 调色板类（`bg-blue-500`、`text-green-600` 等），一律走上表令牌。
- 白底上的小字号状态文本用 `text-success-strong` / `text-warning-strong`；图标与色块用 `text-success` / `bg-warning` 等 base 令牌。
- 图表（ECharts canvas）与 antd `theme.token` 不能吃 CSS 变量，统一从 `web/src/lib/chart-theme.ts` 取 hex 镜像（`CHART_SERIES` / `CHART_INK` / `THEME_HEX`），该文件是唯一允许出现 hex 的位置。
- `darkMode: 'class'`，平台维持纯亮色，`dark:` 变体不生效。

### 2.2 财务专用色

| 用途 | 色值 | 说明 |
|------|------|------|
| 收入/利润增长 | `#FF3B30`（`text-finance-red`） | 红涨（A 股/国内财报习惯） |
| 成本/下降 | `#34C759`（`text-finance-green`） | 绿跌 |
| 预算达标 (≥95%) | `text-success-strong` | 绿色 |
| 预算预警 (85-95%) | `text-warning-strong` | 琥珀色 |
| 预算偏离 (<85%) | `text-destructive` | 红色 |

### 2.3 字体

| 层级 | 字体 | 大小 | 字重 | 用途 |
|------|------|------|------|------|
| Display | 微软雅黑 | 24px | 700 | 页面标题 |
| Heading | 微软雅黑 | 18px | 600 | 卡片标题 |
| Body | 微软雅黑 | 14px | 400 | 正文、表格内容 |
| Caption | 微软雅黑 | 12px | 400 | 辅助文字、时间戳 |
| Number (`font-num`) | 微软雅黑 + `tnum` | 13-14px | 400-500 | 金额/数量/比率 |
| Mono (`font-mono`) | JetBrains Mono | 13px | 400 | 公式、编码 |

### 2.4 阴影

暖调阴影（褐黑而非纯黑），定义在 `tailwind.config.js` 的 `boxShadow`。

| 层级 | 阴影值 | 用途 |
|------|--------|------|
| `shadow-sm` | `0 1px 3px 0 rgb(28 20 12 / 0.05)` | 按钮、输入框、顶栏 |
| `shadow-md` | `0 4px 6px -1px rgb(28 20 12 / 0.08), 0 2px 4px -2px rgb(28 20 12 / 0.06)` | 卡片 hover |
| `shadow-lg` | `0 12px 24px -8px rgb(28 20 12 / 0.12)` | Dropdown、抽屉 |
| `shadow-xl` | `0 25px 50px -12px rgb(28 20 12 / 0.18)` | Dialog、登录卡 |

---

## 3. 组件速查

### 3.1 Button

- 高度：40px（默认）/ 36px（sm）/ 44px（lg）
- 圆角：10px（`calc(var(--radius) - 2px)`）
- 字体：14px / 500
- 过渡：`transition-colors`（0.15s）
- 点击反馈：`active:scale(0.97)`；Focus：`focus-visible:ring-2 ring-ring ring-offset-2`
- 变体：primary（橙底白字 `bg-primary text-primary-foreground`）、secondary（灰底深字）、outline（白底边框）、ghost（透明，hover 走 `bg-accent`）、destructive（红底白字）

### 3.2 Card

- 背景：`bg-card`（白）
- 边框：`1px solid hsl(var(--border))`
- 圆角：12px（`var(--radius)`）
- 阴影：`shadow-sm` 默认，hover 时 `shadow-md`
- 过渡：`transition-shadow duration-200 ease-brand`（已收敛到 Card 组件基类，页面不再重复写）

### 3.3 Table（数据表格）

- 容器：`1px solid hsl(var(--border))`，圆角 12px，`overflow: hidden`
- 表头：背景 `bg-muted/50`，13px / 500 / `text-black`，所有标题单元格居中
- 行：13-14px，边框顶部 1px，hover 背景 `bg-muted/50`
- 数值列：`font-num`（微软雅黑 + tnum），金额千分位 2 位小数、数量整数、比率百分比 1 位小数
- 同比列：红涨绿跌（`text-finance-red` / `text-finance-green`），`font-weight: 500`
- 大数据量用 ProTable 虚拟滚动（>100 行自动启用）；ProTable 主题在 `pro-table-inner.tsx` 通过 antd `ConfigProvider` 对齐品牌橙

### 3.4 Badge

- 圆角：9999px（胶囊形），padding：2px 10px，12px / 500
- 语义色：primary / secondary / success（`bg-success/15 text-success-strong`）/ warning（`bg-warning/15 text-warning-strong`）/ destructive

### 3.5 Dialog（Modal）

- 遮罩：`rgba(0,0,0,0.4)`，fadeIn 0.2s
- 内容：白色，圆角 12px，1px 边框，`shadow-xl`
- 动画：fadeInScale 0.25s

### 3.6 Tabs

- 容器：背景 `bg-muted`，圆角 10px，padding 4px
- 激活态：`data-[state=active]:bg-background` + `text-foreground` + `shadow-sm`

### 3.7 Input / Select

- 高度：40px，圆角 10px，边框 `1px solid hsl(var(--input))`
- 正文纯黑 `text-black`（财务录入可读性）
- Focus：`focus-visible:ring-2 ring-ring ring-offset-2`（光环取品牌橙）

---

## 4. 动画规范

### 4.1 入场动画（纯 CSS @keyframes）

```css
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes fadeInScale {
  from { opacity: 0; transform: scale(0.95); }
  to   { opacity: 1; transform: scale(1); }
}
@keyframes slideIn {
  from { opacity: 0; transform: translateX(-10px); }
  to   { opacity: 1; transform: translateX(0); }
}
```

### 4.2 交互反馈

| 元素 | 反馈 | 实现 |
|------|------|------|
| Button | 点击缩小 | `active:scale(0.97)` |
| Button | Hover | `transition: background 0.15s ease` |
| Card | Hover 提升 | `transition: box-shadow 0.2s ease` |
| Table Row | Hover 高亮 | `transition: background 0.15s ease` |
| Input | Focus 光环 | `transition: border-color 0.15s, box-shadow 0.15s` |

### 4.3 骨架屏

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

### 4.4 不使用

- ❌ 页面切换过渡（路由动画）
- ❌ 列表项重排动画（layout animation）
- ❌ 复杂手势动画（拖拽、滑动）
- ❌ 弹簧物理动画（spring physics）

---

## 5. 性能目标

| 指标 | 目标 |
|------|------|
| Bundle（gzip） | < 150KB |
| FCP | < 1.5s |
| LCP | < 2.5s（内网环境） |
| 虚拟滚动阈值 | 表格 > 100 行 |
| 搜索防抖 | 300ms |
| React Query staleTime | 5 分钟 |

### 构建优化

- 路由级 `React.lazy()` + `Suspense` 代码分割
- ECharts 按需引入（仅注册所需图表类型）
- ProTable 动态 `import()` 懒加载
- Tailwind CSS Purge 后 ~10KB

---

## 6. 文件组织

```
src/
├── components/
│   ├── ui/              # Shadcn 基础组件（Button, Card, Input, Badge, Tabs, Dialog, Switch, Skeleton, Tooltip）
│   ├── data-table/      # 表格相关（DataTable, Pagination, ColumnFilter）
│   ├── charts/          # 图表封装（TrendChart, KpiSparkline）
│   └── layout/          # 布局组件（Header, Sidebar, PageContainer）
├── pages/
│   ├── dashboard/
│   ├── indicators/
│   ├── import/
│   ├── admin/
│   └── login/
├── hooks/
│   ├── useAuth.ts
│   ├── useDataQuery.ts
│   └── useTableFilter.ts
├── stores/
│   └── authStore.ts     # Zustand
├── lib/
│   ├── utils.ts         # cn() 合并类名（clsx + tailwind-merge）
│   ├── api.ts           # API 封装
│   └── constants.ts     # Design Token 常量
├── styles/
│   └── globals.css      # Tailwind + CSS 变量
└── types/
    └── index.ts
```

### 命名规范

| 类别 | 规范 | 示例 |
|------|------|------|
| 组件 | PascalCase | `KpiCard`, `DataTable` |
| 文件 | kebab-case | `kpi-card.tsx`, `data-table.tsx` |
| Hooks | camelCase, use 前缀 | `useAuth`, `useTableFilter` |
| 工具函数 | camelCase | `cn()`, `formatCurrency()` |
| CSS 类 | Tailwind 类名 | `bg-white border rounded-xl` |

---

## 7. 响应式策略

| 断点 | 设备 | 布局调整 |
|------|------|---------|
| `≥1280px` | 桌面 | 完整布局，5 列 KPI 卡片 |
| `1024-1279px` | 小桌面 | 4 列 KPI，侧边栏收起 |
| `768-1023px` | 平板 | 2 列 KPI，表格横向滚动 |
| `<768px` | 手机 | 1 列 KPI，卡片垂直堆叠，底部固定导航 |

---

> **详细设计规范**见 `docs/plans/frontend-design-proposal.md`。本文件为开发阶段的快速参考卡片。
