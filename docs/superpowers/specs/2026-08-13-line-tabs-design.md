# 全站线条式（Line-style）Tab 改造设计

> 日期：2026-08-13
> 范围：全站所有基于 `components/ui/tabs.tsx` 的 Tab 组件（7 文件、8 处 TabsList）

## 1. 背景与目标

首页看板"趋势分析"及相关卡片原为胶囊式（segmented control）Tab。需求为统一改为**线条式（Line-style）Tab**：

1. **选中态**：默认选中或用户自主选中的 Tab 下方显示一条短横线高亮指示器，颜色为主题主色（Primary Color），突出激活状态；选中文字同步主色。
2. **未选中态**：同层级未选中 Tab 保持统一且较弱的视觉样式（低对比度文字），避免喧宾夺主。
3. **分隔线**：所有 Tab 标签正下方绘制一条贯穿的水平分割线（Divider），清晰区分导航区域与内容区域。

经确认，**全部页面的 Tab 均复用同一套线条式样式**（不限于首页看板），并在共享组件层以 `variant="line"` 提供。

## 2. 现状清单（8 处调用点）

| # | 文件 | 位置 | 现状样式 | 场景 |
|---|---|---|---|---|
| 1 | `web/src/pages/dashboard/analysis-tabs-card.tsx` | L68-74 | `rounded-full bg-muted p-1` + 白底阴影 | 综合分析卡主 Tab（趋势分析/品类预算达成/公司预算达成/运营费用） |
| 2 | `web/src/pages/dashboard/trend-section.tsx` | L35、L48 | `bg-muted p-1` 胶囊 | 趋势页内：月度/累计 + 收入/毛利/净利润 |
| 3 | `web/src/pages/dashboard/product-budget-card.tsx` | L73-76 | 胶囊 | 品类预算卡：月度/累计 |
| 4 | `web/src/pages/dashboard/subject-budget-card.tsx` | L73-76 | 胶囊 | 公司预算卡：月度/累计 |
| 5 | `web/src/pages/reports/index.tsx` | L130-134 | 默认胶囊 | 报告列表状态筛选（与搜索框同行） |
| 6 | `web/src/pages/admin/roles.tsx` | L414-423 | 紧凑胶囊（`h-8`/`h-7 text-xs` + 图标） | 角色页视图切换（卡片/表格） |
| 7 | `web/src/pages/data/import-compare-dialog.tsx` | L193-197 | 默认胶囊 | 导入比对对话框分组 Tab |

## 3. 共享组件改造（`web/src/components/ui/tabs.tsx`）

为 `TabsList` 与 `TabsTrigger` 新增 `variant?: 'default' | 'line'` 参数，**默认 `default` 保持现有胶囊样式**（未改造调用方零回归；同时作为未来特殊场景的逃生口）。样式合并依赖 `cn()`（tailwind-merge，冲突类后写胜出）。

**variant 自动传播**：`TabsList` 通过内部 React Context 将 variant 传递给嵌套的 `TabsTrigger`（Provider 包裹 `TabsPrimitive.List`，trigger 在 List 内渲染时自动继承）；调用方只需在 `TabsList` 传一次 `variant="line"`，`TabsTrigger` 无需重复传参，若个别场景需要覆盖可显式传 variant（优先级高于 Context）。

### TabsList line 变体

```
h-auto gap-x-5 rounded-none border-b border-border bg-transparent p-0
```

- 去除灰底/圆角/内边距，标签间距拉开至 20px（Ant Design line tab 风格）
- **自带底部贯穿分割线**（`border-b border-border`，宽度 = TabsList 自身宽度；调用方可传 `w-full` 扩展为贯穿容器）

### TabsTrigger line 变体

```
relative rounded-none bg-transparent px-1 py-2 shadow-none
text-muted-foreground
hover:bg-transparent hover:text-foreground
data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:font-medium
after:pointer-events-none after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-8 after:-translate-x-1/2 after:rounded-full after:bg-primary after:content-[''] after:opacity-0 after:transition-opacity
data-[state=active]:after:opacity-100
```

- **选中态**：文字 `text-primary`（主题主色）+ 底部主色短横线（32px 宽、居中、圆角、2px 高），`after:bottom-0` 使短横线紧贴分割线（ink-bar 压线效果）；覆盖基类选中白底/阴影/文字色
- **未选中态**：`text-muted-foreground` 低对比度弱化；hover 时 `text-foreground` 提供点击反馈
- 短横线经 `opacity` 过渡平滑显隐；保留基类 focus-visible 无障碍样式
- 注意：短横线贴线前提是调用方不要用 `h-*` 固定 TabsList/Trigger 高度（固定高度会导致短横线悬空），故 roles 需移除自定义高度

## 4. 调用方改造

### 4.1 dashboard 综合看板（组宽分割线 + 左对齐）

> [2026-08-13 修订] 按后续 UI 优化要求：主 Tab 不再 `w-full`（分割线回归仅覆盖 Tab 组宽度，符合 frontend-design-proposal.md §4.6 "宽度 fit-content" 规范）；所有 dashboard Tab 标签左对齐（`justify-start`）。其他页面（reports/roles/import-compare-dialog）未受影响。

| 文件 | 改动 |
|---|---|
| analysis-tabs-card.tsx | `TabsList` → `variant="line" className="mb-4 justify-start"`（无 `w-full`，TabsList 宽度=内容宽度，分割线仅覆盖 Tab 组；标签左对齐）；删除 `TAB_TRIGGER_CLS` 胶囊类常量；`TabsTrigger` 删除胶囊类（variant 经 Context 自动继承） |
| trend-section.tsx | 两组 `TabsList` → `variant="line" className="justify-start"`（自带组宽分割线）；标题行容器不画贯穿线（保持 `mb-3 flex flex-wrap items-center justify-between gap-3`）；`TabsTrigger` 删除胶囊类（自动继承 line） |
| product-budget-card.tsx | `TabsList` → `variant="line" className="justify-start"`；标题行容器不画贯穿线；`TabsTrigger` 删除胶囊类（自动继承 line） |
| subject-budget-card.tsx | 同 product-budget-card |

### 4.2 其他页面（组件自带组宽分割线）

| 文件 | 改动 |
|---|---|
| reports/index.tsx | `TabsList` → `variant="line"`（保持内联，组宽分割线，与右侧搜索框同行不冲突）；`TabsTrigger` 自动继承 line |
| roles.tsx | `TabsList` → `variant="line"` 并移除 `className="h-8"`；`TabsTrigger` 移除 `h-7`（保留 `gap-1 px-3 text-xs` 与图标，自动继承 line），保证短横线贴分割线 |
| import-compare-dialog.tsx | `TabsList` → `variant="line"`；`TabsTrigger` 自动继承 line |

## 5. 设计规范符合性

- **主题联动**：`text-primary` / `bg-primary` / `border-border` 全走 Tailwind token（HSL 变量），自动跟随品牌主题色（orange/blue/green/violet）与侧边栏三风格（浅色/靛蓝/深色）切换；无硬编码色值（符合 v3.5 规范"颜色必须通过 CSS 变量或 Tailwind token 调用"）
- **字体**：微软雅黑体系不变
- **无障碍**：保留 `focus-visible:ring`；短横线为纯装饰（`pointer-events-none`）
- **MVP 范围**：仅样式改造，不改任何数据结构、接口、交互逻辑（切换行为、持久化、挂载策略不变）
- **复用一致性**：全站 8 处 Tab 共用同一 `variant="line"`，视觉语义统一（选中主色短横线 + 底部分割线 + 弱化未选中态），符合《整体方案-修订版.md》"统一决策"与 MVP 范围要求

## 6. 测试计划

1. **回归验证**：`npm run lint`（web）+ `npx tsc --noEmit`（web）通过
2. **视觉走查**：
   - 首页看板：主 Tab 贯穿分割线 + 选中短横线；切换品牌主题色（Header 调色板 orange/blue/green/violet）与侧边栏风格，确认主色指示器跟随变化
   - 趋势分析页：两组子 Tab 短横线与整行贯穿线贴合；月度/累计、指标切换正常
   - 品类/公司预算卡：子 Tab 同趋势页表现
   - 报告列表：状态 Tab 组宽分割线，与搜索框同行布局不破
   - 角色页：卡片/表格切换正常，短横线贴线无悬空
   - 导入比对对话框：分组 Tab 正常
3. **边界检查**：窄屏 flex-wrap 换行时贯穿线位置正确；`prefers-reduced-motion` 下过渡被禁用不影响功能

## 7. 假设

- 除上述 7 文件外无其他 Tabs 使用点（已通过全仓 Grep 核实）
- `cn()` 基于 tailwind-merge，变体类置于基类之后可正确覆盖冲突类
- 各调用方 `Tabs`/`TabsContent` 其余结构不动
