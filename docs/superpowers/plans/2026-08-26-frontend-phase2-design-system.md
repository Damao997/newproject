# 前端优化 Phase 2：设计系统收敛 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成设计系统收敛四件事：字号 token 化（47 处任意值清零）、FilterBar 筛选区标准化（统一 h-9 规格 + 看板重复块抽组件）、EmptyState 空态三轨合一、路由级骨架替换纯文本"加载中…"。

**Architecture:** 全部收敛到既有设计体系——tailwind.config 新增语义字号 token（micro/caption/helper）；FilterBar 作为布局容器统一控件规格并导出宽度语义常量；EmptyState 统一看板空态卡 / inventory EmptyHint / DataTable emptyText / 占位页四类空态；路由骨架复用现有 skeleton-blocks 组合。不引入任何新依赖。

**Tech Stack:** React 19 / Tailwind 3 / Radix UI / Vitest + Testing Library / oxlint

**验证基线（先跑一遍确保全绿）：** `cd web && npx vitest run && npm run lint`

---

## 任务一览

| # | 任务 | 主要文件 | 对应问题 |
|---|------|----------|----------|
| 1 | 字号 token 化 | `tailwind.config.js` + 22 个文件 47 处替换 | P1-4 |
| 2 | FilterBar 组件 + 看板收编 | 新建 `components/layout/filter-bar.tsx`、`components/filters/dashboard-filter-bar.tsx` + `dashboard/index.tsx`、`dashboard/analysis.tsx` | P1-5、P1-6 |
| 3 | 往来三页筛选卡收编 | `transactions/overview.tsx`、`aging.tsx`、`inventory/index.tsx` | P1-5 |
| 4 | EmptyState 空态统一 | 新建 `components/ui/empty-state.tsx` + dashboard 空态卡 / inventory EmptyHint×5 / DataTable / AnalysisPlaceholder | P2-11 |
| 5 | 路由级骨架 | 新建 `components/layout/route-fallback.tsx` + `App.tsx` | P1-8 |
| 6 | 全量验证收尾 | grep 清零 + 全量测试 + build + 冒烟 | 验收 |

---

## Task 1: 字号 token 化

**Files:**
- Modify: `web/tailwind.config.js`（fontSize 段）
- Modify: 22 个文件 47 处 `text-[10px]/[11px]/[12px]` → 语义 token
- Verify: grep 清零 + build + 视觉冒烟

### Step 1: 新增字号 token

Modify `web/tailwind.config.js`，在 `theme.extend` 内（`fontFamily` 之后）新增：

```js
      fontSize: {
        // 语义字号：正文最小 12px 红线；micro 仅限装饰性后缀（单位标注/角标），caption 辅助信息，helper 小号正文/小按钮
        micro: ["10px", { lineHeight: "14px" }],
        caption: ["11px", { lineHeight: "16px" }],
        helper: ["12px", { lineHeight: "18px" }],
      },
```

### Step 2: 按分类规则批量替换（47 处）

**分类规则：**
- `text-micro`（10px）：单位后缀（"万"）、Badge 内文字、角标、装饰性标注——**禁止用于正文**
- `text-caption`（11px）：辅助说明、图例标签、统计副信息、版本号
- `text-helper`（12px）：小号正文、小按钮文字、提示条

**替换清单（file:line: 旧类 → 新类）：**

| 文件:行 | 语义 | 替换为 |
|---|---|---|
| components/analysis/context-chip.tsx:8 | 辅助标签 | `text-caption` |
| components/charts/kpi-card.tsx:63,69 | 单位标注（装饰性） | `text-micro` |
| components/dimension/expense-mapping-panel.tsx:169 | tag 标签 | `text-caption` |
| components/dimension/expense-mapping-panel.tsx:181 | Badge | `text-micro` |
| components/dimension/expense-mapping-panel.tsx:337 | 暂无数据标注 | `text-micro` |
| components/dimension/product-category-panel.tsx:142 | Badge | `text-micro` |
| components/dimension/product-category-panel.tsx:154 | tag 标签 | `text-caption` |
| components/dimension/product-config-panel.tsx:143 | Badge | `text-micro` |
| components/dimension/product-config-panel.tsx:155 | tag 标签 | `text-caption` |
| components/dimension/subject-budget-panel.tsx:127,136 | Badge | `text-micro` |
| components/editor/rich-text-editor.tsx:66 | AI 润色按钮文字 | `text-helper` |
| components/editor/rich-text-editor.tsx:125 | 风格切换按钮 | `text-helper` |
| components/editor/rich-text-editor.tsx:141 | 取消按钮 | `text-helper` |
| components/editor/rich-text-editor.tsx:146 | 替换选区按钮 | `text-helper` |
| components/editor/rich-text-editor.tsx:236 | hint 提示条 | `text-helper` |
| components/indicators/ai-overview-panel.tsx:105 | AI 状态提示 | `text-caption` |
| components/indicators/analysis-drawer.tsx:224 | AI 状态提示 | `text-caption` |
| components/layout/sidebar/index.tsx:95 | 版本号 | `text-caption` |
| components/reclassify/consolidation-adjust-dialog.tsx:254 | Badge | `text-micro` |
| lib/overview-render.tsx:25 | 表格正文 | `text-helper` |
| pages/admin/dialogs.tsx:419 | 高危 Badge | `text-micro` |
| pages/admin/dialogs.tsx:422 | 资源编码 | `text-micro` |
| pages/data/formula-history-dialog.tsx:184,185 | 公式变更 Badge | `text-micro` |
| pages/data/formula-maintenance.tsx:172 | Badge | `text-caption` |
| pages/reports/analysis-list.tsx:151,165 | 公司/科目编码 | `text-caption` |
| pages/reports/analysis-list.tsx:162 | AI 预分析 Badge | `text-micro` |
| pages/reports/analysis-list.tsx:370 | 按钮文字 | `text-helper` |
| pages/reports/index.tsx:117 | 汇总/公司标注 | `text-caption` |
| pages/reports/report-editor.tsx:272,275,355,384,427 | 版本/时间/序号/警告 | `text-helper` |
| pages/transactions/account-filter-tab.tsx:127,166 | 辅助标注 | `text-micro` |
| pages/transactions/analysis-drawer.tsx:170,186 | 辅助信息 | `text-caption` |
| pages/transactions/analysis-drawer.tsx:211 | 账龄分组标注 | `text-micro` |
| pages/transactions/collections-tab.tsx:501 | 已逾期标注 | `text-micro` |
| pages/transactions/collections-tab.tsx:600 | 万单位后缀 | `text-micro` |
| pages/transactions/overview.tsx:202,209,217 | 卡片辅助信息 | `text-caption` |

> 若执行时某行行号漂移（与清单不一致），以**分类规则**为准判断语义归属，不要机械按行号改错。

**替换要求：**
- 只改 class 中的字号 token，其余 class（颜色/间距/字重）原样保留
- 不改任何逻辑/结构/文案
- 替换后 `cd web && npm run build` 必须通过（token 存在于 tailwind config，类名可生成）
- **已知残留**：`text-[13px]`（FlashMessage、rich-text-editor 正文等约 10 处）不在本任务范围，方案 Phase 2 未要求，记录留待后续评估

### Step 3: 验证

Run: `cd web && npx vitest run && npm run build`

```powershell
cd web; Select-String -Path src -Pattern 'text-\[(10|11|12)px\]' -Recurse -Include *.ts,*.tsx
```

Expected: 0 匹配（注意：工作区未提交的 `indicators/index.tsx`、`key-metrics-table.tsx` 若含这些类名会出现在结果中——先确认这两个文件不含，若含则仅在报告中注明，不修改这两个文件）。

### Step 4: 提交

```bash
git add web/tailwind.config.js <22 个修改文件>
git commit -m "refactor(web): 字号任意值清零，沉淀 micro/caption/helper 语义字号 token"
```

---

## Task 2: FilterBar 组件 + 看板筛选收编

**Files:**
- Create: `web/src/components/layout/filter-bar.tsx`
- Create: `web/src/components/filters/dashboard-filter-bar.tsx`
- Modify: `web/src/pages/dashboard/index.tsx`、`web/src/pages/dashboard/analysis.tsx`
- Test: `web/src/components/layout/__tests__/filter-bar.test.tsx`、`web/src/components/filters/__tests__/dashboard-filter-bar.test.tsx`

### Step 1: 写 FilterBar 失败测试

Create `web/src/components/layout/__tests__/filter-bar.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { FilterBar, FILTER_WIDTH } from '../filter-bar'

describe('FilterBar 筛选区容器', () => {
  it('默认换行布局：flex-wrap + gap-3 + items-center', () => {
    const { container } = render(<FilterBar><button>控件</button></FilterBar>)
    expect(container.firstChild).toHaveClass('flex', 'flex-wrap', 'items-center', 'gap-3')
  })

  it('nowrap 变体：密集单行布局（账龄筛选行 1）', () => {
    const { container } = render(<FilterBar nowrap><button>控件</button></FilterBar>)
    expect(container.firstChild).toHaveClass('flex-nowrap')
  })

  it('stickyTop 启用吸顶并携带偏移', () => {
    const { container } = render(<FilterBar stickyTop={56}><button>控件</button></FilterBar>)
    expect(container.firstChild).toHaveClass('sticky', 'z-10')
    expect((container.firstChild as HTMLElement).style.top).toBe('56px')
  })

  it('导出宽度语义常量（主体 180 / 期间 140）', () => {
    expect(FILTER_WIDTH.subject).toBe('w-[180px]')
    expect(FILTER_WIDTH.period).toBe('w-[140px]')
  })
})
```

### Step 2: 跑测试确认失败

Run: `cd web && npx vitest run src/components/layout/__tests__/filter-bar.test.tsx`
Expected: FAIL——`../filter-bar` 模块不存在。

### Step 3: 创建 FilterBar

Create `web/src/components/layout/filter-bar.tsx`:

```tsx
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** 筛选控件宽度语义常量：主体选择 / 期间选择（各页统一引用，替代硬编码宽度） */
export const FILTER_WIDTH = {
  /** 主体/公司多选 */
  subject: 'w-[180px]',
  /** 期间单选 */
  period: 'w-[140px]',
  /** 中宽（搜索框等） */
  medium: 'w-[200px]',
} as const

interface FilterBarProps {
  /** 吸顶：传入顶部偏移（px）时启用 sticky（与 useStickyHeader 的 headerHeight 联动） */
  stickyTop?: number
  /** 单行不换行（账龄筛选行 1 等密集布局专用，勿滥用） */
  nowrap?: boolean
  className?: string
  children: ReactNode
}

/**
 * 筛选区容器：统一控件间距（gap-3）与排列（可换行/吸顶）。
 * 控件自身高度由各控件 className 保证（统一 h-9），宽度优先引用 FILTER_WIDTH 语义常量。
 */
export function FilterBar({ stickyTop, nowrap, className, children }: FilterBarProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3',
        nowrap && 'flex-nowrap',
        stickyTop !== undefined && 'sticky z-10',
        className,
      )}
      style={stickyTop !== undefined ? { top: stickyTop } : undefined}
    >
      {children}
    </div>
  )
}
```

### Step 4: 写 DashboardFilterBar 失败测试

Create `web/src/components/filters/__tests__/dashboard-filter-bar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DashboardFilterBar } from '../dashboard-filter-bar'

describe('DashboardFilterBar 看板筛选块', () => {
  const base = {
    dimFilter: '',
    onDimChange: vi.fn(),
    selectedPeriod: '',
    onPeriodChange: vi.fn(),
    periodOptions: ['2026-01', '2026-02'],
  }

  it('渲染主体选择与期间选择（含最新期间选项）', () => {
    render(<DashboardFilterBar {...base} />)
    expect(screen.getByText('全部主体')).toBeInTheDocument()
    expect(screen.getByText('最新期间')).toBeInTheDocument()
  })

  it('无期间候选时不渲染期间选择器', () => {
    render(<DashboardFilterBar {...base} periodOptions={[]} />)
    expect(screen.queryByText('最新期间')).not.toBeInTheDocument()
  })

  it('控件统一 h-9 高度与语义宽度', () => {
    const { container } = render(<DashboardFilterBar {...base} />)
    container.querySelectorAll('[class*="h-9"]').forEach((el) => {
      expect(el.className).toContain('h-9')
    })
    expect(container.querySelector('[class*="w-[180px]"]')).toBeTruthy()
  })
})
```

> 注意：CompanySelect 内部实现可能不直接透传 className 到根元素——第三个用例断言可能需适配。若 CompanySelect 不支持高度/宽度透传，则在实现时同步给 `CompanySelect` 补 `className` 透传（项目 select.tsx 已有先例），并在报告中说明。

### Step 5: 跑测试确认失败 → 创建 DashboardFilterBar

Run: `cd web && npx vitest run src/components/filters/__tests__/dashboard-filter-bar.test.tsx`
Expected: FAIL——模块不存在。

Create `web/src/components/filters/dashboard-filter-bar.tsx`:

```tsx
import { CompanySelect } from '@/components/filters/company-select'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FILTER_WIDTH } from '@/components/layout/filter-bar'

interface DashboardFilterBarProps {
  dimFilter: string
  onDimChange: (v: string) => void
  selectedPeriod: string
  onPeriodChange: (v: string) => void
  periodOptions: string[]
}

/**
 * 看板筛选块（首页看板与经营分析子页共用）：主体 + 期间。
 * 口径与 useDashboardFilters 一致；统一 h-9 控件高与语义宽度。
 */
export function DashboardFilterBar({ dimFilter, onDimChange, selectedPeriod, onPeriodChange, periodOptions }: DashboardFilterBarProps) {
  return (
    <>
      <CompanySelect
        value={dimFilter}
        onChange={onDimChange}
        valueFormat="prefixed"
        allLabel="全部主体"
        ariaLabel="选择主体维度（汇总主体自动展开为成员合并口径）"
        title="选择主体维度（汇总主体自动展开为成员合并口径）"
        className={`h-9 ${FILTER_WIDTH.subject} border-input/60 bg-page hover:bg-muted/60`}
      />
      {periodOptions.length > 0 && (
        <div className="flex items-center gap-2">
          <Select
            value={selectedPeriod || periodOptions[periodOptions.length - 1] || 'latest'}
            onValueChange={(v) => onPeriodChange(v === 'latest' ? '' : v)}
          >
            <SelectTrigger className={`h-9 ${FILTER_WIDTH.period} border-input/60 bg-page hover:bg-muted/60`} title="选择预览期间">
              <SelectValue placeholder="最新期间" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">最新期间</SelectItem>
              {[...periodOptions].reverse().map((p) => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </>
  )
}
```

### Step 6: 接入两个看板页面

`web/src/pages/dashboard/index.tsx`——actions 中 CompanySelect + 期间 Select 块（原 88-116 行）替换为：

```tsx
          <StatusIndicator
            variant={isError ? 'error' : isRefreshing ? 'idle' : 'active'}
            label={isError ? '同步失败' : isRefreshing ? '数据同步中…' : '数据已同步'}
            colored
            className="mr-1 hidden sm:inline-flex"
          />
          <DashboardFilterBar
            dimFilter={dimFilter}
            onDimChange={setDimFilter}
            selectedPeriod={selectedPeriod}
            onPeriodChange={setSelectedPeriod}
            periodOptions={periodOptions}
          />
          {isRefreshing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
```

（顶部新增 import `DashboardFilterBar`；原 CompanySelect/Select 相关 import 若不再使用需清理，但注意 StatusIndicator/Loader2 等仍在使用。）

`web/src/pages/dashboard/analysis.tsx`——actions（原 65-93 行）整体替换为：

```tsx
      actions={
        <DashboardFilterBar
          dimFilter={dimFilter}
          onDimChange={setDimFilter}
          selectedPeriod={selectedPeriod}
          onPeriodChange={setSelectedPeriod}
          periodOptions={periodOptions}
        />
      }
```

（清理不再使用的 CompanySelect/Select 相关 import。）

### Step 7: 验证 + 提交

Run: `cd web && npx vitest run && npm run lint && npm run build`
Expected: 全绿（含 2 个新测试文件）。

手工冒烟：看板页与经营分析页筛选交互不变（选主体/期间、切换子页筛选保持）。

```bash
git add web/src/components/layout/filter-bar.tsx web/src/components/filters/dashboard-filter-bar.tsx web/src/components/layout/__tests__/filter-bar.test.tsx web/src/components/filters/__tests__/dashboard-filter-bar.test.tsx web/src/pages/dashboard/index.tsx web/src/pages/dashboard/analysis.tsx
git commit -m "refactor(web): 新增 FilterBar 容器与 DashboardFilterBar，看板筛选统一 h-9 规格"
```

---

## Task 3: 往来三页筛选卡收编 FilterBar

**Files:**
- Modify: `web/src/pages/transactions/overview.tsx`、`aging.tsx`、`inventory/index.tsx`
- Verify: 控件高度统一 h-9、容器用 FilterBar

> 边界说明：FilterBar 统一**容器规格**（间距/排列/吸顶）与**高度**；宽度上 overview/inventory 使用语义常量，aging 行 1 是刻意密集单行布局（94/110/84px 紧凑宽度），**保留其紧凑宽度**、仅统一高度，避免破坏单行设计。

### Step 1: overview.tsx

Modify `web/src/pages/transactions/overview.tsx` 筛选卡（原 145-160 行）：

```tsx
          <Card ref={filterRef} className="sticky z-10 rounded-card p-4" style={{ top: headerHeight }}>
          <FilterBar>
            <CompanyMultiSelect
              value={selectedCompanies}
              onChange={handleCompaniesChange}
              selectAllType="entity"
              className={`h-9 ${FILTER_WIDTH.subject}`}
            />
            <Select value={period ?? ''} onValueChange={setPeriodFilter}>
              <SelectTrigger className={`h-9 ${FILTER_WIDTH.period}`}>
                <SelectValue placeholder="期间" />
              </SelectTrigger>
              <SelectContent>
                {(periods || []).map((p) => (
                  <SelectItem key={p} value={p}>{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <PartyTypeSelect value={partyFilter} onChange={setPartyFilter} />
          </FilterBar>
          {noticeElement}
          </Card>
```

（新增 import：`FilterBar, FILTER_WIDTH` from `@/components/layout/filter-bar`。PartyTypeSelect 自身高度若非 h-9，在报告中说明其默认规格，必要时给它传 className 统一。）

### Step 2: aging.tsx

Modify `web/src/pages/transactions/aging.tsx` 筛选卡行 1（原 274-370 行）——外层 div 换 FilterBar nowrap：

```tsx
        <FilterBar nowrap>
          <CompanyMultiSelect value={selectedCompanies} onChange={handleCompaniesChange} selectAllType="entity" className="h-9 w-[150px]" />
          <Select value={period ?? ''} onValueChange={setPeriodFilter}>
            <SelectTrigger className="h-9 w-[94px] min-w-0">
              <SelectValue placeholder="期间" />
            </SelectTrigger>
            ...
          </Select>
          ...（类型/分组 Select 与操作按钮组保持原宽度类，仅补 h-9）
        </FilterBar>
```

> 原行 1 是 `<div className="flex flex-nowrap items-center gap-2">`——替换为 `<FilterBar nowrap>` 后间距变为 gap-3（从 gap-2 升级为统一规格，视觉差异可接受，若冒烟发现拥挤可保留 gap-2：FilterBar 支持 className 覆盖 `className="gap-2"`）。行 2（Collapsible 明细筛选）保持原结构不动，仅在行 1 结束后原样接续。

（新增 import FilterBar；若 FILTER_WIDTH 不用则不引入。）

### Step 3: inventory/index.tsx

Modify `web/src/pages/inventory/index.tsx` 筛选卡（原 605-618 行）：

```tsx
        <Card ref={filterRef} className="sticky z-10 rounded-card p-4" style={{ top: headerHeight }}>
        <FilterBar>
          <CompanyMultiSelect
            value={selectedCompanies}
            onChange={handleCompaniesChange}
            selectAllType="entity"
            className={`h-9 ${FILTER_WIDTH.subject}`}
          />
          <MonthPicker
            value={periodFilter}
            onChange={setPeriodFilter}
            availablePeriods={periods}
            allowedPeriods={periods}
            placeholder="最新期间"
            className="h-9 w-full sm:w-[150px]"
          />
          <span className="text-xs text-muted-foreground">金额单位：万元</span>
        </FilterBar>
        {noticeElement}
        </Card>
```

### Step 4: 验证 + 提交

Run: `cd web && npx vitest run && npm run lint && npm run build`
Expected: 全绿。

手工冒烟：三页筛选交互不变；aging 行 1 仍单行不换行；吸顶行为不变。

```bash
git add web/src/pages/transactions/overview.tsx web/src/pages/transactions/aging.tsx web/src/pages/inventory/index.tsx
git commit -m "refactor(web): 往来与存货筛选卡收编 FilterBar，控件高度统一 h-9"
```

---

## Task 4: EmptyState 空态统一

**Files:**
- Create: `web/src/components/ui/empty-state.tsx`
- Modify: `web/src/pages/dashboard/index.tsx`（空态卡）、`web/src/pages/dashboard/analysis-placeholder.tsx`（占位卡）、`web/src/pages/inventory/empty-hint.tsx`（删除）及 6 个使用点、`web/src/components/data-table/data-table.tsx`（默认空态渲染）
- Test: `web/src/components/ui/__tests__/empty-state.test.tsx`

### Step 1: 写失败测试

Create `web/src/components/ui/__tests__/empty-state.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Inbox } from 'lucide-react'
import { EmptyState } from '../empty-state'

describe('EmptyState 统一空态', () => {
  it('渲染图标 + 标题 + 描述', () => {
    render(<EmptyState icon={Inbox} title="暂无数据" description="请调整筛选条件" />)
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
    expect(screen.getByText('请调整筛选条件')).toBeInTheDocument()
  })

  it('描述可选：不传时仅标题', () => {
    render(<EmptyState icon={Inbox} title="暂无数据" />)
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
  })

  it('compact 模式：小图标小间距（表格内空态）', () => {
    const { container } = render(<EmptyState icon={Inbox} title="暂无数据" compact />)
    expect(container.querySelector('.h-8.w-8')).toBeTruthy()
  })

  it('action 区渲染（按钮/链接）', () => {
    render(<EmptyState icon={Inbox} title="暂无数据" action={<button>去导入</button>} />)
    expect(screen.getByRole('button', { name: '去导入' })).toBeInTheDocument()
  })
})
```

### Step 2: 跑测试确认失败

Run: `cd web && npx vitest run src/components/ui/__tests__/empty-state.test.tsx`
Expected: FAIL——模块不存在。

### Step 3: 创建 EmptyState

Create `web/src/components/ui/empty-state.tsx`:

```tsx
import type { LucideIcon } from 'lucide-react'
import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  /** 图标（缺省 Inbox） */
  icon?: LucideIcon
  title: string
  description?: string
  /** 动作区（按钮/链接） */
  action?: ReactNode
  className?: string
  /** 紧凑模式：小图标小间距（表格/卡片内空态），缺省常规（页面级空态） */
  compact?: boolean
}

/**
 * 统一空态：图标 + 标题 + 描述 + 可选动作。
 * 三轨合一的唯一实现：页面空态卡 / 卡片内 EmptyHint / DataTable emptyText / 占位页。
 */
export function EmptyState({ icon: Icon = Inbox, title, description, action, className, compact = false }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center text-center', compact ? 'gap-1.5 py-2' : 'gap-3 py-16', className)}>
      <div className={cn('flex items-center justify-center rounded-xl bg-muted', compact ? 'h-8 w-8' : 'h-12 w-12')}>
        <Icon className={cn('text-muted-foreground', compact ? 'h-4 w-4' : 'h-6 w-6')} />
      </div>
      <p className={cn('font-medium text-foreground', compact ? 'text-xs' : 'text-sm')}>{title}</p>
      {description && <p className={cn('text-muted-foreground', compact ? 'text-xs' : 'text-xs max-w-md')}>{description}</p>}
      {action}
    </div>
  )
}
```

### Step 4: 跑测试确认通过

Run: `cd web && npx vitest run src/components/ui/__tests__/empty-state.test.tsx`
Expected: PASS（4 个用例）。

### Step 5: 收编三处来源

(1) `web/src/pages/dashboard/index.tsx` 空态卡（原 146-154 行）：

```tsx
        <Card className="animate-fade-in border border-border shadow-sm">
          <CardContent className="px-6 py-0">
            <EmptyState icon={Inbox} title="暂无可用数据" description="当前账户可能无任何数据权限，或尚未导入经营数据批次" />
          </CardContent>
        </Card>
```

（外层 Card 保留——页面级空态需要卡片容器；`Inbox` import 已有。）

(2) `web/src/pages/inventory/empty-hint.tsx` 删除，6 个使用点替换：

- `pages/inventory/category-rank-card.tsx:10,112`、`company-share-card.tsx:11,109`、`category-pie-card.tsx:10,93`、`trend-card.tsx:12,141`、`index.tsx:45,759,766`

替换模式（以 `category-rank-card.tsx` 为例，其余同构）：

```tsx
// import { EmptyHint } from './empty-hint'  →  import { EmptyState } from '@/components/ui/empty-state'
// <EmptyHint icon={X} title="..." hint="..." />  →  <EmptyState icon={X} title="..." description="..." compact />
```

> 每个使用点的 icon/title/hint 实参按原名透传：`hint` → `description`，并加 `compact`（卡片内空态）。注意 `EmptyHint` 的 className prop 透传保留（EmptyState 也有 className）。各使用点的具体实参在实现时逐一核对，**语义等价**，视觉仅图标容器从 rounded-full 变为 rounded-xl（可接受）。删除 `empty-hint.tsx` 文件。

(3) `web/src/pages/dashboard/analysis-placeholder.tsx` 占位卡收编（内部改用 EmptyState）：

```tsx
export function AnalysisPlaceholder({ title, note, actionLabel, actionHref }: AnalysisPlaceholderProps) {
  return (
    <Card className="animate-fade-in border border-border shadow-sm">
      <CardContent className="px-6 py-0">
        <EmptyState
          icon={Inbox}
          title={title}
          description={note ?? '功能开发中，敬请期待'}
          action={actionLabel && actionHref ? (
            <Button asChild variant="outline" size="sm">
              <Link to={actionHref}>
                {actionLabel}
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          ) : undefined}
        />
      </CardContent>
    </Card>
  )
}
```

（import EmptyState；行为与测试不变——占位页测试断言 `getByText(title)`、note 文案、跳转链接仍成立，需重跑 `analysis-placeholder.test.tsx` 确认。）

(4) `web/src/components/data-table/data-table.tsx` 默认空态升级（原 350-359 行）：

```tsx
            ) : data.length === 0 ? (
              <tr>
                <td
                  colSpan={cols.length}
                  role="status"
                  className="p-8 text-center text-muted-foreground"
                >
                  {typeof emptyText === 'string' ? <EmptyState title={emptyText} compact /> : emptyText}
                </td>
              </tr>
```

（import EmptyState；`emptyText` 默认为 '暂无数据'——所有表格空态从纯文本升级为统一空态视觉。重跑 `data-table.test.tsx` 确认"无数据时展示空文案"断言仍通过：EmptyState 渲染 title 文本，`getByText('没有数据')` 可命中。）

### Step 6: 验证 + 提交

Run: `cd web && npx vitest run && npm run lint && npm run build`
Expected: 全绿（重点回归：data-table.test.tsx、analysis-placeholder.test.tsx、dashboard 测试、inventory 相关测试）。

手工冒烟：看板空态（无数据账户）、存货各卡片空态、表格空态、经营分析占位页——视觉均为统一空态样式。

```bash
git add web/src/components/ui/empty-state.tsx web/src/components/ui/__tests__/empty-state.test.tsx web/src/pages/dashboard/index.tsx web/src/pages/dashboard/analysis-placeholder.tsx web/src/pages/inventory/empty-hint.tsx web/src/pages/inventory/index.tsx web/src/pages/inventory/category-rank-card.tsx web/src/pages/inventory/company-share-card.tsx web/src/pages/inventory/category-pie-card.tsx web/src/pages/inventory/trend-card.tsx web/src/components/data-table/data-table.tsx
git commit -m "refactor(web): 空态三轨合一为 EmptyState 组件（看板/存货/表格/占位页）"
```

---

## Task 5: 路由级骨架

**Files:**
- Create: `web/src/components/layout/route-fallback.tsx`
- Modify: `web/src/App.tsx:101`
- Test: `web/src/components/layout/__tests__/route-fallback.test.tsx`

### Step 1: 写失败测试

Create `web/src/components/layout/__tests__/route-fallback.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RouteFallback } from '../route-fallback'

describe('RouteFallback 路由级骨架', () => {
  it('渲染页头占位条与骨架卡片（替代纯文本加载中）', () => {
    render(<RouteFallback />)
    // 页头占位
    expect(document.querySelector('.skeleton.h-7')).toBeTruthy()
    // 复用既有骨架块：KPI 网格 4 卡 + 列表 2 面板
    expect(document.querySelectorAll('.skeleton')).length).toBeGreaterThan(10)
    // 无"加载中"纯文本
    expect(screen.queryByText(/加载中/)).not.toBeInTheDocument()
  })
})
```

> 注意：`expect(document.querySelectorAll('.skeleton')).length` 写法有误（应为 `expect(document.querySelectorAll('.skeleton').length).toBeGreaterThan(10)`），实现时按正确语法书写。skeleton 数量断言可放宽为 > 5。

### Step 2: 跑测试确认失败

Run: `cd web && npx vitest run src/components/layout/__tests__/route-fallback.test.tsx`
Expected: FAIL——模块不存在。

### Step 3: 创建 RouteFallback

Create `web/src/components/layout/route-fallback.tsx`:

```tsx
import { KpiGridSkeleton, ListSkeleton } from '@/components/ui/skeleton-blocks'

/**
 * 路由级懒加载骨架：页头占位条 + KPI/列表骨架。
 * 复用页内骨架块（skeleton-blocks），与页面加载态视觉连续，替代纯文本"加载中…"。
 * 通用形态（不感知具体路由）：渲染在 main 内容容器内（MainLayout 已就位），登录页懒加载时同样可用。
 */
export function RouteFallback() {
  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex items-center justify-between">
        <div className="skeleton h-7 w-44 rounded" />
        <div className="skeleton h-9 w-72 rounded" />
      </div>
      <KpiGridSkeleton count={4} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ListSkeleton rows={4} />
        <ListSkeleton rows={4} />
      </div>
    </div>
  )
}
```

### Step 4: 接入 App.tsx

Modify `web/src/App.tsx`——import 与 fallback 替换：

```tsx
import { RouteFallback } from '@/components/layout/route-fallback'
```

```tsx
            <Suspense fallback={<RouteFallback />}>
```

### Step 5: 验证 + 提交

Run: `cd web && npx vitest run && npm run lint && npm run build`
Expected: 全绿。

手工冒烟：dev 环境切换路由（首次进入各模块）——内容区显示骨架而非灰字"加载中…"。

```bash
git add web/src/components/layout/route-fallback.tsx web/src/components/layout/__tests__/route-fallback.test.tsx web/src/App.tsx
git commit -m "feat(web): 路由级懒加载骨架替换纯文本加载中，与页内骨架连续"
```

---

## Task 6: 全量验证收尾

**Files:** 无（验证 + 计划文档更新）

- [ ] Step 1: grep 清零验证

```powershell
cd web; Select-String -Path src -Pattern 'text-\[(10|11|12)px\]' -Recurse -Include *.ts,*.tsx
```

Expected: 0 匹配（排除工作区未提交文件可能存在的残留，如有则记录不处理）。

- [ ] Step 2: 全量测试 + lint + build

Run: `cd web && npx vitest run && npm run lint && npm run build`
Expected: 全绿。

- [ ] Step 3: 提交计划文档变更（若有）——Phase 2 计划文件本身留档，无需提交（docs/superpowers/plans 目录按项目惯例随功能提交或独立 docs 提交均可，本项目此前 plans 目录有独立 docs 提交先例，此处不强制）。

---

## 收尾验收标准（Phase 2）

- [ ] 任意值字号 `text-[10/11/12px]` 清零（grep 0 匹配）
- [ ] 新增 3 个基础组件：`FilterBar`、`EmptyState`、`RouteFallback`（+ 2 个页面级收编组件：`DashboardFilterBar`、`EmptyHint→EmptyState` 迁移）
- [ ] 看板两页筛选 JSX 单一来源（DashboardFilterBar）
- [ ] 空态四轨（看板卡/存货卡/表格/占位页）统一 EmptyState
- [ ] 路由切换显示骨架而非纯文本
- [ ] 全量测试全绿（基线 31 文件 / 232 用例 + 新增）

## 假设与说明

1. **lint 约束的边界**：oxlint 不检测 Tailwind 任意值类名（非 JS 语法），"任意值字号清零"以 grep 验证为准，无法 lint 强制；后续若引入 stylelint + tailwind 规则可补强（不在本 Phase）。
2. **aging 宽度保留**：方案建议宽度语义常量化，但 aging 行 1 是刻意密集单行（94/110/84px），强制 180/140 会破坏单行布局；本计划统一高度、保留其紧凑宽度，宽度常量供常规页面使用。
3. **`text-[13px]` 残留**：约 10 处组件级 13px 任意值（FlashMessage 等）不在方案 46/47 处清单内，本 Phase 不处理，记录留待后续。
4. **EmptyState 视觉微差**：EmptyHint 迁移后图标容器从 rounded-full 变 rounded-xl，属统一化预期的视觉对齐。
5. **工作区未提交文件**（`key-metrics-table.tsx`、`indicators/index.tsx`）：不在本 Phase 范围，若它们含有字号任意值类，grep 验证时单独记录，不修改。
6. **空态升级影响全站表格**：DataTable 默认空态从纯文本升级为图标+标题视觉，属方案"三轨合一"预期行为；现有测试断言文本仍可命中。
