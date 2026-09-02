# 设计令牌 · Design Tokens

> AntD 风格 · 全站统一变量 · 财年经营数据分析平台

设计令牌（Design Tokens）是 UI 系统的最小可复用单位：颜色、字体、圆角、阴影、间距、动效。本文档梳理 React 项目中所有可用 token 的命名、用途、对应 Tailwind 类。

---

## 1. 颜色令牌

### 1.1 语义色（语义层，UI 优先使用）

| Token | HSL | 默认值 | 用途 |
| --- | --- | --- | --- |
| `--background` | `0 0% 100%` | `#FFFFFF` | 页面底色（恒白） |
| `--foreground` | `24 10% 10%` | `#1F1B16` | 主文字 |
| `--card` | `0 0% 100%` | `#FFFFFF` | 卡片底色 |
| `--card-foreground` | `24 10% 10%` | `#1F1B16` | 卡片文字 |
| `--popover` | `0 0% 100%` | `#FFFFFF` | 浮层底色 |
| `--popover-foreground` | `24 10% 10%` | `#1F1B16` | 浮层文字 |
| `--page` | `0 0% 100%` | `#FFFFFF` | 内容区底色（与 background 同） |
| `--primary` | `29 100% 53%` | `#FF830F` | 主色（橙） |
| `--primary-foreground` | `0 0% 100%` | `#FFFFFF` | 主色上文字 |
| `--secondary` | `29 55% 96%` | `#FDF4E8` | 次要背景（浅橙） |
| `--secondary-foreground` | `29 55% 22%` | `#5C3D1A` | 次要文字 |
| `--muted` | `29 55% 96%` | `#FDF4E8` | 弱化背景 |
| `--muted-foreground` | `29 30% 45%` | `#8B7152` | 弱化文字 |
| `--accent` | `29 65% 94%` | `#FAEBD7` | 强调背景 |
| `--accent-foreground` | `29 60% 20%` | `#54331A` | 强调文字 |
| `--destructive` | `0 84% 60%` | `#F5222D` | 危险色（红） |
| `--destructive-foreground` | `0 0% 100%` | `#FFFFFF` | 危险色文字 |
| `--success` | `160 84% 39%` | `#00B96B` | 成功色（绿） |
| `--warning` | `45 100% 50%` | `#FFCC00` | 警告色（黄） |
| `--info` | `205 80% 38%` | `#1677FF` | 信息色（蓝） |
| `--border` | `29 20% 88%` | `#E8DDD0` | 边框 |
| `--input` | `29 20% 88%` | `#E8DDD0` | 输入框边框 |
| `--ring` | `29 100% 53%` | `#FF830F` | 聚焦环 |

### 1.2 强对比色（白底小字专用）

| Token | 用途 |
| --- | --- |
| `--success-strong` | 成功色文字（保证 AA） |
| `--warning-strong` | 警告色文字（保证 AA） |
| `--destructive-strong` | 危险色文字（保证 AA） |
| `--info-strong` | 信息色文字（保证 AA） |

### 1.3 扩展色板（13 级蓝 / 9 级橙 / 10 级灰 / 12 级冷灰）

详见 [`color-palette.md`](./color-palette.md)。

### 1.4 侧边栏专用（4 套风格预设）

| Token | 默认（light） | gradient | dark | antd |
| --- | --- | --- | --- | --- |
| `--sidebar-bg` | `#FFFFFF` | `#472159` | `#111827` | `#001529` |
| `--sidebar-fg` | `#767676` | `#EBE6FA` | `#E5E7EB` | `#FFFFFF` |
| `--sidebar-icon` | `#A3A3A3` | `#EBE6FA` | `#9CA3AF` | `#FFFFFF` |
| `--sidebar-selected-bg` | `#FFE8CC` | `#3D41C6` | `#1F2937` | `#1677FF` |
| `--sidebar-selected-fg` | `#FFB74D` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| `--sidebar-active-bar` | `#FFB74D` | `#FFFFFF` | `#FFFFFF` | `#1677FF` |
| `--sidebar-border` | `#E5E7EB` | `#623672` | `#1F2937` | `#000F1D` |
| `--sidebar-brand-fg` | `#333333` | `#FFFFFF` | `#FFFFFF` | `#FFFFFF` |
| `--sidebar-scrollbar` | `#C7CCD3` | `#623672` | `#374151` | `#001D33` |
| `--sidebar-scrollbar-hover` | `#A8AEB6` | `#7C4A91` | `#4B5563` | `#002C4D` |

---

## 2. 字体令牌

| Token | 值 | 用途 |
| --- | --- | --- |
| `--font-sans` | 系统字体栈（PingFang SC / Microsoft YaHei） | 默认 |
| `--font-mono` | `ui-monospace, SF Mono, Menlo, monospace` | 等宽（金额/代码） |
| `--font-size-xs` | `12px` | 标签 / 弱化 |
| `--font-size-sm` | `13px` | 辅助 / 表头 |
| `--font-size-base` | `14px` | 默认 |
| `--font-size-lg` | `16px` | 卡片标题 |
| `--font-size-xl` | `18px` | 区块标题 |
| `--font-size-2xl` | `20px` | PageContainer title |
| `--font-size-3xl` | `24px` | 大数字 KPI |
| `--font-size-4xl` | `28px` | 文档 H1 |
| `--font-size-5xl` | `32px` | 超大展示 |

**Tailwind 对应**：`text-xs / text-sm / text-base / text-lg / text-xl / text-2xl / text-3xl / text-4xl / text-5xl`

**等宽数字**：`font-mono tabular-nums`（用于金额、表格数字，保证列对齐）

---

## 3. 圆角令牌

| Token | 值 | 用途 |
| --- | --- | --- |
| `--radius` | `0.75rem` (12px) | 全局默认 |
| `--radius-card` | `0.5rem` (8px) | 卡片容器 |
| `--antd-radius-sm` | `4px` | 小元素（chip / tag） |
| `--antd-radius-md` | `6px` | 按钮 / 输入框 |
| `--antd-radius-lg` | `8px` | 卡片 |
| `--antd-radius-xl` | `12px` | 弹层 |

**Tailwind 对应**：`rounded-sm (4px) / rounded (6px) / rounded-md (8px) / rounded-lg (12px) / rounded-xl (16px) / rounded-2xl (24px)`

---

## 4. 阴影令牌

| Token | 值 | 用途 |
| --- | --- | --- |
| `--antd-shadow-1` | `0 1px 2px rgb(0 21 41 / 0.04), 0 1px 1px rgb(0 21 41 / 0.03)` | 卡片默认 |
| `--antd-shadow-2` | `0 3px 6px -4px rgb(0 21 41 / 0.12), 0 6px 16px rgb(0 21 41 / 0.08)` | 悬浮卡片 / 下拉 |
| `--antd-shadow-3` | `0 6px 16px -8px rgb(0 21 41 / 0.16), 0 9px 28px rgb(0 21 41 / 0.10)` | 弹层 / Dialog |

**Tailwind 对应**：`shadow-sm / shadow / shadow-md / shadow-lg`（与 antd 三档对应）

---

## 5. 间距令牌

基于 4px 步进（与 antd 风格一致）：

| Token | 值 | Tailwind |
| --- | --- | --- |
| `--space-1` | `4px` | `p-1 / gap-1` |
| `--space-2` | `8px` | `p-2 / gap-2` |
| `--space-3` | `12px` | `p-3 / gap-3` |
| `--space-4` | `16px` | `p-4 / gap-4` |
| `--space-5` | `20px` | `p-5 / gap-5` |
| `--space-6` | `24px` | `p-6 / gap-6` |
| `--space-8` | `32px` | `p-8 / gap-8` |
| `--space-10` | `40px` | `p-10 / gap-10` |
| `--space-12` | `48px` | `p-12 / gap-12` |

---

## 6. 动效令牌

| Token | 值 | 用途 |
| --- | --- | --- |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | 进场 |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` | 状态切换 |
| `--duration-fast` | `150ms` | hover / 聚焦 |
| `--duration-base` | `200ms` | 默认 |
| `--duration-slow` | `300ms` | 进场 / 弹层 |

**预设动画类**：
- `animate-fade-in`：淡入（`opacity 0→1` + `translateY 8→0`，300ms）
- `animate-slide-up`：上滑入场
- `animate-pulse-subtle`：轻量脉冲（在线状态点）
- `animate-shimmer`：骨架屏流光

---

## 7. Z-index 层级

| 层级 | 值 | 用途 |
| --- | --- | --- |
| 基础 | `0` | 默认 |
| 悬浮 | `10` | 卡片 hover 高亮 |
| 下拉 | `20` | Dropdown / Select 浮层 |
| 粘性 | `30` | 吸顶 header |
| 弹层 | `40` | Dialog / Drawer |
| 提示 | `50` | Tooltip / Toast |
| 模态 | `60` | Antd Modal |

---

## 8. 文件索引

- **React 实现**：`web/src/styles/globals.css`
- **Tailwind 配置**：`web/tailwind.config.ts`（在 `theme.extend` 中暴露语义色为 `bg-primary / text-primary / border-border` 等工具类）
- **设计稿副本**：`antd-style-design/colors_and_type.css`
- **可视化文档**：`antd-style-design/pages/design-tokens.html`
