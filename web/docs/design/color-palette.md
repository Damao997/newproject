# 色板总览 · 蓝 / 橙 / 灰

> AntD 风格 · 4 套色彩方案 · 财年经营数据分析平台

本文档梳理全站色彩系统：4 套侧边栏风格预设（浅色/紫渐变/深色/antd 深蓝）+ 3 套基础色板（蓝 / 橙 / 灰）。所有色值在 `src/styles/globals.css` 中以 HSL 三元组存储，Tailwind 通过 `hsl(var(--token))` 包装暴露；HTML 设计稿同步副本位于 `antd-style-design/colors_and_type.css`。

---

## 1. 4 套侧边栏风格预设

| 预设 | 侧边栏底色 | 主色 `--primary` | 选中背景 | 图表主色 `--chart-1` | 适用场景 |
| --- | --- | --- | --- | --- | --- |
| `light`（默认） | 白 `#FFFFFF` | 橙 `#FF830F` | 浅橙 `#FFE8CC` | `#FF830F` | 浅色调，强调品牌橙，亮色数据展示 |
| `gradient` | 深紫 `#472159` | 深紫 `#472159` | 蓝紫 `#3D41C6` | 淡紫 `#BBA9F7` | 深紫纯色侧栏，对比强烈 |
| `dark` | 深色 `#111827` | 深灰 `#1F2937` | `#1F2937` + 白字 | 亮蓝 `#7A9BF2` | 深色背景，弱化视觉疲劳 |
| `antd` | antd 深蓝 `#001529` | antd 蓝 `#1677ff` | `#1677ff` | `#1677ff` | 与 AntdProvider/ProTable 风格统一 |

> **实现位置**：`src/styles/globals.css` 的 `:root[data-sidebar='xxx']` 块。由 Header 风格切换器写入 `html[data-sidebar]`，CSS 变量自动级联。

主页面恒白：4 套风格下 `--background / --page / --card` 均为纯白，卡片层次由边框 + 阴影承担，主题色切换不影响内容区。

---

## 2. 3 套基础色板

### 2.1 AntD 蓝（Brand）— 13 级

| 级别 | 颜色 | 用途 |
| --- | --- | --- |
| `blue-1` ~ `blue-3` | `#E6F4FF` 系 | 最浅 hover 底 / 浅色块 |
| `blue-4` ~ `blue-5` | `#BAE0FF` 系 | chip / 标识 / 输入聚焦环 |
| `blue-6` ~ `blue-7` | `#91CAFF` 系 | 边框 / 描边 / 选中背景 |
| **`blue-8`** | **`#1677FF`** | **主色（默认）** |
| `blue-9` | `#0958D9` | 按下 / 激活 |
| `blue-10` | `#003EB3` | 重点标题 |
| `blue-11` | `#002C8C` | 深色主题 |
| `blue-12` ~ `blue-13` | `#001D66` → `#001529` | antd 侧栏底色 |

**token 名**：`--blue-1` ~ `--blue-13`（HSL 三元组）

### 2.2 强调橙（Orange）— 9 级

| 级别 | 颜色 | 用途 |
| --- | --- | --- |
| `orange-50` | `#FFF6E6` | 浅底 hover |
| `orange-100` | `#FFE0B0` | chip / 标签底 |
| `orange-300` | `#FFB74D` | 弱化强调 |
| `orange-400` | `#FFA42B` | 文字色（hover） |
| **`orange-500`** | **`#FF830F`** | **品牌橙（与 `--primary` 对齐）** |
| `orange-600` | `#E5750A` | 按下态 |
| `orange-700` | `#C46208` | 重点标题 |
| `orange-800` | `#9C4F06` | 极深强调 |
| `orange-900` | `#6F3A04` | 极深文本 |

**token 名**：`--orange-50` ~ `--orange-900`

### 2.3 中性灰（Ink）— 10 级

| 级别 | 颜色 | 用途 |
| --- | --- | --- |
| `ink-1` | `#FFFFFF` | 白底 / 卡片底 |
| `ink-2` | `#FAFAFA` | 次浅底（hover/次级） |
| `ink-3` | `#F5F5F5` | 禁用态 / 浅底 |
| `ink-4` | `#EEEEEE` | 表头底 |
| `ink-5` | `#E0E0E0` | 边框 |
| `ink-6` | `#CCCCCC` | 禁用文字 |
| `ink-7` | `#B3B3B3` | 占位文字 |
| `ink-8` | `#999999` | 弱文字 |
| `ink-9` | `#666666` | 次要文字 |
| `ink-10` | `#242424` | 主要文字 |

**token 名**：`--ink-1` ~ `--ink-10`

---

## 3. 5 类状态色（× 6 级）

每类状态色提供 50 / 100 / 300 / 500 / 700 / 900 共 6 级，500 与主值（`--success / --warning / --destructive / --info`）对齐。

| 状态 | 50（最浅） | 100 | 300 | **500（主）** | 700 | 900 |
| --- | --- | --- | --- | --- | --- | --- |
| `success` | `#ECFDF3` | `#D1FADF` | `#6CE9A6` | `#00B96B` | `#027A48` | `#054F31` |
| `warning` | `#FFFBE6` | `#FFF1B8` | `#FFD666` | `#FFCC00` | `#AD6800` | `#874D00` |
| `destructive` | `#FFF1F0` | `#FFCEBE` | `#FFA39E` | `#F5222D` | `#A8071A` | `#5C0011` |
| `info` | `#E6F4FF` | `#BAE0FF` | `#69B1FF` | `#1677FF` | `#0050B3` | `#002766` |
| `neutral` | `#F5F5F5` | `#E8E8E8` | `#BFBFBF` | `#8C8C8C` | `#4D4D4D` | `#262626` |

**token 名**：`--{status}-50 / -100 / -300 / -500 / -700 / -900`

**使用约定**：
- `50 / 100` 用于 **背景填充**（chip / tag 底）
- `300` 用于 **弱化图形**（次要图表、辅助线）
- `500` 用于 **主图标 / 文字**
- `700 / 900` 用于 **强对比文字**（小字保证 AA 对比度）

---

## 4. 12 级冷灰（Cool）— 深色面板专用

用于金融/数据图表的中性背景、深色面板、阶梯式 0-11 灰阶。

| 级别 | 颜色 | 级别 | 颜色 |
| --- | --- | --- | --- |
| `cool-1` | `#F7F9FB` | `cool-7` | `#7A838F` |
| `cool-2` | `#F0F3F7` | `cool-8` | `#525A66` |
| `cool-3` | `#E5E9EE` | `cool-9` | `#363D45` |
| `cool-4` | `#D2D8E0` | `cool-10` | `#1F262C` |
| `cool-5` | `#B8C0CB` | `cool-11` | `#161A1F` |
| `cool-6` | `#949DA9` | `cool-12` | `#0C0E10` |

**token 名**：`--cool-1` ~ `--cool-12`

---

## 5. 图表序列色（13 色）

用于 ECharts 多分类场景，与品牌主色和谐化。

| token | 颜色 | 用途 |
| --- | --- | --- |
| `--chart-1` | `#FF830F` | 主色（橙）/ 4 套风格下随主题切换 |
| `--chart-2` | `#1677FF` | 信息蓝（与 `--info` 对齐） |
| `--chart-3` | `#00B96B` | 成功绿（与 `--success` 对齐） |
| `--chart-4` | `#FFA42B` | 强调橙浅 |
| `--chart-5` | `#8B7AD6` | 紫 |
| `--chart-6` | `#928E85` | 中性灰 |
| `--chart-7` | `#E55B89` | 玫红 |
| `--chart-8` | `#39A3B5` | 青 |
| `--chart-9` | `#5C9A4F` | 草绿 |
| `--chart-10` | `#D14D2E` | 砖红 |
| `--chart-11` | `#9277C0` | 淡紫 |
| `--chart-12` | `#C0A14A` | 暗金 |
| `--chart-13` | `#6B7785` | 钢灰 |

> 风格切换时仅 `--chart-1` 随 `--primary` 联动（gradient → 淡紫、dark → 亮蓝），其余 12 色保持稳定，保证图表配色跨风格一致。

---

## 6. 落地原则

1. **默认走语义色**：UI 元素优先使用 `--primary / --secondary / --muted / --destructive / --success / --warning / --info` 等语义 token，不直接引用具体级别。
2. **图表按需取级**：图表/插画/装饰元素按需取 `--blue-8` / `--orange-500` 等具体级别，配合 `--alpha`（如 `hsl(var(--blue-8) / 0.15)`）做透明度叠加。
3. **强对比文字走 `*-strong`**：白底上的小字用 `--success-strong` / `--warning-strong`，避免 500 文字与浅底对比不足。
4. **antd 风格切换安全**：4 套风格下页面底色恒白，主题色只影响交互元素，避免风格切换引起内容"重排"。

---

## 7. 文件索引

- **React 实现**：`web/src/styles/globals.css`（行 1-360 为 token 定义，行 167+ 为 4 套风格预设）
- **设计稿副本**：`antd-style-design/colors_and_type.css`（1000+ 行完整色板 + 字型 + 圆角/阴影/间距）
- **设计稿可视化**：`antd-style-design/pages/color-palette.html`
- **消费示例**：`web/src/components/ui/kpi-card.tsx`、`web/src/components/ui/heatmap.tsx`、`web/src/components/ui/stale-bar.tsx` 等
