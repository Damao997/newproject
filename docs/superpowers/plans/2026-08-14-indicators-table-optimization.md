# 经营指标/静态指标表格优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将财务指标页经营/静态两张表格升级为专业财报风：两级分组表头、达成率进度条（RateBar above）、列排序、分类筛选、密度切换、列设置、导出反馈。

**Architecture:** 纯前端增强，零后端改动。MetricTree（自研豁免项表格）以列配置驱动重构（分组表头/排序/显隐），新增两个纯函数模块（`lib/metric-sort.ts` 树形同级排序、`lib/metric-filter.ts` 分类过滤）配 vitest 单测，状态全部持久化到现有 `pageStateStore.indicators`。视觉资产复用：RateBar 增加 `above` 变体（dashboard 默认形态不变）、`TABLE_HEAD_BASE` 共享常量、`filterTreeKeepSubtree` 过滤语义。

**Tech Stack:** React 18 + TypeScript + Tailwind（语义令牌）/ Radix UI（Popover/DropdownMenu/Checkbox）/ zustand persist（pageStateStore）/ vitest + Testing Library。**不引入 antd**（`pro-table-inner.tsx` 保持 antd 唯一引用点）。

**依据 spec:** `docs/superpowers/specs/2026-08-14-indicators-table-design.md`

---

## 文件结构

| 文件 | 变更 | 职责 |
|---|---|---|
| `web/src/components/ui/rate-bar.tsx` | 改 | 新增 `variant?: 'default' \| 'above'`：above = 百分比文字浮于色条上方 |
| `web/src/lib/metric-sort.ts` | 新建 | `metricValueOf` / `sortTreeByLevel`：树形每层同级排序纯函数 |
| `web/src/lib/metric-filter.ts` | 新建 | `filterByCategories`：按 level0 分类保留子树纯函数 |
| `web/src/components/subject-tree/metric-tree.tsx` | 改 | 列配置驱动重构：分组表头/列顺序/斑马纹/排序表头/分类筛选/密度/列显隐/达成率 RateBar |
| `web/src/stores/pageStateStore.ts` | 改 | `IndicatorsState` 增加 `sortKey/sortDirection/hiddenColumns/density/categoryFilter` + 默认值 |
| `web/src/pages/indicators/index.tsx` | 改 | 工具栏（密度/列设置）、排序与分类筛选接线、导出列顺序同步、导出 loading + 内联提示 |
| 测试 | 新建×3 | `components/ui/__tests__/rate-bar.test.tsx`、`lib/__tests__/metric-sort.test.ts`、`lib/__tests__/metric-filter.test.ts` |

---

### Task 1: RateBar `above` 变体

**Files:**
- Modify: `web/src/components/ui/rate-bar.tsx`
- Test: `web/src/components/ui/__tests__/rate-bar.test.tsx`（新建）

- [ ] **Step 1: 写失败测试**

创建 `web/src/components/ui/__tests__/rate-bar.test.tsx`：

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RateBar } from '@/components/ui/rate-bar'

describe('RateBar', () => {
  it('default 变体：文字在条内（现状行为）', () => {
    render(<RateBar rate={0.823} />)
    expect(screen.getByText('82.3%')).toBeInTheDocument()
  })

  it('above 变体：百分比文字渲染在色条上方', () => {
    const { container } = render(<RateBar rate={0.823} variant="above" />)
    expect(screen.getByText('82.3%')).toBeInTheDocument()
    // 文字 span 出现在色条 span 之前（DOM 顺序 = 上方）
    const html = container.innerHTML
    expect(html.indexOf('82.3%')).toBeLessThan(html.indexOf('bg-chart-1'))
  })

  it('above 变体：无预算显示 – 与空条', () => {
    const { container } = render(<RateBar rate={null} variant="above" />)
    expect(screen.getByText('–')).toBeInTheDocument()
    expect(container.querySelector('.bg-chart-1')).toBeNull()
  })

  it('above 变体：超过 100% 填充截断，文字显示实际值', () => {
    const { container } = render(<RateBar rate={1.102} variant="above" />)
    expect(screen.getByText('110.2%')).toBeInTheDocument()
    const fill = container.querySelector('.bg-chart-1') as HTMLElement
    expect(fill.style.width).toBe('100%')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd web && npx vitest run src/components/ui/__tests__/rate-bar.test.tsx`
Expected: FAIL（`variant` prop 不存在，TS 编译错误或渲染无 above 结构）

- [ ] **Step 3: 实现 above 变体**

修改 `web/src/components/ui/rate-bar.tsx`：

```tsx
import { cn } from '@/lib/utils'
import { formatPercent } from '@/lib/utils'

/**
 * 达成率/使用率进度条：固定宽度圆角条，填充色跟随图表主色（--chart-1，随侧边栏风格切换：橙/亮紫/中性蓝灰）。
 * variant="default"：条内黑色加粗文字显示百分比（dashboard 卡牌使用）；
 * variant="above"：百分比文字浮于色条上方（财务指标表格达成率单元格使用）。
 * rate 为 null（无预算）显示 "–" 空条；超过 100% 时填充截断 100%，文字显示实际值。
 */
export function RateBar({ rate, variant = 'default' }: { rate: number | null; variant?: 'default' | 'above' }) {
  const pct = rate === null ? null : Math.min(Math.max(rate, 0), 100)
  if (variant === 'above') {
    return (
      <span className="inline-flex flex-col items-center gap-0.5">
        <span className="font-num text-xs font-bold leading-none text-foreground">
          {rate === null ? '–' : formatPercent(rate / 100)}
        </span>
        <span className="inline-block h-2 w-24 overflow-hidden rounded bg-muted">
          {pct !== null && <span className="block h-full bg-chart-1" style={{ width: `${pct}%` }} />}
        </span>
      </span>
    )
  }
  return (
    <span className="inline-flex h-5 w-24 items-center justify-center overflow-hidden rounded bg-muted align-middle">
      {pct === null ? (
        <span className="text-xs text-muted-foreground">–</span>
      ) : (
        <span className="relative flex h-full w-full items-center justify-center">
          <span className={cn('absolute inset-y-0 left-0 bg-chart-1')} style={{ width: `${pct}%` }} />
          <span className="relative font-num text-xs font-bold text-foreground">{formatPercent(rate! / 100)}</span>
        </span>
      )}
    </span>
  )
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd web && npx vitest run src/components/ui/__tests__/rate-bar.test.tsx`
Expected: PASS（4 个用例）

- [ ] **Step 5: 提交**

```bash
git add web/src/components/ui/rate-bar.tsx web/src/components/ui/__tests__/rate-bar.test.tsx
git commit -m "feat: RateBar 增加 above 变体（百分比文字浮于色条上方）"
```

---

### Task 2: 树形同级排序纯函数（TDD）

**Files:**
- Create: `web/src/lib/metric-sort.ts`
- Test: `web/src/lib/__tests__/metric-sort.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

创建 `web/src/lib/__tests__/metric-sort.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { sortTreeByLevel, metricValueOf } from '@/lib/metric-sort'
import type { SubjectNode } from '@/types'
import type { MetricValue } from '@/lib/metric-values'

function node(code: string, children: SubjectNode[] = []): SubjectNode {
  return { code, name: code, level: 0, category: 'cat', dataType: 'data', valueType: 'amount', children }
}

const MV = (partial: Partial<MetricValue> = {}): MetricValue => ({
  budget: 100, actual: 10, samePeriod: 8, ytd: 50, samePeriodYtd: 40, ...partial,
})

describe('metricValueOf', () => {
  it('原始字段直接取值', () => {
    expect(metricValueOf('budget', MV({ budget: 200 }))).toBe(200)
    expect(metricValueOf('actual', MV({ actual: 30 }))).toBe(30)
  })
  it('yoy/achievement/ytdYoy 按口径计算', () => {
    expect(metricValueOf('yoy', MV({ actual: 10, samePeriod: 8 }))).toBeCloseTo(0.25)
    expect(metricValueOf('achievement', MV({ ytd: 50, budget: 100 }))).toBe(0.5)
    expect(metricValueOf('ytdYoy', MV({ ytd: 50, samePeriodYtd: 40 }))).toBeCloseTo(0.25)
  })
})

describe('sortTreeByLevel', () => {
  it('升序排序同层兄弟，保持树形结构', () => {
    const a = node('a', [node('a1'), node('a2')])
    const b = node('b', [node('b1')])
    const c = node('c')
    const map = new Map<string, MetricValue>([
      ['a', MV({ actual: 10 })], ['b', MV({ actual: 30 })], ['c', MV({ actual: 20 })],
    ])
    const sorted = sortTreeByLevel([a, b, c], map, 'actual', 'asc')
    expect(sorted.map((n) => n.code)).toEqual(['a', 'c', 'b'])
    // 子节点同样按该键排序
    const map2 = new Map(map)
    map2.set('a1', MV({ actual: 5 }))
    map2.set('a2', MV({ actual: 15 }))
    const sorted2 = sortTreeByLevel([a], map2, 'actual', 'asc')
    expect(sorted2[0].children.map((n) => n.code)).toEqual(['a1', 'a2'])
  })

  it('降序排序', () => {
    const map = new Map<string, MetricValue>([
      ['a', MV({ actual: 10 })], ['b', MV({ actual: 30 })], ['c', MV({ actual: 20 })],
    ])
    const sorted = sortTreeByLevel([node('a'), node('b'), node('c')], map, 'actual', 'desc')
    expect(sorted.map((n) => n.code)).toEqual(['b', 'c', 'a'])
  })

  it('无值的节点排最后（保持相对顺序）', () => {
    const map = new Map<string, MetricValue>([['b', MV({ actual: 30 })]])
    const sorted = sortTreeByLevel([node('a'), node('b'), node('c')], map, 'actual', 'asc')
    expect(sorted.map((n) => n.code)).toEqual(['b', 'a', 'c'])
  })

  it('fromLevel=1 时根层不动（经营指标分类根不排序）', () => {
    const a = node('a', [node('a1'), node('a2')])
    const b = node('b')
    const map = new Map<string, MetricValue>([
      ['a', MV({ actual: 30 })], ['b', MV({ actual: 10 })],
      ['a1', MV({ actual: 5 })], ['a2', MV({ actual: 15 })],
    ])
    const sorted = sortTreeByLevel([a, b], map, 'actual', 'asc', { fromLevel: 1 })
    expect(sorted.map((n) => n.code)).toEqual(['a', 'b'])
    expect(sorted[0].children.map((n) => n.code)).toEqual(['a1', 'a2'])
  })

  it('不修改原树（纯函数）', () => {
    const a = node('a')
    const b = node('b')
    const map = new Map<string, MetricValue>([['a', MV({ actual: 10 })], ['b', MV({ actual: 30 })]])
    const before = [a, b]
    sortTreeByLevel(before, map, 'actual', 'asc')
    expect(before.map((n) => n.code)).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd web && npx vitest run src/lib/__tests__/metric-sort.test.ts`
Expected: FAIL（模块不存在，import 解析失败）

- [ ] **Step 3: 实现纯函数**

创建 `web/src/lib/metric-sort.ts`：

```ts
import type { SubjectNode } from '@/types'
import { calcAchievement, calcYoy, calcYtdYoy, type MetricValue } from '@/lib/metric-values'

/** 可排序指标键：金额列取原始字段，比率列按口径计算（与表格展示一致） */
export type MetricSortKey = 'budget' | 'actual' | 'samePeriod' | 'yoy' | 'achievement' | 'ytd' | 'samePeriodYtd' | 'ytdYoy'

export type MetricSortDirection = 'asc' | 'desc'

export interface MetricSortOptions {
  /** 参与排序的最浅层级（默认 0 全部；经营指标传 1：分类根不排序，保持分类列 rowSpan 分组顺序） */
  fromLevel?: number
}

/** 指标键 → 排序数值（同比/达成率/累计同比按展示口径计算，与单元格渲染一致） */
export function metricValueOf(key: MetricSortKey, mv: MetricValue): number {
  switch (key) {
    case 'budget': return mv.budget
    case 'actual': return mv.actual
    case 'samePeriod': return mv.samePeriod
    case 'ytd': return mv.ytd
    case 'samePeriodYtd': return mv.samePeriodYtd
    case 'yoy': return calcYoy(mv)
    case 'achievement': return calcAchievement(mv)
    case 'ytdYoy': return calcYtdYoy(mv)
  }
}

/**
 * 树形同级排序：对每层兄弟节点按指标值排序，父节点值不变、层级结构不被破坏；
 * 无值（valueMap 缺失）的节点排最后且保持相对顺序。纯函数，不修改入参。
 */
export function sortTreeByLevel(
  nodes: SubjectNode[],
  valueMap: Map<string, MetricValue>,
  key: MetricSortKey,
  direction: MetricSortDirection,
  options: MetricSortOptions = {},
): SubjectNode[] {
  const { fromLevel = 0 } = options
  const factor = direction === 'asc' ? 1 : -1
  const sortLevel = (ns: SubjectNode[], level: number): SubjectNode[] => {
    let sorted = ns
    if (level >= fromLevel) {
      sorted = [...ns].sort((a, b) => {
        const va = valueMap.get(a.code)
        const vb = valueMap.get(b.code)
        if (!va) return 1
        if (!vb) return -1
        return (metricValueOf(key, va) - metricValueOf(key, vb)) * factor
      })
    }
    return sorted.map((n) => ({ ...n, children: sortLevel(n.children, level + 1) }))
  }
  return sortLevel(nodes, 0)
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd web && npx vitest run src/lib/__tests__/metric-sort.test.ts`
Expected: PASS（7 个用例）

- [ ] **Step 5: 提交**

```bash
git add web/src/lib/metric-sort.ts web/src/lib/__tests__/metric-sort.test.ts
git commit -m "feat: 指标树同级排序纯函数 sortTreeByLevel"
```

---

### Task 3: 分类过滤纯函数（TDD）

**Files:**
- Create: `web/src/lib/metric-filter.ts`
- Test: `web/src/lib/__tests__/metric-filter.test.ts`（新建）

- [ ] **Step 1: 写失败测试**

创建 `web/src/lib/__tests__/metric-filter.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { filterByCategories } from '@/lib/metric-filter'
import type { SubjectNode } from '@/types'

function node(code: string, children: SubjectNode[] = []): SubjectNode {
  return { code, name: code, level: 0, category: 'cat', dataType: 'data', valueType: 'amount', children }
}

describe('filterByCategories', () => {
  const tree = [
    node('OP_01', [node('OP_0101'), node('OP_0102')]),
    node('OP_02', [node('OP_0201')]),
    node('OP_03'),
  ]

  it('codes 为 null 时返回原树', () => {
    expect(filterByCategories(tree, null)).toBe(tree)
  })

  it('codes 为空数组时返回原树', () => {
    expect(filterByCategories(tree, [])).toBe(tree)
  })

  it('按 level0 编码过滤并保留整棵子树', () => {
    const filtered = filterByCategories(tree, ['OP_01'])
    expect(filtered.map((n) => n.code)).toEqual(['OP_01'])
    expect(filtered[0].children.map((n) => n.code)).toEqual(['OP_0101', 'OP_0102'])
  })

  it('多分类命中保持原顺序', () => {
    const filtered = filterByCategories(tree, ['OP_03', 'OP_01'])
    expect(filtered.map((n) => n.code)).toEqual(['OP_01', 'OP_03'])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd web && npx vitest run src/lib/__tests__/metric-filter.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现纯函数**

创建 `web/src/lib/metric-filter.ts`：

```ts
import type { SubjectNode } from '@/types'

/**
 * 按 level0 分类编码过滤树：仅保留命中分类的整棵子树（子树原样返回，与 filterTreeKeepSubtree 语义一致）；
 * categoryCodes 为 null 或空数组时返回原树。纯函数，不修改入参。
 */
export function filterByCategories(nodes: SubjectNode[], categoryCodes: string[] | null): SubjectNode[] {
  if (!categoryCodes || categoryCodes.length === 0) return nodes
  const set = new Set(categoryCodes)
  return nodes.filter((n) => set.has(n.code))
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd web && npx vitest run src/lib/__tests__/metric-filter.test.ts`
Expected: PASS（4 个用例）

- [ ] **Step 5: 提交**

```bash
git add web/src/lib/metric-filter.ts web/src/lib/__tests__/metric-filter.test.ts
git commit -m "feat: 指标分类过滤纯函数 filterByCategories"
```

---

### Task 4: MetricTree 分组表头 + 列顺序 + 斑马纹 + 达成率进度条（视觉层）

**Files:**
- Modify: `web/src/components/subject-tree/metric-tree.tsx`
- Modify: `web/src/components/ui/rate-bar.tsx` 已就绪（Task 1）

- [ ] **Step 1: 引入列配置并重构表头与单元格渲染**

重写 `web/src/components/subject-tree/metric-tree.tsx` 为列配置驱动。**先更新文件顶部 import**：

```ts
import { Fragment, useState, type ReactNode } from 'react'
import { RateBar } from '@/components/ui/rate-bar'
// 原行改为（达成率改用 RateBar 渲染，formatPercent 不再直接使用）：
import { cn, formatMetricValue, getChangeColor } from '@/lib/utils'
```

核心变更：

1. 新增列配置常量与类型（放在文件顶部 `renderValueCells` 附近，**带 export 供页面列设置面板复用**）：

```tsx
/** 值列形态：amount 金额 / pct 红涨绿跌百分比 / achievement 达成率进度条 */
type MetricColKind = 'amount' | 'pct' | 'achievement'

interface MetricColumn {
  key: string
  header: string
  minWidth: number
  kind: MetricColKind
  /** 主列强调（font-medium） */
  primary?: boolean
  /** 次要列降权（text-muted-foreground） */
  secondary?: boolean
}

/** 经营指标值列（达成率归「本年累计」组尾：累计达成率 = 本年累计/全年预算） */
export const OPERATING_COLUMNS: MetricColumn[] = [
  { key: 'budget', header: '预算金额', minWidth: 112, kind: 'amount' },
  { key: 'actual', header: '本月实际', minWidth: 112, kind: 'amount', primary: true },
  { key: 'samePeriod', header: '同期实际', minWidth: 112, kind: 'amount', secondary: true },
  { key: 'yoy', header: '同比', minWidth: 80, kind: 'pct' },
  { key: 'ytd', header: '本年累计', minWidth: 112, kind: 'amount', primary: true },
  { key: 'samePeriodYtd', header: '同期累计', minWidth: 112, kind: 'amount', secondary: true },
  { key: 'ytdYoy', header: '累计同比', minWidth: 80, kind: 'pct' },
  { key: 'achievement', header: '达成率', minWidth: 104, kind: 'achievement' },
]

/** 经营指标分组表头：组名 → 明细列 keys */
const OPERATING_GROUPS: { label: string; keys: string[] }[] = [
  { label: '本月实际', keys: ['budget', 'actual', 'samePeriod', 'yoy'] },
  { label: '本年累计', keys: ['ytd', 'samePeriodYtd', 'ytdYoy', 'achievement'] },
]

/** 静态指标值列（单行表头，无分组） */
export const STATIC_COLUMNS: MetricColumn[] = [
  { key: 'actual', header: '本期金额', minWidth: 112, kind: 'amount', primary: true },
  { key: 'samePeriod', header: '同期金额', minWidth: 112, kind: 'amount', secondary: true },
  { key: 'yoy', header: '变动率', minWidth: 80, kind: 'pct' },
]
```

2. 替换 `renderValueCells` 为按列配置渲染（金额列 `mv[key]`、pct 列按 key 计算、achievement 渲染 RateBar above）；**列宽用内联 style（Tailwind JIT 不扫描动态拼接类名）**：

```tsx
/** 数值单元格：按列配置渲染（金额/数量/比率分型格式化；同比红涨绿跌；达成率进度条 + 浮于条上方的百分比） */
function renderValueCells(
  mv: MetricValue | undefined,
  columns: MetricColumn[],
  valueType?: SubjectNode['valueType'],
) {
  const fmt = (v: number) => formatMetricValue(v, valueType)
  const yoyOf = (key: string, value: MetricValue) => (key === 'ytdYoy' ? calcYtdYoy(value) : calcYoy(value))
  return columns.map((col) => {
    const cellBase = cn(
      'whitespace-nowrap border-b px-3 py-2 align-middle text-center font-num',
      col.primary && 'font-medium',
      col.secondary && 'text-muted-foreground',
    )
    let content: ReactNode = '-'
    if (mv) {
      if (col.kind === 'amount') {
        content = fmt(mv[col.key as 'budget' | 'actual' | 'samePeriod' | 'ytd' | 'samePeriodYtd'])
      } else if (col.kind === 'pct') {
        content = <ChangeText value={yoyOf(col.key, mv)} />
      } else {
        // 达成率 = 累计达成率（本年累计/全年预算）；无预算时 RateBar 传 null 显示空条
        const rate = mv.budget === 0 ? null : calcAchievement(mv)
        content = <RateBar rate={rate} variant="above" />
      }
    }
    return (
      <td key={col.key} className={cellBase} style={{ minWidth: col.minWidth }}>
        {content}
      </td>
    )
  })
}
```

3. 双行分组表头（经营指标）：组名行 `sticky top-0`、明细行 `sticky top-[44px]`（第一行 h-11=44px）；分类/科目 th `rowSpan={2}` + sticky left；斑马纹用 CSS `nth-child`（tbody 下 tr 按 DOM 顺序排列，无需 JS 计数）。

**替换整个 `MetricTree` 组件的 `return` 段为：**

```tsx
  const isOperating = variant === 'operating'
  const valueCols = isOperating ? OPERATING_COLUMNS : STATIC_COLUMNS
  const colSpan = 1 + valueCols.length + (categoryColumn ? 1 : 0)
  // 表头 sticky：组名行 top-0、明细行 top-[44px]（组名行 h-11=44px，单一来源常量）
  const GROUP_HEAD_H = 44
  const headBase = cn(TABLE_HEAD_BASE, 'h-11 border-b bg-muted px-3')
  return (
    <div className="overflow-hidden rounded-card bg-muted/40 p-2">
      <div
        className={cn('bg-background', 'overflow-x-auto', stickyHeaderTop > 0 && 'overflow-y-auto')}
        style={
          stickyHeaderTop > 0
            ? { position: 'sticky', top: stickyHeaderTop, maxHeight: `calc(100dvh - ${stickyHeaderTop}px - 24px)` }
            : undefined
        }
      >
        <table
          className="w-full caption-bottom border-separate border-spacing-0 text-[13px] [&_tbody_tr:nth-child(even)]:bg-muted/30"
          style={{ minWidth: isOperating ? 1056 : 464 }}
        >
          <thead>
            {isOperating ? (
              <>
                <tr className="sticky top-0 z-[2] bg-muted">
                  {categoryColumn && (
                    <th
                      rowSpan={2}
                      className={cn(headBase, 'sticky left-0 z-[3] border-r bg-muted text-center shadow-[8px_0_12px_-8px_rgba(0,0,0,0.3)]')}
                      style={{ width: CATEGORY_COL_WIDTH, minWidth: CATEGORY_COL_WIDTH, maxWidth: CATEGORY_COL_WIDTH }}
                    >
                      分类
                    </th>
                  )}
                  <th
                    rowSpan={2}
                    className={cn(headBase, 'sticky z-[3] min-w-[160px] border-r bg-muted text-center shadow-[8px_0_12px_-8px_rgba(0,0,0,0.3)]')}
                    style={{ left: categoryColumn ? CATEGORY_COL_WIDTH : 0 }}
                  >
                    科目
                  </th>
                  {OPERATING_GROUPS.map((g) => (
                    <th key={g.label} colSpan={g.keys.length} className={cn(headBase, 'border-l border-border/60 text-[13px] font-semibold')}>
                      {g.label}
                    </th>
                  ))}
                </tr>
                <tr className="sticky bg-muted" style={{ top: GROUP_HEAD_H }}>
                  {OPERATING_GROUPS.flatMap((g) => g.keys).map((key) => {
                    const col = OPERATING_COLUMNS.find((c) => c.key === key)!
                    return (
                      <th key={col.key} scope="col" className={cn(headBase, 'text-center')} style={{ minWidth: col.minWidth }}>
                        {col.header}
                      </th>
                    )
                  })}
                </tr>
              </>
            ) : (
              <tr className="sticky top-0 z-[2] bg-muted">
                <th
                  className={cn(headBase, 'sticky z-[3] min-w-[160px] border-r bg-muted text-center shadow-[8px_0_12px_-8px_rgba(0,0,0,0.3)]')}
                  style={{ left: 0 }}
                >
                  科目
                </th>
                {STATIC_COLUMNS.map((col) => (
                  <th key={col.key} scope="col" className={cn(headBase, 'text-center')} style={{ minWidth: col.minWidth }}>
                    {col.header}
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {nodes.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="p-6 text-center text-muted-foreground">
                  {emptyText}
                </td>
              </tr>
            ) : categoryColumn ? (
              <CategoryRows
                level0Nodes={nodes}
                valueMap={valueMap}
                columns={valueCols}
                expandedCodes={expandedCodes}
                onToggle={onToggle}
                onAnalyze={onAnalyze}
                analyzeDisabled={analyzeDisabled}
                analyzeHint={analyzeHint}
              />
            ) : (
              <MetricRows
                nodes={nodes}
                depth={0}
                valueMap={valueMap}
                columns={valueCols}
                expandedCodes={expandedCodes}
                onToggle={onToggle}
                onAnalyze={onAnalyze}
                analyzeDisabled={analyzeDisabled}
                analyzeHint={analyzeHint}
              />
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
```

- [ ] **Step 2: 更新行渲染组件（columns 参数）**

将 `MetricRows` 与 `CategoryRows` 整体替换为以下版本（移除 `isOperating`、传入 `columns`；其余展开/悬停逻辑不变）：

```tsx
/** 普通树形行（静态指标 / 非分类布局） */
function MetricRows({
  nodes,
  depth,
  valueMap,
  columns,
  expandedCodes,
  onToggle,
  onAnalyze,
  analyzeDisabled,
  analyzeHint,
}: {
  nodes: SubjectNode[]
  depth: number
  valueMap: Map<string, MetricValue>
  columns: MetricColumn[]
  expandedCodes: Set<string>
  onToggle: (code: string) => void
  onAnalyze?: (node: SubjectNode) => void
  analyzeDisabled?: boolean
  analyzeHint?: string
}) {
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0
        const isExpanded = expandedCodes.has(node.code)
        return (
          <Fragment key={node.code}>
            <tr className="group transition-colors hover:bg-muted/50">
              <SubjectCell
                node={node}
                indentDepth={depth}
                expandedCodes={expandedCodes}
                onToggle={onToggle}
                onAnalyze={onAnalyze}
                analyzeDisabled={analyzeDisabled}
                analyzeHint={analyzeHint}
              />
              {renderValueCells(valueMap.get(node.code), columns, node.valueType)}
            </tr>
            {hasChildren && isExpanded && (
              <MetricRows
                nodes={node.children}
                depth={depth + 1}
                valueMap={valueMap}
                columns={columns}
                expandedCodes={expandedCodes}
                onToggle={onToggle}
                onAnalyze={onAnalyze}
                analyzeDisabled={analyzeDisabled}
                analyzeHint={analyzeHint}
              />
            )}
          </Fragment>
        )
      })}
    </>
  )
}
```

```tsx
/** 分类列布局行（经营指标）：level0 抽为最左侧跨行「分类」列（sticky 锁定，固定宽 96px） */
function CategoryRows({
  level0Nodes,
  valueMap,
  columns,
  expandedCodes,
  onToggle,
  onAnalyze,
  analyzeDisabled,
  analyzeHint,
}: {
  level0Nodes: SubjectNode[]
  valueMap: Map<string, MetricValue>
  columns: MetricColumn[]
  expandedCodes: Set<string>
  onToggle: (code: string) => void
  onAnalyze?: (node: SubjectNode) => void
  analyzeDisabled?: boolean
  analyzeHint?: string
}) {
  // 悬停高亮分类列：rowSpan 单元格 DOM 只属于组内首行，group-hover 无法响应其他行悬停，改为 JS 跟踪悬停行所属组
  const [hoverCat, setHoverCat] = useState<string | null>(null)
  return (
    <>
      {level0Nodes.map((cat) => {
        const rows = collectVisibleRows(cat.children, expandedCodes)
        if (rows.length === 0) return null
        const catHovered = hoverCat === cat.code
        return (
          <Fragment key={cat.code}>
            {rows.map((node, idx) => (
              <tr
                key={node.code}
                className="group transition-colors hover:bg-muted/50"
                onMouseEnter={() => setHoverCat(cat.code)}
                onMouseLeave={() => setHoverCat((prev) => (prev === cat.code ? null : prev))}
              >
                {idx === 0 && (
                  <td
                    rowSpan={rows.length}
                    className={cn(
                      'sticky left-0 z-[1] overflow-hidden whitespace-normal border-b border-r bg-background px-2 text-center align-middle font-semibold text-foreground shadow-[8px_0_12px_-8px_rgba(0,0,0,0.3)]',
                      catHovered && 'bg-muted',
                    )}
                    style={{ width: CATEGORY_COL_WIDTH, minWidth: CATEGORY_COL_WIDTH, maxWidth: CATEGORY_COL_WIDTH }}
                  >
                    {cat.name}
                  </td>
                )}
                {/* 科目列缩进：level1 → 0，level2 → 1 ...；分类列占 CATEGORY_COL_WIDTH，科目列 sticky 偏移对齐 */}
                <SubjectCell
                  node={node}
                  indentDepth={node.level - 1}
                  expandedCodes={expandedCodes}
                  onToggle={onToggle}
                  stickyLeftPx={CATEGORY_COL_WIDTH}
                  onAnalyze={onAnalyze}
                  analyzeDisabled={analyzeDisabled}
                  analyzeHint={analyzeHint}
                />
                {renderValueCells(valueMap.get(node.code), columns, node.valueType)}
              </tr>
            ))}
          </Fragment>
        )
      })}
    </>
  )
}
```

- [ ] **Step 3: 验证编译与既有测试**

Run: `cd web && npx tsc --noEmit && npx oxlint src/components/subject-tree`
Expected: 无错误；oxlint 无告警

- [ ] **Step 4: 浏览器手动验证（关键风险点）**

Run: `cd web && npm run dev`（或项目既有 dev 脚本），打开财务指标 → 经营指标，验证：

- 分组表头渲染：第一行「本月实际」（跨 4 列）、「本年累计」（跨 4 列），分类/科目垂直跨两行
- 垂直滚动时组名行固定 top-0、明细行固定 top-44px；水平滚动时分类/科目列固定（**重点验证 rowSpan=2 sticky 左列在 Chromium 下跟随滚动**）
- 达成率单元格：主题色条 + 条上方百分比；有预算/无预算/超 100% 三态
- 斑马纹：偶数行浅灰底，hover 高亮覆盖正常

> 若 rowSpan sticky 左列表头在滚动时不跟随（Chromium 兼容问题），降级方案：分类/科目表头去掉 sticky left（仅数据行保留 sticky），在 Task 5 提交中一并处理。

- [ ] **Step 5: 提交**

```bash
git add web/src/components/subject-tree/metric-tree.tsx
git commit -m "feat: 指标表分组表头/列顺序/斑马纹/达成率进度条（视觉层）"
```

---

### Task 5: 列排序接线（交互层）

**Files:**
- Modify: `web/src/components/subject-tree/metric-tree.tsx`
- Modify: `web/src/stores/pageStateStore.ts`
- Modify: `web/src/pages/indicators/index.tsx`

- [ ] **Step 1: store 增加排序状态**

修改 `web/src/stores/pageStateStore.ts`：

```ts
// IndicatorsState 内追加：
  /** 列排序键（null 不排序；受控，持久化） */
  sortKey: string | null
  /** 列排序方向 */
  sortDirection: 'asc' | 'desc' | null
```

```ts
// defaultIndicators 内追加：
  sortKey: null,
  sortDirection: null,
```

- [ ] **Step 2: MetricTree 增加排序 props 与表头排序按钮**

`MetricTreeProps` 追加（与 DataTable 受控排序同 API）：

```ts
  /** 受控排序键（null 表示不排序；传 onSortChange 时建议同时传入） */
  sortKey?: string | null
  /** 受控排序方向 */
  sortDirection?: SortDirection | null
  /** 排序变更回调（方向循环：升序 → 降序 → 取消，取消时 direction 为 null） */
  onSortChange?: (key: string, direction: SortDirection | null) => void
```

导入 `SortDirection` 与排序图标：

```ts
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { SortDirection } from '@/components/data-table/data-table'
```

表头明细 th 渲染为排序按钮（经营 + 静态统一）：

```tsx
{OPERATING_GROUPS.flatMap((g) => g.keys).map((key) => {
  const col = OPERATING_COLUMNS.find((c) => c.key === key)!
  const sortState = sortKey === col.key ? sortDirection : null
  return (
    <th key={col.key} scope="col" aria-sort={sortState ? (sortState === 'asc' ? 'ascending' : 'descending') : undefined} className={cn(headBase, 'text-center')} style={{ minWidth: col.minWidth }}>
      <button
        type="button"
        onClick={() => handleSort(col.key)}
        className="inline-flex items-center gap-1 font-medium hover:text-foreground"
        aria-label={`按${col.header}排序`}
      >
        {col.header}
        {sortState ? (
          sortState === 'asc' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
        )}
      </button>
    </th>
  )
})}
```

组件内新增排序三态处理器（受控；与 DataTable handleSort 同逻辑）：

```tsx
  const handleSort = (key: string) => {
    const next =
      sortKey === key
        ? sortDirection === 'asc'
          ? { key, direction: null as const }
          : { key, direction: 'desc' as const }
        : { key, direction: 'asc' as const }
    onSortChange?.(next.key, next.direction)
  }
```

- [ ] **Step 3: 页面接线（排序 → 过滤后的树）**

`web/src/pages/indicators/index.tsx`：

```ts
// store 读取（现有 usePageStore 解构处追加）：
  const sortKey = usePageStore((s) => s.indicators.sortKey)
  const sortDirection = usePageStore((s) => s.indicators.sortDirection)
  const setSort = useCallback(
    (key: string, direction: 'asc' | 'desc' | null) => setIndicators({ sortKey: key, sortDirection: direction }),
    [setIndicators],
  )
```

```ts
// 排序作用于分类过滤后的树（经营指标分类根不排序 fromLevel=1；静态全部层级）：
  const sortedTree = useMemo(() => {
    if (!sortKey || !sortDirection) return categoryFilteredTree
    return sortTreeByLevel(categoryFilteredTree, activeValueMap, sortKey as MetricSortKey, sortDirection, {
      fromLevel: isOperating ? 1 : 0,
    })
  }, [categoryFilteredTree, activeValueMap, sortKey, sortDirection, isOperating])
```

（Task 5 的 `sortedTree` 基于 `visibleTree`；Task 6 Step 3 将依赖替换为 `categoryFilteredTree`。）

```ts
// 传入 MetricTree：
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSortChange={setSort}
```

- [ ] **Step 4: 编译 + 手动验证**

Run: `cd web && npx tsc --noEmit && npx oxlint src`
Expected: 无错误

手动验证：点「本月实际」表头 → 升序（组内科目按值升序）→ 再点 → 降序 → 再点 → 取消；刷新页面排序保持；展开/折叠不丢排序；分类列分组顺序不变。

- [ ] **Step 5: 提交**

```bash
git add web/src/components/subject-tree/metric-tree.tsx web/src/stores/pageStateStore.ts web/src/pages/indicators/index.tsx
git commit -m "feat: 指标表列排序（树内同级排序，持久化）"
```

---

### Task 6: 分类列筛选（交互层）

**Files:**
- Modify: `web/src/components/subject-tree/metric-tree.tsx`
- Modify: `web/src/stores/pageStateStore.ts`
- Modify: `web/src/pages/indicators/index.tsx`

- [ ] **Step 1: store 增加分类筛选状态**

`IndicatorsState` 追加 `categoryFilter: string[] | null`；`defaultIndicators` 追加 `categoryFilter: null`。

- [ ] **Step 2: MetricTree 分类列头筛选入口**

`MetricTreeProps` 追加：

```ts
  /** 分类列筛选（null = 全部；否则为勾选 level0 code 列表）；仅 categoryColumn 时生效 */
  categoryFilter?: string[] | null
  /** 分类筛选变更回调（null = 全部） */
  onCategoryFilterChange?: (codes: string[] | null) => void
```

导入 `Popover/PopoverTrigger/PopoverContent/Checkbox/Filter`，分类 th 内渲染筛选按钮（仅 `categoryColumn && onCategoryFilterChange` 时）：

```tsx
{categoryColumn && onCategoryFilterChange && (
  <div className="mt-0.5 flex items-center justify-center gap-1">
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="筛选分类"
          className={cn(
            'rounded p-0.5 transition-colors hover:bg-muted',
            categoryFilter && categoryFilter.length > 0 ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          <Filter className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-48 p-2">
        <div className="space-y-1">
          {nodes.map((n) => (
            <label key={n.code} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[13px] hover:bg-muted/60">
              <Checkbox
                checked={categoryFilter ? categoryFilter.includes(n.code) : true}
                onCheckedChange={() => {
                  const cur = categoryFilter ?? nodes.map((x) => x.code)
                  const next = cur.includes(n.code) ? cur.filter((c) => c !== n.code) : [...cur, n.code]
                  onCategoryFilterChange(next.length === nodes.length ? null : next)
                }}
              />
              <span className="truncate">{n.name}</span>
            </label>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-1.5">
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onCategoryFilterChange(null)}>
            全选
          </button>
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onCategoryFilterChange([])}>
            清空
          </button>
        </div>
      </PopoverContent>
    </Popover>
  </div>
)}
```

（分类 th 内改为上下两行：文字「分类」+ 筛选按钮；th 已有 `sticky left-0` 与 `text-center`，内层用 flex-col 排列。）

修正分类 th 内容为：

```tsx
{categoryColumn && onCategoryFilterChange ? (
  <div className="flex flex-col items-center gap-0.5">
    <span>分类</span>
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="筛选分类"
          className={cn(
            'rounded p-0.5 transition-colors hover:bg-muted',
            categoryFilter && categoryFilter.length > 0 ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          <Filter className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="w-48 p-2">
        <div className="space-y-1">
          {nodes.map((n) => (
            <label key={n.code} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-[13px] hover:bg-muted/60">
              <Checkbox
                checked={categoryFilter ? categoryFilter.includes(n.code) : true}
                onCheckedChange={() => {
                  const cur = categoryFilter ?? nodes.map((x) => x.code)
                  const next = cur.includes(n.code) ? cur.filter((c) => c !== n.code) : [...cur, n.code]
                  onCategoryFilterChange(next.length === nodes.length ? null : next)
                }}
              />
              <span className="truncate">{n.name}</span>
            </label>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-1.5">
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onCategoryFilterChange(null)}>
            全选
          </button>
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onCategoryFilterChange([])}>
            清空
          </button>
        </div>
      </PopoverContent>
    </Popover>
  </div>
) : (
  <span>分类</span>
)}
```

- [ ] **Step 3: 页面接线（分类过滤 → 排序）**

`web/src/pages/indicators/index.tsx`：

```ts
// store 读取：
  const categoryFilter = usePageStore((s) => s.indicators.categoryFilter)
  const setCategoryFilter = useCallback((codes: string[] | null) => setIndicators({ categoryFilter: codes }), [setIndicators])

// 过滤链：visibleTree（科目关键字）→ categoryFilteredTree（分类）→ sortedTree（排序）
  const categoryFilteredTree = useMemo(
    () => filterByCategories(visibleTree, categoryFilter),
    [visibleTree, categoryFilter],
  )
```

`sortedTree` 的 useMemo 依赖从 `visibleTree` 改为 `categoryFilteredTree`（见 Task 5 Step 3 注释）。`MetricTree` 传参追加：

```tsx
        categoryFilter={categoryFilter}
        onCategoryFilterChange={setCategoryFilter}
```

- [ ] **Step 4: 编译 + 手动验证**

Run: `cd web && npx tsc --noEmit && npx oxlint src`
Expected: 无错误

手动验证：取消勾选某分类 → 该分类整组消失；刷新保持；「全选/清空」行为正确；分类筛选与科目搜索、排序叠加工作。

- [ ] **Step 5: 提交**

```bash
git add web/src/components/subject-tree/metric-tree.tsx web/src/stores/pageStateStore.ts web/src/pages/indicators/index.tsx
git commit -m "feat: 指标表分类列筛选（level0 大类过滤，持久化）"
```

---

### Task 7: 密度切换 + 列设置工具栏（交互层）

**Files:**
- Modify: `web/src/components/subject-tree/metric-tree.tsx`
- Modify: `web/src/stores/pageStateStore.ts`
- Modify: `web/src/pages/indicators/index.tsx`

- [ ] **Step 1: store 增加密度与列设置状态**

`IndicatorsState` 追加：

```ts
  /** 表格密度三档（对齐 DataTable 命名） */
  density: 'default' | 'dense' | 'compact'
  /** 隐藏的值列 key 列表（默认全部显示） */
  hiddenColumns: string[]
```

`defaultIndicators` 追加：`density: 'default'`、`hiddenColumns: []`。

- [ ] **Step 2: MetricTree 支持密度与列显隐**

`MetricTreeProps` 追加：

```ts
  /** 表格密度（对齐 DataTable 三档；缺省 default） */
  density?: 'default' | 'dense' | 'compact'
  /** 隐藏的值列 key 列表 */
  hiddenColumns?: string[]
```

组件内：

```ts
// 密度 → 数据行纵向内边距
const ROW_PAD: Record<string, string> = {
  default: 'py-2',
  dense: 'py-1.5',
  compact: 'py-1',
}
```

- 值列集合：`const valueCols = (isOperating ? OPERATING_COLUMNS : STATIC_COLUMNS).filter((c) => !hiddenColumns?.includes(c.key))`
- 经营分组表头按可见列过滤：`OPERATING_GROUPS.map((g) => ({ ...g, keys: g.keys.filter((k) => !hiddenColumns?.includes(k)) })).filter((g) => g.keys.length > 0)`
- 数据行单元格类：`py-2` 替换为 `ROW_PAD[density ?? 'default']`（`renderValueCells` 增加 `rowPad` 参数）
- 列显隐不隐藏分类/科目列；表头 sticky 组名行 colSpan 按过滤后 keys 长度计算

- [ ] **Step 3: 页面工具栏（密度/列设置下拉）**

`web/src/pages/indicators/index.tsx` 在 Card 内、MetricTree 上方插入工具栏：

```tsx
{/* 表格工具栏：密度切换 + 列设置（状态持久化） */}
<div className="flex items-center justify-end gap-2 border-b border-border/60 px-4 py-2">
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="fused" size="sm" className="h-7 gap-1 text-xs">
        <Rows3 className="h-3.5 w-3.5" /> 密度
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-32">
      {(
        [
          ['default', '标准'],
          ['dense', '紧凑'],
          ['compact', '极简'],
        ] as const
      ).map(([v, label]) => (
        <DropdownMenuItem key={v} onClick={() => setDensity(v)}>
          <span className="flex-1">{label}</span>
          {density === v && <Check className="h-3.5 w-3.5 text-primary" />}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="fused" size="sm" className="h-7 gap-1 text-xs">
        <Columns3 className="h-3.5 w-3.5" /> 列设置
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-44">
      {(isOperating ? OPERATING_COLUMN_META : STATIC_COLUMN_META).map((col) => (
        <label key={col.key} className="flex cursor-pointer items-center gap-2 px-2 py-1 text-[13px] hover:bg-muted/60">
          <Checkbox
            checked={!hiddenColumns.includes(col.key)}
            onCheckedChange={(checked) => {
              const next = checked
                ? hiddenColumns.filter((k) => k !== col.key)
                : [...hiddenColumns, col.key]
              setHiddenColumns(next)
            }}
          />
          <span>{col.header}</span>
        </label>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
</div>
```

页面侧新增（**复用 metric-tree 导出的列配置，不重复定义**）：

```ts
import { OPERATING_COLUMNS, STATIC_COLUMNS } from '@/components/subject-tree/metric-tree'
// 列设置面板用：{ key, header } 二元组（忽略 kind/minWidth/primary 等渲染配置）
const OPERATING_COLUMN_META = OPERATING_COLUMNS.map((c) => ({ key: c.key, header: c.header }))
const STATIC_COLUMN_META = STATIC_COLUMNS.map((c) => ({ key: c.key, header: c.header }))
```

store 读取/写入：

```ts
  const density = usePageStore((s) => s.indicators.density)
  const hiddenColumns = usePageStore((s) => s.indicators.hiddenColumns)
  const setDensity = useCallback((v: 'default' | 'dense' | 'compact') => setIndicators({ density: v }), [setIndicators])
  const setHiddenColumns = useCallback((cols: string[]) => setIndicators({ hiddenColumns: cols }), [setIndicators])
```

`MetricTree` 传参追加 `density={density}`、`hiddenColumns={hiddenColumns}`。

- [ ] **Step 4: 编译 + 手动验证**

Run: `cd web && npx tsc --noEmit && npx oxlint src`
Expected: 无错误

手动验证：密度三档切换生效且刷新保持；列设置勾选隐藏列后表头（含分组 colSpan）与数据行同步消失，隐藏列不参与排序；经营/静态两页各自独立生效。

- [ ] **Step 5: 提交**

```bash
git add web/src/components/subject-tree/metric-tree.tsx web/src/stores/pageStateStore.ts web/src/pages/indicators/index.tsx
git commit -m "feat: 指标表密度切换与列设置（持久化）"
```

---

### Task 8: 导出列顺序同步 + 导出反馈 + 全量回归

**Files:**
- Modify: `web/src/pages/indicators/index.tsx`

- [ ] **Step 1: 导出列顺序同步（达成率移至累计组尾）**

`handleExport` 经营分支 columns 顺序改为：

```ts
        columns: [
          { header: '科目', key: 'account', width: 40 },
          { header: '预算金额(万)', key: 'budget', width: 14 },
          { header: '本月实际(万)', key: 'actual', width: 14 },
          { header: '同期实际(万)', key: 'samePeriod', width: 14 },
          { header: '同比', key: 'yoy', width: 10 },
          { header: '本年累计(万)', key: 'ytd', width: 14 },
          { header: '同期累计(万)', key: 'samePeriodYtd', width: 14 },
          { header: '累计同比', key: 'ytdYoy', width: 10 },
          { header: '达成率', key: 'achievement', width: 10 },
        ],
```

（rows 构造按同顺序：`budget, actual, samePeriod, yoy, ytd, samePeriodYtd, ytdYoy, achievement`；`account` 放首。）

- [ ] **Step 2: 导出跳过隐藏列 + loading 反馈**

```ts
  // 导出中状态（按钮 loading 反馈）
  const [exporting, setExporting] = useState(false)
  // 导出结果提示（内联提示条，沿用项目既有模式）
  const [exportMsg, setExportMsg] = useState<string | null>(null)

  const handleExport = async () => {
    if (exporting) return
    setExporting(true)
    setExportMsg(null)
    try {
      // ...现有导出逻辑，但 rows 构造时跳过 hiddenColumns 包含的列（仅在列设置阶段后生效）
      await exportToExcel({ ... })
      setExportMsg(`已导出：${filename}`)
    } finally {
      setExporting(false)
    }
  }
```

（导出跳过隐藏列：按 `hiddenColumns` 过滤 columns 数组与对应 rows 字段，与表格列设置一致；导出列顺序为 spec §3.1 新顺序。）

导出按钮（两处：更多操作下拉 + 大屏独立按钮）增加 `disabled={isLoading || activeItems.length === 0 || exporting}`，loading 时图标替换：

```tsx
{exporting ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
{exporting ? '导出中…' : '导出 Excel'}
```

内联提示条放在 `excludeReclassify` 提示条之后：

```tsx
      {exportMsg && (
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/[0.08] px-4 py-2 text-sm text-success-strong">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          {exportMsg}
        </div>
      )}
```

- [ ] **Step 3: 全量回归**

Run: `cd web && npx vitest run`
Expected: 全部 PASS（原 171+ 用例 + 新增 rate-bar/metric-sort/metric-filter 用例）

Run: `cd web && npx tsc --noEmit`
Expected: 无错误

Run: `cd web && npx oxlint src`
Expected: 无告警

- [ ] **Step 4: 手动冒烟**

浏览器打开财务指标页，验证：经营/静态两页渲染正常；分组表头/达成率进度条/排序/分类筛选/密度/列设置/导出（列顺序与表格一致、按钮 loading、成功提示）全链路可用；刷新后状态保持。

- [ ] **Step 5: 提交**

```bash
git add web/src/pages/indicators/index.tsx
git commit -m "feat: 指标导出列顺序同步与导出反馈（loading+成功提示）"
```

---

## 验收对照（spec §5）

| spec 验收项 | 对应任务 |
|---|---|
| 两级分组表头，达成率位于本年累计组尾且为累计达成率口径 | Task 4 |
| 达成率单元格为主题色进度条 + 条上方百分比；无预算空条；超 100% 截断 | Task 1 + Task 4 |
| 数值列头三态排序且树形层级不被破坏；分类列大类筛选 | Task 2 + Task 5 + Task 6 |
| 密度切换/列设置生效并刷新保持 | Task 7 |
| 导出列顺序与表格一致；导出过程按钮 loading | Task 8 |
| 静态指标排序/密度/列设置可用；无分组表头与进度条 | Task 4/5/7 的静态分支 |
| 回归命令全绿 | Task 8 Step 3 |

## 假设与边界

- 预算金额归「本月实际」组（预算执行对比语境），达成率归「本年累计」组（累计达成率口径）——已与用户确认
- 排序/筛选/密度/列设置状态持久化到 `pageStateStore.indicators`（与 `expandedCodes` 同机制，`mergePersisted` 自动补默认值）
- 隐藏列不参与排序与导出；分类/科目列恒显
- rowSpan=2 sticky 左列表头若在 Chromium 滚动时异常，降级为表头左列非 sticky（Task 4 Step 4 验证后决定）
