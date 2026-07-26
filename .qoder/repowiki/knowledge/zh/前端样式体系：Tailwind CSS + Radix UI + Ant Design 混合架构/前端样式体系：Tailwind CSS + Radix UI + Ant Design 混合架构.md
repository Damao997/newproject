---
kind: frontend_style
name: 前端样式体系：Tailwind CSS + Radix UI + Ant Design 混合架构
category: frontend_style
scope:
    - '**'
source_files:
    - web/tailwind.config.js
    - web/src/styles/globals.css
    - web/src/index.css
    - web/postcss.config.js
    - web/src/components/ui/button.tsx
    - web/package.json
---

## 1. 使用的系统与工具
- **CSS 框架**：Tailwind CSS v3.4（原子化 utility-first），通过 PostCSS + Autoprefixer 构建。
- **组件库**：Radix UI（无样式基础组件，如 Dialog、Select、Tabs、Tooltip 等）+ Ant Design 5（ProTable 等重型表格/表单组件）双轨并行。
- **样式变体管理**：class-variance-authority（CVA）配合 `cn`（tailwind-merge）实现按钮等可组合变体的类型安全声明。
- **动画与过渡**：tailwindcss-animate 插件提供 accordion、fade-in、slide-in、shimmer 等预设动画。
- **图标**：lucide-react 作为统一图标源。
- **富文本编辑器**：TipTap 3（starter-kit + link extension），配套 `.prose-editor` 专用排版样式。
- **图表**：ECharts 6 + echarts-for-react。

## 2. 核心文件与位置
- `web/tailwind.config.js` — Tailwind 主题扩展（颜色、圆角、字体、keyframes、animation）、`finance.red/green` 财务色、`@layer base/components/utilities` 结构。
- `web/src/styles/globals.css` — CSS 变量主题（HSL 语义色）、全局 base/reset、skeleton/shimmer 工具类、`prefers-reduced-motion` 无障碍适配、TipTap 编辑器样式。
- `web/src/index.css` — 项目级 CSS 变量（text/bg/border/accent 等）与暗色模式支持，Vite 模板遗留样式。
- `web/postcss.config.js` — PostCSS 管线（tailwindcss → autoprefixer）。
- `web/src/components/ui/*.tsx` — Radix 封装的原子 UI 组件（button、card、dialog、input、select、tabs、tooltip 等），全部使用 CVA 定义变体。
- `web/src/App.css` — Vite React 模板遗留样式，非业务代码。

## 3. 架构与约定
- **设计令牌（Design Tokens）**：所有颜色通过 CSS HSL 变量在 `:root` 中集中定义（background、foreground、primary、secondary、destructive、muted、accent、popover、card、success、warning、border、input、ring、radius），Tailwind 通过 `hsl(var(--xxx))` 引用，确保主题一致性。
- **分层组织**：`@layer base` 放全局 reset 与根变量；`@layer components` 放组件级样式；`@layer utilities` 放复用工具类（skeleton、chart-bar、finance-red/green）。
- **组件样式策略**：UI 层组件（`components/ui/*`）使用 CVA 声明 variant/size 变体，业务组件通过 `cn(...)` 合并 className，禁止在业务组件内直接写大量 Tailwind 类。
- **响应式策略**：基于 Tailwind 断点（默认 sm/md/lg/xl）与 `@media (max-width: 1024px)` 自定义断点，同时尊重 `prefers-reduced-motion` 降低动效。
- **字体规范**：sans 使用 Inter + Noto Sans SC，mono 使用 JetBrains Mono，body 设置 antialiased 与 font-feature-settings。
- **暗色模式**：通过 `color-scheme: light dark` 与 `@media (prefers-color-scheme: dark)` 切换 CSS 变量，无需 JS 控制。

## 4. 约定与约束
- **颜色必须走 CSS 变量**：禁止在组件中硬编码十六进制颜色，统一通过 `--primary`、`--destructive` 等语义变量引用。
- **UI 组件变体必须用 CVA**：所有可复用 UI 组件（Button、Card、Input 等）的 variant/size 必须通过 class-variance-authority 声明，保证 TypeScript 类型推导。
- **className 合并必须用 cn**：组件接收外部 className 时，必须通过 `cn(base, variants({ ... }), className)` 合并，避免冲突。
- **动画需遵循预设**：新增动效应优先使用 tailwindcss-animate 已定义的 keyframe（accordion-down/up、fade-in、slide-in、shimmer），不得随意编写关键帧。
- **编辑器内容样式隔离**：TipTap 编辑器的排版样式限定在 `.prose-editor` 作用域内，不污染全局。
- **无障碍优先**：全局启用 `prefers-reduced-motion` 降级，所有交互元素需满足 focus-visible 可见性要求。
- **Ant Design 仅用于复杂表格/表单**：简单交互组件一律使用 Radix + Tailwind 自建，避免引入完整 AntD 样式覆盖成本。