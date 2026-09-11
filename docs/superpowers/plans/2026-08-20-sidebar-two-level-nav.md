# 侧边栏导航两级化与页面内 Tab 改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将侧边栏导航从三级层级简化为两级（一级模块 + 二级菜单），原三级菜单项（6 个 group）全部转为对应二级模块页面内的 Tab 切换。

**Architecture:** 导航配置 `nav-items.ts` 移除 `type: 'group'` 与递归 children，二级项改为叶子（`path` 指向默认子页真实路由，新增 `match` 集合声明高亮/面包屑匹配路径）。扩展 `tabs.tsx` 新增 `outlined` 描边式变体（激活项品牌浅底 + 细边框 + 品牌色文字），新建共享组件 `SubPageTabs`（Radix Tabs + navigate 路由跳转）使用该变体，8 个页面在 `PageContainer` children 首位接入。路由与 `RequirePermission` 权限校验零改动（子路由全部已存在），`LegacyQueryRedirect` 兼容逻辑保留。侧边栏渲染、面包屑、`nav-filter` 同步简化去递归。

**Tech Stack:** React 18 / react-router-dom v6 / Radix UI Tabs（`@/components/ui/tabs`，default variant）/ Tailwind CSS / Vitest

**前置注意:** 工作区存在未提交修改（`nav-items.ts`、`breadcrumb.tsx`、`page-container.tsx` 等均已有 M 标记，旧 `sidebar.tsx` 已删除并重构至 `sidebar/` 目录）。本计划全部改动基于当前工作区状态叠加，不触碰无关未提交内容，不提交任何文件（除非用户要求）。

---

## 改造后目标导航结构

```
首页看板
├── 看板总览    /dashboard
└── 财务指标    /indicators →（默认 Tab 经营指标；Tab: 经营指标/静态指标）
往来分析
├── 往来总览    /transactions/overview
└── 分析明细    /transactions/aging →（默认 Tab 账龄分析；Tab: 账龄分析/科目过滤/催收计划）
存货管理        /inventory
分析报告
├── 汇总报告    /reports
└── 单项分析    /reports/analyses
其他工具
└── 企业查询    /tools/enterprise-lookup
数据管理
├── 数据导入    /data/import →（默认 Tab 导入管理；Tab: 导入管理/数据预览）
├── 重分类管理  /data/reclassify →（默认 Tab 单体公司调整；Tab: 单体公司调整/汇总主体调整）
├── 维度/科目体系 /data/dimensions/operating →（Tab: 经营分析科目/静态科目/主体管理/汇总主体映射）
├── 看板管理    /data/board/category →（Tab: 品类配置/运营费用映射/主体配置/月度预算比例）
└── 公式维护    /data/formulas
权限管理（不变）
```

说明：`match` 集合用于侧边栏高亮与面包屑匹配（如「数据导入」`path=/data/import` 访问 `/data/browse` 时仍高亮；「分析明细」`path=/transactions/aging` 访问 `/transactions/account-filter` 时仍高亮）。

---

## Task 1: 改造 nav-items.ts 导航配置（移除三级）

**Files:**
- Modify: `web/src/components/layout/nav-items.ts`

- [ ] **Step 1: 简化 NavChild 接口**

将 `NavChild` 接口中的 `type?: 'group' | 'link'` 与 `children?: NavChild[]` 移除，新增 `match?: string[]`：

```ts
export interface NavChild {
  /** 菜单项完整路径（真实路由路径，指向模块默认子页）；仅叶子项 */
  path: string
  label: string
  /** 完整权限码（resource:action）；缺省继承父级（一级项 resource） */
  permission?: PermissionCode
  /** 模块内非默认子页的完整路径集合（不含自身 path）：驱动侧边栏高亮与面包屑匹配。缺省仅匹配自身 path */
  match?: string[]
}
```

说明：match 不含自身 path（自身由 path 精确匹配）；子页均为完整真实路由且互不为前缀，高亮用精确匹配即可（避免 /data/reclassify 与 /data/reclassify/consolidation 前缀双高亮）。

- [ ] **Step 2: 扁平化 6 个 group 目录项**

按下列替换（保留各 group 原注释要点，改为说明默认子页与 Tab 结构）：

- `财务指标`（位于 /dashboard children）：
```ts
      {
        // 财务指标作为看板的明细层归并其下；显式权限码防无 indicators 权限角色穿透；
        // 页面内 Tab：经营指标（默认）/ 静态指标
        path: '/indicators',
        label: '财务指标',
        permission: 'indicators:view',
        match: ['/indicators/operating', '/indicators/static'],
      },
```
- `分析明细`（位于 /transactions children）：
```ts
      {
        // 分析/任务类子页合入页内 Tab：账龄分析（默认）/ 科目过滤 / 催收计划
        path: '/transactions/aging',
        label: '分析明细',
        match: ['/transactions/account-filter', '/transactions/collections/plans'],
      },
```
- `数据导入`（位于 /data children）：
```ts
      {
        // 页内 Tab：导入管理（默认）/ 数据预览
        path: '/data/import',
        label: '数据导入',
        match: ['/data/browse'],
      },
```
- `重分类管理`（位于 /data children）：
```ts
      {
        // 页内 Tab：单体公司调整（默认）/ 汇总主体调整
        path: '/data/reclassify',
        label: '重分类管理',
      },
```
- `维度/科目体系`（位于 /data children）：
```ts
      {
        // 页内 Tab：经营分析科目（默认）/ 静态科目 / 主体管理 / 汇总主体映射
        path: '/data/dimensions/operating',
        label: '维度/科目体系',
        match: ['/data/dimensions/static', '/data/dimensions/company', '/data/dimensions/summary'],
      },
```
- `看板管理`（位于 /data children）：
```ts
      {
        // 页内 Tab：品类配置（默认）/ 运营费用映射 / 主体配置 / 月度预算比例
        path: '/data/board/category',
        label: '看板管理',
        match: ['/data/board/expense', '/data/board/subject', '/data/board/budget-ratio'],
      },
```
注：重分类管理的子页 /data/reclassify/consolidation 是其默认子页 /data/reclassify 的路径后代，由 collectNavPaths 的边界前缀匹配（startsWith）天然覆盖，无需 match；其余模块子页与默认子页无前缀关系，用 match 显式声明。

- [ ] **Step 3: 移除数据导入组的「导入管理/数据预览」旧配置**

`数据导入` 原 group 的 children（`/data/import`、`/data/browse` 两条）整体删除，`数据管理` 一级项 children 顺序保持：数据导入 → 重分类管理 → 维度/科目体系 → 看板管理 → 公式维护。

- [ ] **Step 4: 验证**

运行：`cd d:\flies\pj3\web; npx tsc --noEmit -p tsconfig.app.json`
预期：仅 `nav-filter.test.ts` 报类型错误（`type`/`children` 字段已移除，后续 Task 3 修复），其余无错。

---

## Task 2: 简化 nav-filter.ts（去递归 + match 匹配）

**Files:**
- Modify: `web/src/lib/nav-filter.ts`

- [ ] **Step 1: filterNavChildren 去递归**

替换 `filterNavChildren` 为单层过滤（删除 `child.children?.length` 分支）：

```ts
function filterNavChildren(
  children: readonly NavChild[],
  permissions: readonly string[],
  inherited: PermissionCode,
): NavChild[] {
  const result: NavChild[] = []
  for (const child of children) {
    if (permissions.includes(child.permission ?? inherited)) {
      result.push(child)
    }
  }
  return result
}
```

- [ ] **Step 2: collectNavPaths 使用 match 集合**

`collectNavPaths` 的 `walk` 中叶子收集改为：

```ts
  const walk = (node: NavPathNode) => {
    if (!node.children?.length) {
      pathsSet.add(node.path)
      for (const p of node.match ?? []) pathsSet.add(p)
      return
    }
    for (const child of node.children) walk(child)
  }
```

将原 `paths.push(node.path)` 替换为基于 `Set<string>` 收集后返回数组（保持「自身 path 在前、match 在后」的顺序，见 Task 3 断言）。`NavPathNode` 接口增加 `match?: readonly string[]`。

- [ ] **Step 3: matchesNavPath 不变**

`matchesNavPath` 保持 `pathname === p || pathname.startsWith(p + '/')` 语义（子页路径由 match 集合显式声明，天然兼容）。

---

## Task 3: 更新 nav-filter 单元测试

**Files:**
- Modify: `web/src/lib/__tests__/nav-filter.test.ts`

- [ ] **Step 1: 更新 viewer 断言（三级 → 二级）**

```ts
  it('viewer 仅可见 首页看板/分析报告 两个一级模块（财务指标归并其下）', () => {
    const visible = filterNavItems(navItems, ROLE_PERMISSIONS.viewer)
    expect(visible.map((i) => i.path)).toEqual(['/dashboard', '/reports'])
    // 首页看板子树：看板总览 + 财务指标叶子（三级已扁平化）
    const dashboard = findItem(visible, '/dashboard')
    expect(dashboard.children!.map((c) => c.label)).toEqual(['看板总览', '财务指标'])
    expect(dashboard.children![1].children).toBeUndefined()
  })
```

- [ ] **Step 2: 更新 collectNavPaths 断言**

```ts
  it('收集子树全部叶子 path（自身 path + match 集合展开）', () => {
    const dashboard = findItem(navItems, '/dashboard')
    expect(collectNavPaths(dashboard)).toEqual([
      '/dashboard',
      '/indicators',
      '/indicators/operating',
      '/indicators/static',
    ])
    const transactions = findItem(navItems, '/transactions')
    expect(collectNavPaths(transactions)).toEqual([
      '/transactions/overview',
      '/transactions/aging',
      '/transactions/account-filter',
      '/transactions/collections/plans',
    ])
    const data = findItem(navItems, '/data')
    expect(collectNavPaths(data)).toContain('/data/browse') // 数据导入 match 展开
  })
```

- [ ] **Step 3: 更新/新增匹配断言**

- 删除「归并后子树激活匹配」测试中的旧注释，断言不变（`matchesNavPath('/indicators/operating', dashboard)` 仍为 true）。
- 新增 match 验证：

```ts
  it('match 集合：非默认子页命中模块项', () => {
    const data = findItem(navItems, '/data')
    const imports = data.children!.find((c) => c.label === '数据导入')!
    expect(matchesNavPath('/data/browse', imports)).toBe(true)
    expect(matchesNavPath('/data/import', imports)).toBe(true)
    expect(matchesNavPath('/data/reclassify/consolidation', imports)).toBe(false)
    const reclassify = data.children!.find((c) => c.label === '重分类管理')!
    expect(matchesNavPath('/data/reclassify/consolidation', reclassify)).toBe(true)
    expect(matchesNavPath('/data/reclassify', reclassify)).toBe(true)
  })
```

- [ ] **Step 4: 更新「空目录剔除」测试为两级结构**

原三级示例结构（`/x/a` group + `/x/a/1`）改为两级叶子 + permission：

```ts
  it('无权限子项剔除：子项全部无权限时整组隐藏', () => {
    const items: NavItem[] = [
      {
        path: '/x',
        label: 'X',
        icon,
        resource: 'tools:view',
        children: [
          { path: '/x/a', label: 'A', permission: 'admin:roles:view' },
          { path: '/x/b', label: 'B' },
        ],
      },
    ]
    const visible = filterNavItems(items, ['tools:view'])
    expect(visible).toHaveLength(1)
    expect(visible[0].children!.map((c) => c.label)).toEqual(['B'])
  })
```

- [ ] **Step 5: 运行测试**

运行：`cd d:\flies\pj3\web; npx vitest run src/lib/__tests__/nav-filter.test.ts`
预期：全部 PASS（若失败，回查 Task 1/2 的 match 收集与过滤逻辑）。

---

## Task 4: 简化侧边栏渲染层（去三级渲染逻辑）

**Files:**
- Modify: `web/src/components/layout/sidebar/nav-sub-list.tsx`
- Modify: `web/src/components/layout/sidebar/nav-item.tsx`
- Modify: `web/src/components/layout/sidebar/desktop-dropdown.tsx`

- [ ] **Step 1: 重写 nav-sub-list.tsx 为纯二级列表**

删除递归、group 分支、depth 参数与缩进逻辑，仅渲染叶子 Link：

```tsx
import { Link } from 'react-router-dom'
import type { NavChild } from '../nav-items'
import { matchesNavPath } from '@/lib/nav-filter'
import { cn } from '@/lib/utils'
import { ActiveBar } from './nav-shared'
import { useActivePath } from './use-active-path'

/**
 * 二级菜单列表（导航两级化后仅此一层）：
 * - 叶子项：普通 Link，按 pathname 精确匹配高亮（忽略 query 参数，筛选态不丢高亮）；
 * - match 集合：子页命中模块项时高亮（模块项路径为默认子页，match 声明全部子页）；
 * - onSurface：'sidebar' = 侧边栏内联（使用侧边栏前景色系），'popover' = 白底弹层（深色文字）。
 */
export function NavSubList({
  items,
  onNavigate,
  onSurface = 'popover',
}: {
  items: NavChild[]
  onNavigate?: () => void
  onSurface?: 'sidebar' | 'popover'
}) {
  const pathname = useActivePath()
  const leafIdleCls =
    onSurface === 'sidebar'
      ? 'text-sidebar-fg/80 hover:bg-sidebar-selected-bg/40 hover:text-sidebar-fg'
      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'

  return (
    <div className="mt-1 space-y-1">
      {items.map((child) => {
        // 激活：pathname 精确匹配自身 path 或 match 声明的子页（互不为前缀，精确匹配无歧义）
        const isActive = pathname === child.path || child.match?.includes(pathname) === true
        return (
          <Link
            key={child.path}
            to={child.path}
            onClick={onNavigate}
            className={cn(
              'relative flex items-center rounded-md py-1.5 pl-9 pr-3 text-sm font-medium transition-colors duration-150',
              isActive ? 'font-medium text-sidebar-selected-fg' : leafIdleCls
            )}
          >
            {isActive && <ActiveBar />}
            <span className="pl-1.5">{child.label}</span>
          </Link>
        )
      })}
    </div>
  )
}
```

注意：叶子高亮为「pathname 精确匹配自身 path 或 match 元素」——重分类管理的 /data/reclassify/consolidation 子页由边界前缀覆盖的匹配仅存在于一级项激活（matchesNavPath，任一命中即 true 无歧义），二级叶子一律精确匹配，避免双高亮。

- [ ] **Step 2: 更新调用处（去掉 depth 参数）**

`nav-item.tsx` 中 `<NavSubList items={item.children!} depth={1} onNavigate={onNavigate} onSurface="sidebar" />` → 去掉 `depth={1}`；
`desktop-dropdown.tsx` 中 `<NavSubList items={item.children!} depth={1} onNavigate={onNavigate} />` → 去掉 `depth={1}`。
同时更新 `nav-item.tsx` 顶部注释（删除「展开二级/三级列表」表述）与 `desktop-dropdown.tsx` 注释（删除「二级/三级直接显示」表述）。

- [ ] **Step 3: 类型检查**

运行：`cd d:\flies\pj3\web; npx tsc --noEmit -p tsconfig.app.json`
预期：无错误。

---

## Task 5: 扩展 tabs.tsx outlined 变体并新建 SubPageTabs 共享组件与 Tab 配置

**Files:**
- Modify: `web/src/components/ui/tabs.tsx`
- Create: `web/src/components/layout/sub-page-tabs.tsx`
- Create: `web/src/components/layout/module-tabs.ts`

- [ ] **Step 1: tabs.tsx 新增 outlined 变体（描边式）**

`TabsVariant` 类型扩展为 `'default' | 'line' | 'outlined'`（TabsList 的 variant 自动传播给 TabsTrigger 的机制不变）：

```ts
type TabsVariant = 'default' | 'line' | 'outlined'
```

TabsList 的 cn 中新增分支（无底色容器，紧凑间隔）：

```tsx
        variant === 'outlined' && "h-auto gap-1.5 rounded-none border-0 bg-transparent p-0",
```

TabsTrigger 的 cn 中新增分支（描边式：未激活透明底灰字；激活态品牌浅底 + 细边框 + 品牌色文字，覆盖默认激活白底/shadow）：

```tsx
        variant === 'outlined' &&
          "rounded-md border border-transparent bg-transparent px-3 py-1.5 text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground data-[state=active]:border-primary/30 data-[state=active]:bg-primary/5 data-[state=active]:text-primary data-[state=active]:font-medium data-[state=active]:shadow-none",
```

注：激活态覆盖写法与既有 line 变体（`data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none`）同构，生产已验证生效；若构建后出现默认激活态残留（bg-background 胜出），在冲突类前加 `!`（如 `data-[state=active]:!bg-primary/5`）修正。

- [ ] **Step 2: 创建 module-tabs.ts（各模块 Tab 配置，单一定义源）**

```ts
import type { SubPageTab } from './sub-page-tabs'

/** 财务指标：经营指标（默认）/ 静态指标 */
export const INDICATOR_TABS: SubPageTab[] = [
  { path: '/indicators/operating', label: '经营指标' },
  { path: '/indicators/static', label: '静态指标' },
]

/** 往来分析 · 分析明细：账龄分析（默认）/ 科目过滤 / 催收计划 */
export const TRANSACTION_DETAIL_TABS: SubPageTab[] = [
  { path: '/transactions/aging', label: '账龄分析' },
  { path: '/transactions/account-filter', label: '科目过滤' },
  { path: '/transactions/collections/plans', label: '催收计划' },
]

/** 数据管理 · 数据导入：导入管理（默认）/ 数据预览 */
export const IMPORT_TABS: SubPageTab[] = [
  { path: '/data/import', label: '导入管理' },
  { path: '/data/browse', label: '数据预览' },
]

/** 数据管理 · 重分类管理：单体公司调整（默认）/ 汇总主体调整 */
export const RECLASSIFY_TABS: SubPageTab[] = [
  { path: '/data/reclassify', label: '单体公司调整' },
  { path: '/data/reclassify/consolidation', label: '汇总主体调整' },
]

/** 数据管理 · 维度/科目体系：经营分析科目（默认）/ 静态科目 / 主体管理 / 汇总主体映射 */
export const DIMENSION_TABS: SubPageTab[] = [
  { path: '/data/dimensions/operating', label: '经营分析科目' },
  { path: '/data/dimensions/static', label: '静态科目' },
  { path: '/data/dimensions/company', label: '主体管理' },
  { path: '/data/dimensions/summary', label: '汇总主体映射' },
]

/** 数据管理 · 看板管理：品类配置（默认）/ 运营费用映射 / 主体配置 / 月度预算比例 */
export const BOARD_TABS: SubPageTab[] = [
  { path: '/data/board/category', label: '品类配置' },
  { path: '/data/board/expense', label: '运营费用映射' },
  { path: '/data/board/subject', label: '主体配置' },
  { path: '/data/board/budget-ratio', label: '月度预算比例' },
]
```

- [ ] **Step 3: 创建 sub-page-tabs.tsx**

```tsx
import { useNavigate } from 'react-router-dom'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useActivePath } from './sidebar/use-active-path'

export interface SubPageTab {
  /** 完整路由路径：Tab 激活匹配与跳转目标 */
  path: string
  label: string
}

/**
 * 模块内子页 Tab 条（导航两级化后的分类切换层）：
 * - 路由驱动：切换即 navigate 到子页真实路径（刷新/分享/权限校验沿用路由层）；
 * - 激活：pathname 精确匹配 Tab path，非法/未知路径兜底高亮第一项；
 * - 样式：outlined 描边式变体（激活项品牌浅底 + 细边框 + 品牌色文字，未激活灰字透明底）；
 * - 响应式：窄屏 TabsList 横向滚动（TabsTrigger 自带 whitespace-nowrap）。
 */
export function SubPageTabs({ items }: { items: SubPageTab[] }) {
  const pathname = useActivePath()
  const navigate = useNavigate()
  const active = items.find((t) => pathname === t.path) ?? items[0]

  if (items.length === 0) return null

  return (
    <Tabs value={active?.path} onValueChange={(v) => navigate(v)}>
      <TabsList variant="outlined" className="max-w-full overflow-x-auto">
        {items.map((t) => (
          <TabsTrigger key={t.path} value={t.path} className="shrink-0">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
```

- [ ] **Step 4: 类型检查**

运行：`cd d:\flies\pj3\web; npx tsc --noEmit -p tsconfig.app.json`
预期：无错误。

---

## Task 6: 财务指标页接入 Tab

**Files:**
- Modify: `web/src/pages/indicators/index.tsx`

- [ ] **Step 1: 引入配置并在 PageContainer children 首位渲染**

`IndicatorPage` 中（组件顶部 import 区）加：

```tsx
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { INDICATOR_TABS } from '@/components/layout/module-tabs'
```

在 `PageContainer` 开标签与 actions prop 之间（children 首位）插入：

```tsx
      {/* 页内 Tab：经营指标 / 静态指标（路由驱动，切换即导航到子页） */}
      <SubPageTabs items={INDICATOR_TABS} />
```

即结构为 `<PageContainer title={...} className=... actionsFullWidth actions={...}>` 之后、AI 预分析弹窗之前。页面高度 `h-[calc(100dvh-104px)]` 保持不变：Tab 条作为 children 首位占固定高度，表格 `flex-1` 自动收缩（PageContainer 为 flex-col）。

- [ ] **Step 2: 清理 `activeTab` 冗余**

`const activeTab = subjectType` 保留（数据源驱动），无需改动。验证 `npx tsc --noEmit -p tsconfig.app.json` 无错。

---

## Task 7: 往来分析三页接入 Tab（分析明细）

**Files:**
- Modify: `web/src/pages/transactions/aging.tsx`
- Modify: `web/src/pages/transactions/account-filter.tsx`
- Modify: `web/src/pages/transactions/collections/plans.tsx`

- [ ] **Step 1: 三页统一接入**

每页执行相同改动（import 区 + PageContainer children 首位插入）：

```tsx
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { TRANSACTION_DETAIL_TABS } from '@/components/layout/module-tabs'
```

```tsx
      {/* 页内 Tab：账龄分析（默认）/ 科目过滤 / 催收计划 */}
      <SubPageTabs items={TRANSACTION_DETAIL_TABS} />
```

- `aging.tsx`：`<PageContainer title="账龄分析" ...>` 开标签后插入。
- `account-filter.tsx`：`<PageContainer title="科目过滤" ...>` 开标签后插入。
- `collections/plans.tsx`：`<PageContainer title="催收计划" ...>` 开标签后插入。

注意：催收计划页内部已有 `CollectionsTab`（计划/业务员内部结构），外层分析明细 Tab 与其并存，两层 Tab 语义不同（模块分类 vs 页面内视图），无需处理。

- [ ] **Step 2: 类型检查**

运行：`cd d:\flies\pj3\web; npx tsc --noEmit -p tsconfig.app.json`
预期：无错误。

---

## Task 8: 数据管理各页接入 Tab

**Files:**
- Modify: `web/src/pages/data/import.tsx`
- Modify: `web/src/pages/data/browse.tsx`
- Modify: `web/src/pages/data/reclassify.tsx`
- Modify: `web/src/pages/data/reclassify/consolidation.tsx`
- Modify: `web/src/pages/data/dimensions.tsx`
- Modify: `web/src/pages/data/board.tsx`

- [ ] **Step 1: import.tsx / browse.tsx（数据导入）**

两页 import 区加入 `SubPageTabs` + `IMPORT_TABS`，`<PageContainer title="导入管理" ...>` / `<PageContainer title="数据预览" ...>` 开标签后插入：

```tsx
      {/* 页内 Tab：导入管理（默认）/ 数据预览 */}
      <SubPageTabs items={IMPORT_TABS} />
```

- [ ] **Step 2: reclassify.tsx / consolidation.tsx（重分类管理）**

两页 import 区加入 `SubPageTabs` + `RECLASSIFY_TABS`，`<PageContainer title="单体公司调整" ...>` / `<PageContainer title="汇总主体调整" ...>` 开标签后插入：

```tsx
      {/* 页内 Tab：单体公司调整（默认）/ 汇总主体调整 */}
      <SubPageTabs items={RECLASSIFY_TABS} />
```

- [ ] **Step 3: dimensions.tsx（维度/科目体系）**

改动点：
1. import 区加入 `SubPageTabs` + `DIMENSION_TABS`。
2. `pageTitle` 固定为「维度/科目体系」，删除随 sub 变化的标题映射（Tab 承担分类指示；同时删除 `DIM_SUB_TABS` 常量与 `dimSubTab` 计算中对标题的依赖，保留 sub 校验逻辑）：

```tsx
  const dimSubTab: DimSubTab = DIM_SUB_TABS.includes(sub as DimSubTab) ? (sub as DimSubTab) : 'operating'
```
保持不变；仅将 `const pageTitle = {...}[dimSubTab]` 替换为 `const pageTitle = '维度/科目体系'`。

3. `<PageContainer title={pageTitle} ...>` 开标签后插入：

```tsx
      {/* 页内 Tab：经营分析科目（默认）/ 静态科目 / 主体管理 / 汇总主体映射 */}
      <SubPageTabs items={DIMENSION_TABS} />
```

- [ ] **Step 4: board.tsx（看板管理）**

改动点：
1. import 区加入 `SubPageTabs` + `BOARD_TABS`。
2. `pageTitleText` 固定为「看板管理」；`BOARD_TITLE_HELP` 与 help Tooltip 逻辑保留（help 随当前子页变化，Tab 切换后 hover 说明仍准确）：

```tsx
  const pageTitleText = '看板管理'
  const help = BOARD_TITLE_HELP[boardSubTab]
```

3. `<PageContainer title={pageTitle} ...>` 开标签后插入：

```tsx
      {/* 页内 Tab：品类配置（默认）/ 运营费用映射 / 主体配置 / 月度预算比例 */}
      <SubPageTabs items={BOARD_TABS} />
```

- [ ] **Step 5: 类型检查**

运行：`cd d:\flies\pj3\web; npx tsc --noEmit -p tsconfig.app.json`
预期：无错误。

---

## Task 9: 面包屑适配两级结构

**Files:**
- Modify: `web/src/components/layout/breadcrumb.tsx`

- [ ] **Step 1: findCrumbPath 改为两级匹配**

删除递归，改为「一级叶子精确匹配 + 二级子页 match 集合匹配」：

```tsx
/** 匹配当前 pathname 在导航树中的路径链（单一数据源，与侧边栏 nav-items 保持一致；忽略 query，筛选参数不吞面包屑） */
function findCrumbPath(items: NavChild[], pathname: string): Crumb[] | null {
  for (const item of items) {
    if (item.children?.length) {
      for (const child of item.children) {
        if (pathname === child.path || child.match?.includes(pathname) === true) {
          return [
            { label: item.label, path: item.path, leaf: false },
            { label: child.label, path: child.path, leaf: true },
          ]
        }
      }
    } else if (item.path === pathname) {
      return [{ label: item.label, path: item.path, leaf: true }]
    }
  }
  return null
}
```

`BreadcrumbInner` 的链组装与「首页」前缀逻辑不变；显示条件从 `crumbs.length < 3` 改为 `crumbs.length <= 3`（导航两级化后最深层级为「首页 / 一级 / 二级」3 段，按原「层级 ≥3 才展示」意图不再渲染面包屑）：

```tsx
  if (!crumbs || crumbs.length <= 3) return null
```

同时更新组件顶部注释（删除「如 首页 / 数据管理 / 维度/科目体系 / 经营分析科目」示例与递归表述）。

- [ ] **Step 2: 类型检查**

运行：`cd d:\flies\pj3\web; npx tsc --noEmit -p tsconfig.app.json`
预期：无错误。

---

## Task 10: 全量验证与收尾

- [ ] **Step 1: 单元测试**

运行：`cd d:\flies\pj3\web; npx vitest run`
预期：全部 PASS（重点 `nav-filter.test.ts`；回归 `components/ui/__tests__`、`data-table` 等现有用例不受影响）。

- [ ] **Step 2: 类型与 lint**

运行：`cd d:\flies\pj3\web; npx tsc --noEmit -p tsconfig.app.json; npm run lint`
预期：均无错误/警告（lint 失败项逐条修复，禁止 `--fix` 批量跳过）。

- [ ] **Step 3: 浏览器手工验证清单**

启动：`cd d:\flies\pj3; node scripts/dev-up.mjs`（或按 `docs/本地开发环境启动指南.md`），逐项验证：

1. 侧边栏不再出现三级缩进目录项（财务指标/分析明细/数据导入/重分类管理/维度/科目体系/看板管理均为二级叶子）。
2. 点击「财务指标」直达经营指标页，Tab 高亮「经营指标」；切「静态指标」URL 变为 `/indicators/static`，刷新保持。
3. 访问 `/data/dimensions/static`（直接输入 URL）：Tab 高亮「静态科目」，侧边栏「维度/科目体系」高亮、「数据管理」一级高亮展开。
4. 访问 `/data/browse`：侧边栏「数据导入」高亮（match 生效）。
5. 权限验证：以 `finance_analyst_it` 等无 `indicators:view` 角色登录，「财务指标」不显示（原防穿透权限码保留）；无 `data:browse:view` 角色「数据管理」整组隐藏。
6. 旧链接兼容：`/transactions?tab=collections` 仍重定向 `/transactions/collections/plans`；`/indicators?tab=static` 仍重定向 `/indicators/static`；`/data?tab=dimensions&sub=summary` 仍重定向 `/data/dimensions/summary`。
7. 响应式：窄屏（<768px）侧边栏抽屉内二级项正常；Tab 条超宽时横向滚动不换行错位。
8. Tab 描边式样式：激活项品牌橙浅底（bg-primary/5）+ 细边框（border-primary/30）+ 品牌色文字，未激活项灰字透明底无边框；与 reports 页 line 筛选 Tab 视觉区分明显。
9. 面包屑：改造后任意页面 Header 不再显示面包屑（层级变浅，按意图隐藏）。
10. 折叠态侧边栏：点击「数据管理」图标弹出面板仅含二级叶子，无三级缩进。

- [ ] **Step 4: 汇总**

如用户需要提交，则 `git add` 本计划涉及文件并提交；否则仅汇报改动清单与验证结果。

---

**高亮一致性说明（无歧义前提）：**
- 一级项激活：`matchesNavPath`（collectNavPaths 展开自身 path + match，边界前缀 startsWith）——任一命中即 true，前缀关系无歧义；「重分类管理」match 为空时 /data/reclassify/consolidation 由 /data/reclassify 的前缀命中覆盖。
- 二级叶子高亮：pathname 精确匹配自身 path 或 match——子页路径互不为前缀（/data/reclassify 与 /data/reclassify/consolidation 中前者是默认子页、后者仅在 match 缺失时由一级匹配覆盖，二级叶子间无前缀包含），无双高亮。
- 面包屑：与二级叶子同款精确匹配。

**自审清单**

**Spec 覆盖：**
- 需求 1（移除三级菜单）→ Task 1/2/4
- 需求 2（页面内 Tab）→ Task 5/6/7/8
- 需求 3（路由与权限适配）→ 路由路径全部保留（子路由已存在），`RequirePermission` 零改动；权限码继承逻辑保留（Task 2）；LegacyQueryRedirect 兼容验证（Task 10 Step 3-6）
- 需求 4（交互体验）→ SubPageTabs 默认高亮第一项 + 精确匹配 + 窄屏滚动（Task 5）；侧边栏 match 高亮（Task 1/4）
- 需求 5（代码清理）→ group/type/children 字段移除（Task 1）、nav-sub-list 去递归（Task 4）、nav-filter 去递归（Task 2）、breadcrumb 去递归（Task 9）、测试同步（Task 3）

**占位符扫描：** 无 TBD/TODO；所有步骤含完整代码与命令。

**类型一致性：** `SubPageTab`（Task 5 定义）在 module-tabs.ts 与 sub-page-tabs.tsx 间一致；`NavChild.match`（不含自身 path）在 nav-items.ts / nav-filter.ts / nav-sub-list.tsx / breadcrumb.tsx 间语义一致；`collectNavPaths` 返回数组顺序与 Task 3 断言一致（自身 path 在前、match 顺序在后）。
