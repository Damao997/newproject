# 浙江壹品慧财年经营数据分析平台 — 前端设计方案

> **版本**: v3.0  
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
- 其余组件（Button、Form、Modal、Tabs 等）用 Shadcn 实现，更轻、更可控

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
  --muted: 210 40% 96%;            /* 禁用/表头背景 */
  --muted-foreground: 215 16% 47%; /* 辅助文字 */
  
  /* 主题色 */
  --primary: 221 83% 53%;          /* 品牌蓝：#2563EB */
  --primary-foreground: 210 40% 98%;
  --secondary: 210 40% 96%;        /* 次要背景 */
  --secondary-foreground: 222 47% 11%;
  
  /* 状态色 */
  --destructive: 0 84% 60%;        /* 删除/错误：#EF4444 */
  --destructive-foreground: 210 40% 98%;
  --success: 142 76% 36%;          /* 成功/达成：#16A34A */
  --warning: 38 92% 50%;            /* 警告/待审：#F59E0B */
  
  /* 边框与输入 */
  --border: 214 32% 91%;            /* 边框：#E2E8F0 */
  --input: 214 32% 91%;
  --ring: 221 83% 53%;            /* Focus 光环 */
  
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

| 层级 | 字体 | 大小 | 字重 | 用途 |
|------|------|------|------|------|
| Display | Inter + Noto Sans SC | 24px | 700 | 页面标题 |
| Heading | Inter + Noto Sans SC | 18px | 600 | 卡片标题 |
| Body | Inter + Noto Sans SC | 14px | 400 | 正文、表格内容 |
| Caption | Inter + Noto Sans SC | 12px | 400 | 辅助文字、时间戳 |
| Mono | JetBrains Mono | 13px | 400 | 金额数字、代码 |

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
│ primary     │ 蓝底白字，hover 加深          │
│ secondary   │ 灰底深字，带边框              │
│ outline     │ 白底灰边框，hover 灰背景       │
│ ghost       │ 透明，hover 灰背景             │
│ destructive │ 红底白字，删除/危险操作        │
└─────────────┴─────────────────────────────┘
```

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
- 边框：1px solid #E2E8F0
- Focus：border-color: #2563EB, box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1)
- 背景：白色
- 字体：14px
- 占位符色：#64748B
```

### 4.4 Table（数据表格）

```
容器：
- 边框：1px solid #E2E8F0
- 圆角：12px
- overflow: hidden

表头：
- 背景：#F1F5F9
- 字体：12px / 500 / 大写 / 字间距 0.025em
- 颜色：#64748B
- 内边距：12px 16px

行：
- 字体：14px
- 内边距：14px 16px
- 边框：顶部 1px solid #E2E8F0
- hover：背景 #F8FAFC
- 过渡：background 0.15s ease

关键列：
- 金额列：font-family: JetBrains Mono, monospace; text-align: right
- 百分比列：Badge 组件（rounded-full，语义色背景）
- 同比列：红涨绿跌，font-weight: 500
```

### 4.5 Badge

```
- 圆角：9999px（胶囊形）
- 内边距：2px 10px
- 字体：12px / 500

语义变体：
┌──────────────┬─────────────────────────────┐
│ primary      │ bg: #EFF6FF, text: #2563EB  │
│ secondary    │ bg: #F1F5F9, text: #1E293B  │
│ success      │ bg: #F0FDF4, text: #16A34A  │
│ warning      │ bg: #FFFBEB, text: #D97706  │
│ destructive  │ bg: #FEF2F2, text: #EF4444  │
└──────────────┴─────────────────────────────┘
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

```
┌──────────────────────────────────────────┐
│  Header (56px, 固定吸顶)                 │
│  - Logo + 品牌名 + 导航 + 用户头像        │
│  - 底部 1px 分割线 #E2E8F0                │
├──────────────────────────────────────────┤
│  Main Content (max-width: 1280px, 居中)  │
│  - padding: 32px 24px                   │
│  - 页面标题区 + 内容区                    │
└──────────────────────────────────────────┘
```

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

- **拖拽上传区**：虚线边框（2px dashed #E2E8F0），hover 变蓝
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

| 策略 | 实现 |
|------|------|
| 代码分割 | 路由级别 `React.lazy()` + `Suspense` |
| 组件懒加载 | 表格组件按需加载（ProTable 动态 import） |
| Tree Shaking | ECharts 按需引入，仅注册所需图表类型 |
| 图片优化 | SVG 图标（Lucide React），无位图资源 |

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
│   ├── utils.ts         # cn() 合并类名
│   ├── api.ts           # API 封装
│   └── constants.ts     # Design Token 常量
├── styles/
│   └── globals.css      # Tailwind + CSS 变量
└── types/
    └── index.ts         # TypeScript 类型定义
```

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

*文档版本：v3.0 | 生成时间：2026-07-21 | 设计负责人：蟹蟹 🦀*
