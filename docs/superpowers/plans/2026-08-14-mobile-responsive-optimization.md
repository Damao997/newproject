# 移动端响应式优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 针对移动端与小屏优化 Header 品牌区、右侧控件定位，以及账龄分析/科目过滤两页的筛选栏布局密度。

**Architecture:** 纯前端类名与结构调整，零新依赖。Header 通过 `min-w-0 flex-1` + `truncate` + `sm` 断点隐藏标题解决控件被挤出视口问题；账龄分析页筛选卡核心行选择器按 `w-full sm:w-[Npx]` 响应式（对齐设计规范 §4.8），明细筛选行收进已有 `Collapsible` 组件（≥1024px 恒展开直排，<1024px 默认收起并显示生效条件摘要）；科目过滤页头部改纵向堆叠 + 全宽搜索框。

**Tech Stack:** React 18 + Tailwind CSS 3 + Radix（Select/Switch）+ 自研 Collapsible + Vitest/RTL。

**Spec:** `docs/superpowers/specs/2026-08-14-mobile-responsive-optimization-design.md`

**说明**：本计划不含 commit 步骤（按工作区 Git 安全策略，仅用户明确要求时提交）。

---

### Task 1: 明细筛选摘要纯函数 buildDetailSummary（TDD）

**Files:**
- Modify: `web/src/pages/transactions/shared.tsx`（追加纯函数导出）
- Create: `web/src/pages/transactions/__tests__/detail-summary.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `web/src/pages/transactions/__tests__/detail-summary.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildDetailSummary } from '../shared'

describe('buildDetailSummary', () => {
  it('无任何生效条件时返回空数组', () => {
    expect(buildDetailSummary([], 'all', '', false)).toEqual([])
  })

  it('单条件：科目数量', () => {
    expect(buildDetailSummary(['OP_001'], 'all', '', false)).toEqual(['1 个科目'])
  })

  it('多条件按固定顺序拼接', () => {
    expect(buildDetailSummary(['OP_001', 'OP_002'], 'related', ' 某公司 ', true)).toEqual([
      '2 个科目',
      '已选对象类型',
      '有关键词',
      '仅显示小计',
    ])
  })

  it('关键词纯空白视为未生效', () => {
    expect(buildDetailSummary([], 'all', '   ', false)).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd web && npx vitest run src/pages/transactions/__tests__/detail-summary.test.ts`
Expected: FAIL（`buildDetailSummary` is not exported）

- [ ] **Step 3: 实现纯函数**

在 `web/src/pages/transactions/shared.tsx` 末尾（`AccountMultiSelect` 之后）追加：

```tsx
/** 明细筛选生效条件摘要（供折叠 trigger 展示；空数组 = 无生效条件） */
export function buildDetailSummary(
  accountFilter: string[],
  partyFilter: string,
  keyword: string,
  subtotalOnly: boolean,
): string[] {
  const parts: string[] = []
  if (accountFilter.length > 0) parts.push(`${accountFilter.length} 个科目`)
  if (partyFilter && partyFilter !== 'all') parts.push('已选对象类型')
  if (keyword.trim()) parts.push('有关键词')
  if (subtotalOnly) parts.push('仅显示小计')
  return parts
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd web && npx vitest run src/pages/transactions/__tests__/detail-summary.test.ts`
Expected: PASS（4 个用例）

---

### Task 2: Header 品牌区响应式 + 右侧控件定位修复

**Files:**
- Modify: `web/src/components/layout/header.tsx:60-72`

**背景**：品牌区无 `min-w-0 flex-1` 约束，长标题撑开整行把右侧 `shrink-0` 控制组挤出视口（<500px 溢出）。修复后：<640px 仅 Logo；640–767px 标题截断；≥768px 桌面布局不变。

- [ ] **Step 1: 修改品牌区**

将 `header.tsx` 中移动端品牌区（第 60-72 行）整体替换为：

```tsx
        {/* 移动端：菜单按钮 + 品牌标识（<640px 仅 Logo 最大化内容空间，640-767px 标题单行截断） */}
        <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0 text-foreground"
            aria-label="打开导航菜单"
            onClick={onMenuClick}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <img src="/logo.png" alt="壹品慧" className="h-7 w-7 shrink-0 object-contain" />
          <span className="hidden min-w-0 truncate text-base font-bold text-foreground sm:inline">
            浙江壹品慧经营分析平台
          </span>
        </div>
```

- [ ] **Step 2: 类型检查**

Run: `cd web && npx tsc --noEmit -p tsconfig.app.json`
Expected: 无错误

---

### Task 3: 账龄分析页筛选栏精简（核心行响应式 + 明细筛选折叠）

**Files:**
- Modify: `web/src/pages/transactions/aging.tsx`（imports、状态、行 1 选择器宽度、行 2 折叠）

- [ ] **Step 1: 补充 imports**

`aging.tsx` 第 1 行附近：

```tsx
import { Collapsible } from '@/components/ui/collapsible'
```

第 25 行 lucide imports 追加 ChevronDown：

```tsx
import { Download, FileText, Eye, ChevronDown } from 'lucide-react'
```

第 27 行 shared imports 追加 buildDetailSummary：

```tsx
import { AccountMultiSelect, PartyTypeSelect, PartyTypeTag, AGING_GROUPS, TRANSACTION_TYPES, buildDetailSummary, useDefaultCompanyCode } from './shared'
```

- [ ] **Step 2: 新增折叠状态（`useEffect` 块附近，`exporting` 状态之后）**

```tsx
  // 明细筛选折叠：≥lg（1024px）恒展开直排（trigger 隐藏）；<lg 默认收起、可手动切换；断点变化时跟随默认值
  const DETAIL_QUERY = '(min-width: 1024px)'
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(DETAIL_QUERY).matches,
  )
  const [detailOpen, setDetailOpen] = useState(isDesktop)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(DETAIL_QUERY)
    const onChange = (e: MediaQueryListEvent) => {
      setIsDesktop(e.matches)
      setDetailOpen(e.matches)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
```

- [ ] **Step 3: 核心行四个选择器宽度响应式化**

- `CompanySelect`（第 193 行）传 className：

```tsx
          <CompanySelect value={companyFilter} onChange={setCompanyFilter} className="w-full sm:w-[200px]" />
```

- 期间 SelectTrigger（第 195 行）：

```tsx
            <SelectTrigger className="w-full sm:w-[140px]">
```

- 往来类型 SelectTrigger（第 203 行）：

```tsx
            <SelectTrigger className="w-full sm:w-[160px]">
```

- 分组方式 SelectTrigger（第 212 行）：

```tsx
            <SelectTrigger className="w-full sm:w-[160px]">
```

- [ ] **Step 4: 行 2 明细筛选收进 Collapsible**

将第 252-267 行的整个 `{/* 行 2：明细筛选 */}` div 替换为：

```tsx
        {/* 行 2：明细筛选（≥lg 恒展开直排与现状一致；<lg 收进折叠面板，trigger 展示生效条件摘要） */}
        <Collapsible
          open={detailOpen}
          onOpenChange={setDetailOpen}
          trigger={(open) => (
            <div className={cn('flex w-full items-center gap-3 pt-3', isDesktop && 'hidden')}>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">明细筛选</span>
              {detailSummary.length > 0 && (
                <span className="min-w-0 truncate text-xs text-muted-foreground">{detailSummary.join(' · ')}</span>
              )}
              {detailSummary.length > 0 && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />}
              <ChevronDown
                className={cn('ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
              />
            </div>
          )}
        >
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-dashed border-border pt-3">
            {/* 桌面直排时展示区段徽标；移动端徽标在 trigger 行，避免展开后重复 */}
            {isDesktop && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">明细筛选</span>
            )}
            <AccountMultiSelect value={accountFilter} onChange={setAccountFilter} transactionType={typeFilter || undefined} />
            <PartyTypeSelect value={partyFilter} onChange={setPartyFilter} />
            <Input
              placeholder="搜索往来对象..."
              className="w-full sm:w-[200px]"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <Switch id="aging-subtotal-only" checked={subtotalOnly} onCheckedChange={setSubtotalOnly} disabled={rows.length === 0} />
              <span className="cursor-pointer text-xs text-muted-foreground select-none" onClick={() => setSubtotalOnly(!subtotalOnly)}>仅显示小计</span>
            </div>
          </div>
        </Collapsible>
```

- [ ] **Step 5: 计算摘要（替换 `const labelColSpan` 行上方任意合适位置，紧跟 `visibleRows` 定义之后）**

```tsx
  const detailSummary = buildDetailSummary(accountFilter, partyFilter, keyword, subtotalOnly)
```

- [ ] **Step 6: 类型检查**

Run: `cd web && npx tsc --noEmit -p tsconfig.app.json`
Expected: 无错误（注意 `cn` 已在 aging.tsx 导入）

---

### Task 4: 科目过滤页头部布局密度

**Files:**
- Modify: `web/src/pages/transactions/account-filter-tab.tsx:79-108`

- [ ] **Step 1: 头部容器与搜索框改造**

将第 79-108 行（头部容器 + 搜索框）替换为：

```tsx
        <div className="flex flex-col gap-2 border-b px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <FilterX className="h-4 w-4" />
              科目过滤
            </h3>
            <span className="text-xs text-muted-foreground whitespace-nowrap">
              已纳入 <span className="font-medium text-success-strong">{activeCount}</span> 个 · 已排除 <span className="font-medium text-warning-strong">{excludedCount}</span> 个
            </span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" aria-label="科目过滤规则说明" className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                  <Info className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p className="max-w-[260px] text-xs">点击标签即可排除/恢复该科目：排除后账龄分析将自动剔除其数据，且不再出现在科目筛选下拉中。</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="relative w-full sm:w-[180px]">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="搜索科目"
              placeholder="搜索科目..."
              className="h-8 w-full pl-8 text-sm"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>
        </div>
```

- [ ] **Step 2: 类型检查**

Run: `cd web && npx tsc --noEmit -p tsconfig.app.json`
Expected: 无错误

---

### Task 5: 全量验证

- [ ] **Step 1: 运行全部前端测试**

Run: `cd web && npx vitest run`
Expected: 全部 PASS（含新增 detail-summary 4 用例与既有 Collapsible 用例）

- [ ] **Step 2: Lint**

Run: `cd web && npx oxlint .`
Expected: 无新增错误

- [ ] **Step 3: 构建**

Run: `cd web && npx vite build`
Expected: 构建成功

- [ ] **Step 4: 浏览器断点走查（375/640/768/1024/1280）**

启动 `npm run dev` 后逐断点检查三项验收标准：
1. Header：375px 汉堡+Logo+主题切换+财年+头像全可见无横向溢出；640px 标题截断；≥768px 桌面布局不变
2. 账龄分析：<1024px 核心 4 选择器全宽堆叠、明细筛选收为 trigger（含摘要）；≥1024px 与现状一致；折叠展开后已选条件不丢失
3. 科目过滤：<640px 头部两行（标题统计行 + 全宽搜索行）；≥640px 单行

每个断点截图存档。
