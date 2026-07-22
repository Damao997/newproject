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

```css
:root {
  --background: 0 0% 100%;          /* 页面背景：纯白 */
  --foreground: 222 84% 5%;        /* 主文本 */
  --card: 0 0% 100%;                /* 卡片背景 */
  --card-foreground: 222 84% 5%;
  --muted: 210 40% 96%;            /* 禁用/表头背景 */
  --muted-foreground: 215 16% 47%; /* 辅助文字 */
  --primary: 221 83% 53%;          /* 品牌蓝：#2563EB */
  --primary-foreground: 210 40% 98%;
  --secondary: 210 40% 96%;
  --secondary-foreground: 222 47% 11%;
  --destructive: 0 84% 60%;        /* #EF4444 */
  --success: 142 76% 36%;          /* #16A34A */
  --warning: 38 92% 50%;            /* #F59E0B */
  --border: 214 32% 91%;            /* #E2E8F0 */
  --input: 214 32% 91%;
  --ring: 221 83% 53%;
  --radius: 0.75rem;               /* 12px */
}
```

### 2.2 财务专用色

| 用途 | 色值 | 说明 |
|------|------|------|
| 收入/利润增长 | `#FF3B30` | 红涨（A 股/国内财报习惯） |
| 成本/下降 | `#34C759` | 绿跌 |
| 预算达标 (≥95%) | `#16A34A` | 绿色 Badge |
| 预算预警 (85-95%) | `#F59E0B` | 琥珀色 Badge |
| 预算偏离 (<85%) | `#EF4444` | 红色 Badge |

### 2.3 字体

| 层级 | 字体 | 大小 | 字重 | 用途 |
|------|------|------|------|------|
| Display | Inter + Noto Sans SC | 24px | 700 | 页面标题 |
| Heading | Inter + Noto Sans SC | 18px | 600 | 卡片标题 |
| Body | Inter + Noto Sans SC | 14px | 400 | 正文、表格内容 |
| Caption | Inter + Noto Sans SC | 12px | 400 | 辅助文字、时间戳 |
| Mono | JetBrains Mono | 13px | 400 | 金额数字、代码 |

### 2.4 阴影

| 层级 | 阴影值 | 用途 |
|------|--------|------|
| `shadow-sm` | `0 1px 3px 0 rgb(0 0 0 / 0.05)` | 按钮、输入框 |
| `shadow-md` | `0 4px 6px -1px rgb(0 0 0 / 0.08)` | 卡片 hover |
| `shadow-lg` | `0 25px 50px -12px rgb(0 0 0 / 0.25)` | Dialog、Dropdown |

---

## 3. 组件速查

### 3.1 Button

- 高度：40px（默认）/ 32px（sm）/ 44px（lg）
- 圆角：10px（`calc(var(--radius) - 2px)`）
- 字体：14px / 500
- 过渡：`all 0.15s ease`
- 点击反馈：`active:scale(0.97)`
- 变体：primary（蓝底白字）、secondary（灰底深字）、outline（白底灰边框）、ghost（透明）、destructive（红底白字）

### 3.2 Card

- 背景：白色
- 边框：`1px solid #E2E8F0`
- 圆角：12px（`var(--radius)`）
- 阴影：`shadow-sm` 默认，hover 时 `shadow-md`
- 过渡：`box-shadow 0.2s ease`

### 3.3 Table（数据表格）

- 容器：`1px solid #E2E8F0`，圆角 12px，`overflow: hidden`
- 表头：背景 `#F1F5F9`，12px / 500 / 大写，颜色 `#64748B`
- 行：14px，边框顶部 `1px solid #E2E8F0`，hover 背景 `#F8FAFC`
- 金额列：`font-family: JetBrains Mono`，右对齐
- 同比列：红涨绿跌，`font-weight: 500`
- 大数据量用 ProTable 虚拟滚动（>100 行自动启用）

### 3.4 Badge

- 圆角：9999px（胶囊形），padding：2px 10px，12px / 500
- 语义色：primary / secondary / success / warning / destructive

### 3.5 Dialog（Modal）

- 遮罩：`rgba(0,0,0,0.4)`，fadeIn 0.2s
- 内容：白色，圆角 12px，`1px solid #E2E8F0`，`shadow-lg`
- 动画：fadeInScale 0.25s

### 3.6 Tabs

- 容器：背景 `#F1F5F9`，圆角 10px，padding 4px
- 激活态：白色背景 + `#0F172A` 文字 + `shadow-sm`

### 3.7 Input / Select

- 高度：40px，圆角 10px，边框 `1px solid #E2E8F0`
- Focus：`border-color: #2563EB` + `box-shadow: 0 0 0 3px rgba(37,99,235,0.1)`

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
