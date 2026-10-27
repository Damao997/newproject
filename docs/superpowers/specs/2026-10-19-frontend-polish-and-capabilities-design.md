# 前端精致度与体验能力提升设计

> 状态：待评审 ｜ 日期：2026-10-19 ｜ 原诉求：抛弃现有前端组件库、全面选用 soybean-admin

## 0. 决策摘要

| 项 | 结论 |
| --- | --- |
| 原诉求 | 抛弃现有前端组件库，全面选用 soybean-admin 框架 |
| 探测结论 | soybean-admin 是 **Vue 3 脚手架模板**，不是可安装的组件库；全面采用 = 把 346 文件 / 50,871 行 React 重写为 Vue |
| 真实动机 | 用户选择"想要成套后台体验"（非技术栈转型） |
| 能力比对 | "成套后台体验"现有实现度约 85%，真正缺口仅 3 项 |
| 精致度诊断 | 成因是**设计取向**（大圆角 + 小字号）而非实现质量；换框架不解决 |
| **决策** | **采用路径 B：保留 React 栈，增量补齐；分期落地** |
| 第一批 | 设计 token 收敛（节 2）+ 死样式修复（节 6）——低风险、立即改善 |

**明确不做**：不引入 Vue / Naive UI / UnoCSS / Pinia / Elegant Router；不重写业务页面；不改动后端契约、权限矩阵、路由结构、AI 双管道。

## 1. 背景与动机

用户提出"抛弃现有的前端组件库，全面选用 soybean 框架"。经澄清，真实驱动为**想要成套的后台体验**（开箱即用的布局骨架、主题、多标签页、动效），并明确感受到四项缺口：多标签页 + 状态缓存、页面切换/菜单动效、可自定义主题色板、整体精致度不够。

其中前 3 项是**能力缺口**（与框架无关），第 4 项是**设计缺口**（换框架不解决）。这决定了不应以换框架为手段。

## 2. 现状探测（事实）

### 2.1 技术栈冲突

| 维度 | 本项目现状 | soybean-admin |
| --- | --- | --- |
| 框架 | React 19 + TypeScript 6 + Vite 5 | **Vue 3**（根本冲突） |
| UI | Radix UI + Shadcn/ui（自研 40 个组件）+ Ant Design 5（仅 ProTable） | Naive UI |
| 样式 | Tailwind 3 + 5 个 CSS（surfaces.css 26KB） | UnoCSS |
| 状态/请求 | Zustand 5 + React Query 5 | Pinia |
| 路由 | react-router-dom 7 | Elegant Router |
| 富文本 | TipTap 3（React） | TipTap Vue |
| 图表 | ECharts 6 + echarts-for-react | vue-echarts |
| 官方 React 版 | — | **无**（第三方 `skyroc-admin` 非官方，不建议生产采用） |

### 2.2 规模量化

- 前端 `web/src`：346 个 TS/TSX 文件，50,871 行
- 分布：pages 121 文件/22,558 行（12 个业务域）· components 155 文件/18,451 行 · lib 35 文件/4,593 行 · hooks 20 文件/3,005 行 · stores 11 文件/906 行
- 全量重写的真实代价：约 45,000 行代码 + 66KB CSS + 全部 React 测试（Vitest + Testing Library）

### 2.3 成套后台能力完成度

| soybean 卖点 | 本项目现状 | 状态 |
| --- | --- | --- |
| 布局骨架（侧栏/顶栏/面包屑/内容区） | `components/layout/main-layout.tsx` + 25 个 layout 组件 | 已有 |
| 多主题 + 暗色模式 | `lib/app-themes.json` 4 套配方：灵感蓝/薄荷绿/星夜(暗)/晴日橙，Vite 首屏注入 | 已有 |
| 主题切换动效 | `stores/themeStore.ts` 的 `data-theme-anim`，尊重 `prefers-reduced-motion` | 已有 |
| 响应式（折叠/移动端抽屉） | <1280 自动折叠侧栏，<768 移动端抽屉 | 已有 |
| 骨架屏 / 路由级 Suspense | RouteFallback，侧栏顶栏常驻 | 已有 |
| 权限菜单 + 路由守卫 | `require-permission` + 后端 5×8×6 权限矩阵 | 已有 |
| **浏览器式多标签页 + keep-alive** | 无（仅有页内二级导航 SubPageTabs） | **缺** |
| **页面切换动效** | 无 | **缺** |
| **运行时调色（自定义主色/圆角）** | 4 套固定配方，编译期注入，无运行时调节 | **缺** |
| i18n 多语言 | — | 不需要（纯中文内网系统） |

### 2.4 设计契约成熟度

`DESIGN.md`（27KB）与 `UX-CONTRACT.md`（18KB）构成严格设计契约：唯一色板源、token 化、对比度要求（正文 4.5:1 / 边界 3:1）、字号与圆角规范、组件归属表（Canonical owner）、动效时长规范，以及 7 个浏览器回归脚本。**结论：本项目设计债治理水平高于同类项目，不属于"质量问题"范畴。**

## 3. 设计债走查结果

**方法**：手工静态扫描。skill 自带的 `audit-design-debt.mjs` 因缺 `fast-glob` 依赖未能运行。
**覆盖率限制**：纯静态，未查看真实渲染；正则已人工剔除 `??` 合并与正则字面量的误报。

### 3.1 量化

| 类别 | 总量 | 剔除展示页后 | 热点 |
| --- | --- | --- | --- |
| 任意 Tailwind 值 | 464 处 / 91 文件 | ~317 处 | admin 模块 |
| 硬编码色值 | 117 处 / 23 文件 | ~33 处 | admin 模块 |
| inline style | 108 处 / 40 文件 | ~53 处 | — |

`web/src/pages/__design/antd-style.tsx` 单文件占 147+84+55，为设计 token 陈列页，属合理例外。

### 3.2 分级清单

| 级别 | 类别 | 发现 | 证据 |
| --- | --- | --- | --- |
| Major | 死样式（功能性缺陷） | 引用 3 个**全项目零定义**的 CSS 变量，审计日志状态色标记静默失效 | `pages/admin/audit-logs.tsx:62,63,65` 使用 `--state-success` / `--color-primary` / `--state-warning`；实际变量名为 `--success` / `--primary` / `--warning`（见 `lib/theme-css.ts` 生成逻辑） |
| Major | typography-drift | 语义字号体系未落地：原生 `text-xs`(12px) 450 次 + `text-sm`(14px) 314 次，vs 自建 `text-body`(13px) 仅 49 次 | `tailwind.config.js:216-223` 定义了体系，实际采用率约 14% |
| Major | non-token-radius | 同一视觉圆角存在两套写法：`rounded-lg`(87, token=12px) 与 `rounded-xl`(16, 原生=12px)；`rounded-card`(74, 24px) 与 `rounded-2xl`(2, 原生 16px) | 改 token 会漏改原生写法 |
| Major | 模块脱离契约 | admin 模块任意值密度 2.3%（73 处 / 3,133 行），全站均值 0.9%；角色色以图表序列色顶替语义色 | `pages/admin/roles.tsx:49-54` 同时使用 `--blue-8` / `--orange-500` / `--chart-7/8/11` |
| Debt | mixed-library-style | 色板四轨并存：语义 token + antd 镜像色阶（blue 13 级 / orange 9 级 / ink 10 级 / cool 12 级）+ 图表序列 13 级 + 状态扩展色阶 | `lib/theme-css.ts:40-46` |
| Debt | 能力缺失 | 无运行时调色能力，4 套配方为编译期静态 JSON | `lib/theme-css.ts` 仅构建期注入；`lib/app-theme.ts` 只导出 `mixThemeColor` 派生 |
| Info | 合理例外 | `pages/__design/antd-style.tsx` 为 token 陈列页 | — |

### 3.3 "精致度不够"的成因判断

| 参数 | 本项目 | soybean-admin / Naive UI |
| --- | --- | --- |
| 卡片圆角 | **24px** | 6–8px |
| 控件圆角 | 12px | 3–6px |
| 正文字号 | **实际 12px 主导**（`text-xs` 450 次） | 14px |
| 视觉气质 | 圆润、多彩、舒展（DESIGN.md 原文"轻快、多彩、圆润"） | 锐利、紧凑、克制 |

**结论**："大圆角 + 小字号"呈现圆润/卡通感，而参照物呈现锐利/工程感。二者取向不同，**不是实现质量问题**。由于全站样式由 `app-themes.json` + Tailwind token 驱动，调整若干 token 即可全站改变气质，无需触碰业务代码。

## 4. 方案设计（路径 B）

### 节 2 · 精致度：token 收敛（中间档）

| 项 | 现值 | 目标值 | 位置 |
| --- | --- | --- | --- |
| 卡片圆角 `radius` | 24px | **16px** | `lib/app-themes.json` 4 个主题各 1 处 |
| 控件圆角 `controlRadius` | 12px | **8px** | 同上 |
| 卡片内距 | 24px | 20px（手机 16px 不变） | `components/ui/card.tsx` 的 CardHeader / CardContent / CardFooter |
| 表格行高 | 44px | 40px（保留用户可选密度档） | DataTable |
| 导航/分类选中圆角 | 14px | 8px | Header / SubPageTabs 的选中胶囊 |
| 阴影 | `0 1px 3px / 5%` | 略收敛 | `tailwind.config.js` 的 boxShadow（第 180-191 行）+ `lib/theme-css.ts` 的 `--antd-shadow-1` |

机制：`lib/theme-css.ts:47` 由上述两个字段产出 `--radius` 与 `--radius-card`，Tailwind 的 `rounded-lg` / `rounded-card` / `rounded-md` 自动跟随，**全站生效**。

顺带治理：统一 `rounded-xl` → `rounded-lg`（16 处）、`rounded-2xl` → `rounded-card`，消除同值双轨写法。

契约同步：`DESIGN.md` 圆角条款、`UX-CONTRACT.md`。

### 节 3 · 多标签页 + 状态缓存

- 新增 `tabStore`（Zustand），与既有 `pageStateStore` **职责分离**：前者管"打开了哪些页面及顺序/激活项"，后者管"页内筛选、分页、展开"。
- 标签栏挂载于 Header 下方；支持关闭 / 关闭其他 / 关闭右侧 / 固定。
- 缓存机制：**首选 React 19.2 原生 `<Activity>`**（零依赖、官方）；备选 `keepalive-for-react`。**须先 spike 验证 ECharts 在隐藏态的 resize 行为**。
- 持久化：按账号（与 `preferencesStore` 一致）。
- **硬约束**：`DESIGN.md` 要求"切换风格不重新挂载页面、不改变筛选、密度、列设置、展开状态或报告草稿"；标签切换不得破坏该约束。与页内 `SubPageTabs` 共存不冲突。

### 节 4 · 页面切换与菜单动效

- 路由过渡：React Router 7 的 `viewTransition`（原生 View Transitions API），以 Tailwind 已有但未启用的 `fade-in` / `slide-in` token 兜底（`tailwind.config.js:233-244`）。
- 侧栏子菜单展开/收起过渡。
- 遵守 `prefers-reduced-motion`（`styles/globals.css` 已有该模式）。
- **风险**：Ant Design Modal / Drawer 使用 Portal，View Transition 期间可能被裁切，须排除浮层。
- 不在本期做：KPI 数字滚动（与"减少动效"偏好及性能成本冲突）。

### 节 5 · 可自定义主题色板

- `paletteCss()` 已是纯函数，导出为**可运行时调用**；用户改主色时在客户端重算 CSS 并替换注入的 `<style>`。
- 派生链自动跟随（`--blue-*` / `--orange-*` 由 `primary` / `brand` 派生）。
- **须显式决策**：`--chart-*`（`series` 数组）是否随主色变化——建议**不变**，保证图表色语义稳定。
- Ant Design `ConfigProvider` 从同一配方适配，须同步刷新。
- UI：设置页新增"外观"分区（主色预设 + 自定义 / 圆角档 / 密度档）。
- 三项中最重（触及主题生成管线），**排在最后**。

### 节 6 · 死样式修复 + 全量校验

- 修复 `pages/admin/audit-logs.tsx:62,63,65`。
- 新增一次性校验：提取全站 `var(--xxx)` 引用与 `lib/theme-css.ts` 生成的变量集合求差集，找出所有同类死引用（不限于已知 3 处）。

## 5. 范围与边界

**做**：① 设计 token 收敛 ② 三项能力补齐 ③ 死样式修复 ④ 契约同步（DESIGN.md / UX-CONTRACT.md）。

**不做**：不换框架与语言；不重写业务页面；不改动后端契约、权限矩阵、路由结构、AI 双管道；不引入 i18n。

## 6. 分期计划

| 批次 | 内容 | 风险 | 依赖 |
| --- | --- | --- | --- |
| 第一批 | 节 2 token 收敛 + 节 6 死样式修复 + 契约同步 | 低 | 无 |
| 第二批 | 节 3 多标签页 + 状态缓存（含 spike） | 中 | 需先验证 Activity × ECharts |
| 第三批 | 节 4 页面切换与菜单动效 | 中 | 无 |
| 第四批 | 节 5 自定义主题色板 | 中高 | 触及主题生成管线 |

各批次互不耦合，可分别发布。

## 7. 验收与风险

**验收**：复用既有回归脚本 `check-responsive-layout.mjs` / `check-redesign.mjs` / `check-surfaces.mjs` / `check-saas-forms.mjs` / `check-personal-settings.mjs` / `check-comparison-surfaces.mjs` / `check-workspace-polish.mjs`，跑 **4 主题 × 桌面/手机** 矩阵；各新能力补对应脚本。

**主要风险**：

1. ECharts 在 `<Activity>` 隐藏态下的 resize 行为（第二批 spike 前置）
2. View Transition 与 Ant Design Portal 浮层的兼容（第三批）
3. "切换风格不重新挂载页面"约束被标签页/动效破坏（第二、三批）
4. 开发工作区存在在途改动，移植与验证需隔离

**回滚**：token 收敛一行可退；各能力独立提交、独立可关。

## 8. 前置条件

- 必须在开发工作区 `D:\ZJYPHFA-dev` 实施。生产目录 `D:\ZJYPHFA` 为 sparse-checkout（集合：`ops-panel` / `server` / `web`），且按 `AGENTS.md` 禁止开发与提交。
- `D:\ZJYPHFA-dev` 当前 HEAD 与 `origin/main` 一致，但**存在 52 个文件的未提交改动（16 修改 + 36 未跟踪）**——与本设计无关的在途工作，实施前需确认如何处理。
- 按既有隔离 checkout 经验：新工作树需 `npm ci`（server、web 各自）+ `prisma generate` + 建库名含 `test` 的独立测试库，否则 `npm run verify` 会报假 Prisma 错或中止。

## 9. 推断与待决事项

**标注为推断（待实际验证）**：

- "精致度不够"归因于设计取向（依据：参数对比 + 用户对视觉变体的选择），尚未有真实界面走查佐证——本期选用纯静态走查，未查看渲染。
- React 19.2 `<Activity>` 的可用性与 ECharts 兼容性，尚未验证。

**待决**：

1. `--chart-*` 图表序列色是否随自定义主色变化（节 5）。
2. 标签页持久化粒度：会话级还是按账号长期持久化（节 3）。
3. token 收敛是否同步应用于 `pages/__design/antd-style.tsx` 陈列页（该页刻意展示 antd 原始规格）。
4. 走路走查发现的 admin 模块设计债（`roles.tsx` / `audit-logs.tsx`）是否纳入第一批修复范围。
