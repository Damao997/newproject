# 移动端与小屏幕响应式优化设计（Header + 账龄分析筛选栏）

日期：2026-08-14
状态：已确认（用户已选择：双页都改 / Collapsible 收纳 / 窄屏仅 Logo）
参考规范：`docs/plans/frontend-design-proposal.md` §4.8（筛选器与工具栏）、§8（响应式策略）

## 1. 背景与目标

针对移动端及小屏（<640px / <1024px）优化三处界面：

1. **Header 响应式精简**：窄屏仅保留品牌 Logo，隐藏次要元素，最大化内容空间。
2. **Header 控件定位修复**：右侧控制按钮（主题切换/财年选择/头像）在特定断点下被挤出可视区域，需保证始终可见。
3. **账龄分析筛选栏精简**：账龄分析页（`aging.tsx`）双行筛选卡与科目过滤页（`account-filter-tab.tsx`）头部小屏拥挤，需合并高频条件、折叠低频选项、优化布局密度。

## 2. 设计决策

| 决策点 | 结论 | 理由 |
|--------|------|------|
| 改造范围 | 两个页面都改 | 用户确认 |
| 低频选项收纳 | Collapsible 折叠面板 | 用户确认；零依赖（`@/components/ui/collapsible` 已有），交互最轻 |
| 窄屏品牌区 | <640px 仅 Logo，640–767px 标题截断 | 用户确认；`img alt="壹品慧"` 承担品牌可访问性 |
| 小屏选择器宽度 | `w-full sm:w-[Npx]` | 对齐设计规范 §4.8 正例 |
| 折叠断点 | `min-width: 1024px`（lg）为桌面直排阈值 | 对齐 Tailwind lg 断点与 §8 响应式策略 |
| matchMedia 守卫 | `typeof window.matchMedia === 'function'` | 复用 `roles.tsx` 的 jsdom 安全先例 |

## 3. 改动明细

### 3.1 Header（`web/src/components/layout/header.tsx`）

**根因**：移动端品牌区无 `min-w-0 flex-1` 约束，长标题按固有宽度撑开整行，将右侧 `shrink-0` 控制组挤出视口（<500px 必然溢出），表现为控件未固定、布局错位。

**改动**（纯类名，无逻辑变更）：
1. 品牌区容器：`flex min-w-0 flex-1 items-center gap-2 md:hidden`
2. 汉堡按钮、Logo 图：`shrink-0`
3. 品牌标题：`hidden min-w-0 truncate text-base font-bold text-foreground sm:inline`
4. 右侧控制组保持 `shrink-0`（品牌区 `flex-1` 自然推右），财年 Select `w-[120px]`、CalendarRange `<sm` 隐藏维持现状

**验收**：375px 下汉堡+Logo+主题切换+财年+头像全可见无横向溢出；640px 下标题截断；≥768px 桌面布局零变化。

### 3.2 账龄分析页（`web/src/pages/transactions/aging.tsx`）

1. **核心行常驻**：公司/期间/往来类型/分组方式四个选择器宽度响应式化
   - `CompanySelect` 传 `className="w-full sm:w-[200px]"`（组件内 `cn` 合并，tailwind-merge 后者胜出）
   - 期间/类型/分组 SelectTrigger 分别 `w-full sm:w-[140px|160px|160px]`
   - 操作按钮（导出/撰写/查看）保持 `ml-auto flex-wrap`
2. **明细筛选行收进 Collapsible**（科目多选/对象类型/搜索/仅显示小计）：
   - 状态：`detailOpen` 受控；`isDesktop = matchMedia('(min-width: 1024px)')`，断点变化时 `setDetailOpen(isDesktop)`（桌面恒开、移动默认收起，手动切换自由）
   - 桌面（lg+）：trigger 隐藏（`hidden`），内容直排——与现状渲染完全一致
   - 移动：trigger 行 = 「明细筛选」徽标 + 生效条件摘要（`N 个科目 · 已选对象类型 · 有关键词 · 仅显示小计`）+ 强调点 + ChevronDown（展开旋转）
   - 生效条件摘要抽为纯函数 `buildDetailSummary(accountFilter, partyFilter, keyword, subtotalOnly)`，可单测
   - 内容区保持 `mt-3 flex flex-wrap items-center gap-3 border-t border-dashed border-border pt-3`（与现状一致）
3. 过滤状态全在 `pageStateStore`（受控），折叠不影响已选条件；`useStickyHeader` ResizeObserver 自动适应高度变化

**验收**：375px 下核心 4 选择器全宽纵向堆叠、操作按钮换行在下方；明细筛选收为单行 trigger；1024px 以上与现状一致。

### 3.3 科目过滤页（`web/src/pages/transactions/account-filter-tab.tsx`）

1. 头部容器：`flex flex-col gap-2 border-b px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between`
2. 左组（标题+统计+Info tooltip）：`flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1`，统计文本加 `whitespace-nowrap`
3. 搜索框：外层 `relative w-full sm:w-[180px]`，Input `h-8 w-full pl-8 text-sm`（小屏独占一行全宽）

**验收**：375px 下头部两行（标题统计行 + 全宽搜索行）；≥640px 单行布局与现状一致。

## 4. 测试方案

- 单测：`buildDetailSummary` 纯函数用例（空/单条件/多条件）；运行现有 vitest 全套防回归
- 构建：`tsc --noEmit` + oxlint
- 手动（浏览器走查）：375 / 640 / 768 / 1024 / 1280 断点，检查三项验收标准

## 5. 影响范围与回滚

- 仅 3 个前端文件，纯类名/结构调整，零新依赖
- 筛选卡高度变化由 `useStickyHeader` 自动处理
- 回滚：`git checkout -- <文件>` 即还原
