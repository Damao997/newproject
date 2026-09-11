# 指标科目树体系重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理指标科目树体系死代码，拆分超大组件/页面为可独立测试的模块，行为完全不变。

**Architecture:** 三层渐进式重构：(1) Phase 1 删除仅测试引用的 mock 装饰链路；(2) Phase 2/4 将纯逻辑抽为 lib 纯函数（TDD 先行）；(3) Phase 3/5 将组件内部渲染/表单/筛选栏拆为独立文件。全程行为不变，每个任务通过 typecheck + lint + test 门禁后独立提交。

**Tech Stack:** React 18 + TypeScript 5.5 + Vitest（jsdom）+ @testing-library/react

**重构铁律：**
- 所有 UI 行为（文案/样式/快捷键/状态持久化）保持不变，本次只做结构与可测试性
- 每任务提交前必须实际运行 `npm run typecheck`、`npm run lint`、`npm test` 并如实报告
- 工作目录：`d:\flies\pj3\.worktrees\refactor-indicator-tree\web`（下称 `web/`）

---

## Phase 1：mock 装饰链路清理

### Task 1.1: 删除 lib/subject-tree.ts 死代码

**背景：** `decorateTree` + mock 数据产出的 `operatingAnalysisTree/operatingAnalysisFlat/staticAnalysisTree/staticAnalysisFlat` 业务零引用（Grep 已确认仅测试引用），是"数据供给演进到后端 API"后的残留。`SUBJECT_SEGMENT_MAP` 及 `nextChildSubjectCode/nextRootSubjectCode` 被 SubjectDialog 编码预览使用，必须保留。

**Files:**
- Modify: `web/src/lib/subject-tree.ts`
- Delete: `web/src/mock/operating-analysis.ts`、`web/src/mock/static-analysis.ts`

- [ ] **Step 1: 修改 subject-tree.ts 删除装饰链路**

删除以下内容（保留 `SUBJECT_SEGMENT_MAP` 定义、`childSubjectCodeOf`、`subjectSeqOf`、`registeredSegmentsOf`、`CodePreviewSubject`、`nextChildSubjectCode`、`nextRootSubjectCode`、`FlatSubjectItem`、`buildSubjectTree`、`flattenTree`、`FlatSubjectRow`、`filterTree`、`filterTreeKeepSubtree`）：

```ts
// 删除项：
import { rawOperatingAnalysis } from '@/mock/operating-analysis'
import { rawStaticAnalysis } from '@/mock/static-analysis'
export interface RawSubjectNode { name: string; dataType: 'data' | 'calc' | 'display'; children?: RawSubjectNode[] }
function rootSubjectCodeOf(prefix: string, name: string): string { ... }
export function decorateTree(raw: RawSubjectNode[], prefix = 'OP'): SubjectNode[] { ... }
export const operatingAnalysisTree = decorateTree(rawOperatingAnalysis, 'OP')
export const operatingAnalysisFlat = flattenTree(operatingAnalysisTree)
export const staticAnalysisTree = decorateTree(rawStaticAnalysis, 'ST')
export const staticAnalysisFlat = flattenTree(staticAnalysisTree)
```

同时删除 `SUBJECT_SEGMENT_MAP` 中 `rootSubjectCodeOf` 报错文案注释里的"未登记段位抛错"描述（仅注释）。

- [ ] **Step 2: 删除两个 mock 文件**

用 DeleteFile 删除 `web/src/mock/operating-analysis.ts`、`web/src/mock/static-analysis.ts`。

- [ ] **Step 3: 重写 subject-tree.test.ts**

替换整个测试文件（原 186 行，删装饰相关、补 buildSubjectTree/next* 测试）。核心样本数据改为手工构造 `SubjectNode[]`：

```ts
import { describe, it, expect } from 'vitest'
import {
  buildSubjectTree,
  flattenTree,
  filterTree,
  filterTreeKeepSubtree,
  nextChildSubjectCode,
  nextRootSubjectCode,
  type FlatSubjectItem,
} from '@/lib/subject-tree'
import type { SubjectNode } from '@/types'

const sampleTree: SubjectNode[] = [
  {
    code: 'OP_02', name: '收入', level: 0, category: '收入', dataType: 'calc', children: [
      { code: 'OP_0201', name: '壹品慧收入', level: 1, category: '收入', dataType: 'calc', children: [
        { code: 'OP_020101', name: '灶具收入', level: 2, category: '收入', dataType: 'data' },
      ]},
    ],
  },
  { code: 'OP_06', name: '经营指标', level: 0, category: '经营指标', dataType: 'display', children: [] },
]

const sampleFlat: FlatSubjectItem[] = [
  { code: 'OP_02', name: '收入', level: 0, parentCode: null, category: '收入', dataType: 'calc' },
  { code: 'OP_0201', name: '壹品慧收入', level: 1, parentCode: 'OP_02', category: '收入', dataType: 'calc' },
  { code: 'OP_020101', name: '灶具收入', level: 2, parentCode: 'OP_0201', category: '收入', dataType: 'data' },
  { code: 'OP_06', name: '经营指标', level: 0, parentCode: null, category: '经营指标', dataType: 'display' },
]

describe('buildSubjectTree', () => {
  it('按 parentCode 构树，根为 parentCode 为空者', () => {
    const tree = buildSubjectTree(sampleFlat)
    expect(tree.map((n) => n.code)).toEqual(['OP_02', 'OP_06'])
    expect(tree[0].children[0].code).toBe('OP_0201')
    expect(tree[0].children[0].children[0].code).toBe('OP_020101')
  })

  it('parentCode 缺失的节点提升为根（容错）', () => {
    const flat: FlatSubjectItem[] = [
      { code: 'A', name: '孤儿', level: 1, parentCode: 'NOPE', category: 'x', dataType: 'data' },
    ]
    const tree = buildSubjectTree(flat)
    expect(tree).toHaveLength(1)
    expect(tree[0].code).toBe('A')
  })
})

describe('flattenTree', () => {
  it('前序遍历并带深度', () => {
    const rows = flattenTree(sampleTree)
    expect(rows.map((r) => r.node.name)).toEqual(['收入', '壹品慧收入', '灶具收入', '经营指标'])
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 0])
  })
})

describe('filterTree', () => {
  it('命中节点并保留祖先链', () => {
    const result = filterTree(sampleTree, '灶具')
    expect(result).toHaveLength(1)
    expect(result[0].children[0].children[0].name).toBe('灶具收入')
  })

  it('可按编码过滤', () => {
    const result = filterTree(sampleTree, 'OP_06')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('经营指标')
  })

  it('空关键字返回原树', () => {
    expect(filterTree(sampleTree, '  ')).toBe(sampleTree)
  })
})

describe('filterTreeKeepSubtree', () => {
  it('命中父节点保留整棵子树', () => {
    const result = filterTreeKeepSubtree(sampleTree, '壹品慧收入')
    expect(result[0].children[0].children.map((c) => c.name)).toEqual(['灶具收入'])
  })

  it('命中叶子仅保留祖先链', () => {
    const result = filterTreeKeepSubtree(sampleTree, '灶具')
    expect(result[0].children[0].children.map((c) => c.name)).toEqual(['灶具收入'])
  })

  it('可按编码过滤且大小写不敏感', () => {
    const result = filterTreeKeepSubtree(sampleTree, 'op_06')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('经营指标')
  })

  it('空关键字返回原树（不复制）', () => {
    expect(filterTreeKeepSubtree(sampleTree, '  ')).toBe(sampleTree)
  })
})

describe('nextChildSubjectCode', () => {
  it('父码 + 同级最大序号 + 1', () => {
    expect(nextChildSubjectCode('OP_02', sampleFlat)).toBe('OP_0202')
  })

  it('同级无子级时从 01 开始', () => {
    expect(nextChildSubjectCode('OP_06', sampleFlat)).toBe('OP_0601')
  })

  it('序号超 99 返回 null', () => {
    const over: FlatSubjectItem[] = [...sampleFlat, { code: 'OP_0299', name: 'x', level: 2, parentCode: 'OP_02', category: '收入', dataType: 'data' }]
    expect(nextChildSubjectCode('OP_02', over)).toBeNull()
  })
})

describe('nextRootSubjectCode', () => {
  it('名称命中段位表返回登记段位', () => {
    expect(nextRootSubjectCode('OP', '回款', sampleFlat)).toEqual({ code: 'OP_01', registered: true })
  })

  it('未命中自动分配该类型下一未用段位', () => {
    expect(nextRootSubjectCode('OP', '新分类', sampleFlat)).toEqual({ code: 'OP_09', registered: false })
  })

  it('静态前缀段位区间独立（经营不占用静态段位）', () => {
    expect(nextRootSubjectCode('ST', '新静态分类', sampleFlat)).toEqual({ code: 'ST_45', registered: false })
  })
})
```

- [ ] **Step 4: 验证**

```bash
cd d:\flies\pj3\.worktrees\refactor-indicator-tree\web
npm run typecheck
npm run lint
npx vitest run src/lib/__tests__/subject-tree.test.ts
```

预期：typecheck 无错、lint 无错、subject-tree 测试全部通过（新增约 11 个用例，原 20 个中装饰相关约 10 个删除）。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "refactor: 删除科目树 mock 装饰链路死代码（decorateTree/mock 数据仅测试引用）"
```

---

## Phase 2：指标页纯逻辑 lib 化（TDD）

### Task 2.1: 抽取 lib/indicator-adapt.ts

**背景：** `pages/indicators/index.tsx` 的 `adapt`（Row→树+值 Map）与 `flattenForExport` 是纯逻辑，抽到 lib 并补测试。

**Files:**
- Create: `web/src/lib/indicator-adapt.ts`
- Test: `web/src/lib/__tests__/indicator-adapt.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { adaptRows, flattenRowsForExport } from '@/lib/indicator-adapt'
import type { OperatingRow, StaticRow } from '@/hooks/api-queries'

const opRow: OperatingRow = {
  code: 'OP_02', name: '收入', level: 0, category: '收入', dataType: 'calc', valueType: 'amount', isLeaf: false,
  budget: 100, actual: 50, samePeriod: 40, ytd: 500, samePeriodYtd: 400, yoy: 0.25, achievement: 0.5, ytdYoy: 0.25,
  children: [
    { code: 'OP_0201', name: '壹品慧收入', level: 1, category: '收入', dataType: 'calc', valueType: 'amount', isLeaf: true, budget: 100, actual: 50, samePeriod: 40, ytd: 500, samePeriodYtd: 400, yoy: 0.25, achievement: 0.5, ytdYoy: 0.25 },
  ],
}

const stRow: StaticRow = {
  code: 'ST_10', name: '总资产', level: 0, category: '总资产', dataType: 'data', valueType: 'amount', isLeaf: true,
  current: 800, yearStart: 700, samePeriod: 600, lastYearStart: 500, yoy: 0.3333,
}

describe('adaptRows', () => {
  it('经营行映射 budget/actual/samePeriod/ytd/samePeriodYtd', () => {
    const { map } = adaptRows([opRow], true)
    const mv = map.get('OP_02')!
    expect(mv).toEqual({ budget: 100, actual: 50, samePeriod: 40, ytd: 500, samePeriodYtd: 400 })
  })

  it('静态行映射 current→actual、yearStart→ytd、lastYearStart→samePeriodYtd', () => {
    const { map } = adaptRows([stRow], false)
    expect(map.get('ST_10')).toEqual({ budget: 700, actual: 800, samePeriod: 600, ytd: 700, samePeriodYtd: 500 })
  })

  it('嵌套 children 递归构建 SubjectNode 树（含 valueType）', () => {
    const { nodes } = adaptRows([opRow], true)
    expect(nodes).toHaveLength(1)
    expect(nodes[0].children[0].code).toBe('OP_0201')
    expect(nodes[0].valueType).toBe('amount')
    expect(nodes[0].children[0].dataType).toBe('calc')
  })

  it('空输入返回空树与空 Map', () => {
    const { nodes, map } = adaptRows([], true)
    expect(nodes).toEqual([])
    expect(map.size).toBe(0)
  })
})

describe('flattenRowsForExport', () => {
  it('前序展开并带深度', () => {
    const flat = flattenRowsForExport([opRow])
    expect(flat.map((f) => f.row.code)).toEqual(['OP_02', 'OP_0201'])
    expect(flat.map((f) => f.depth)).toEqual([0, 1])
  })

  it('无 children 时仅自身一行', () => {
    expect(flattenRowsForExport([stRow])).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run src/lib/__tests__/indicator-adapt.test.ts
```

预期：FAIL（模块不存在）。

- [ ] **Step 3: 实现 lib/indicator-adapt.ts**

```ts
import type { OperatingRow, StaticRow } from '@/hooks/api-queries'
import type { MetricValue } from '@/lib/metric-values'
import type { SubjectNode } from '@/types'

export type IndicatorRow = OperatingRow | StaticRow

/** 将后端嵌套行转为 MetricTree 需要的结构树 + 数值 Map（静态行映射到统一 MetricValue） */
export function adaptRows(items: IndicatorRow[], isOperating: boolean): { nodes: SubjectNode[]; map: Map<string, MetricValue> } {
  const map = new Map<string, MetricValue>()
  const walk = (rows: IndicatorRow[]): SubjectNode[] =>
    rows.map((r) => {
      if (isOperating) {
        const o = r as OperatingRow
        map.set(o.code, { budget: o.budget, actual: o.actual, samePeriod: o.samePeriod, ytd: o.ytd, samePeriodYtd: o.samePeriodYtd })
      } else {
        const s = r as StaticRow
        // 静态科目映射到统一 MetricValue：本期→actual、同期→samePeriod、年初→ytd、上年年初→samePeriodYtd
        map.set(s.code, { budget: s.yearStart, actual: s.current, samePeriod: s.samePeriod, ytd: s.yearStart, samePeriodYtd: s.lastYearStart })
      }
      return {
        code: r.code, name: r.name, level: r.level, category: r.category,
        dataType: r.dataType as SubjectNode['dataType'],
        valueType: r.valueType,
        children: r.children ? walk(r.children as IndicatorRow[]) : [],
      }
    })
  return { nodes: walk(items), map }
}

/** 前序展开为 {row, depth} 供导出 */
export function flattenRowsForExport(rows: IndicatorRow[], depth = 0): { row: IndicatorRow; depth: number }[] {
  const out: { row: IndicatorRow; depth: number }[] = []
  for (const r of rows) {
    out.push({ row: r, depth })
    if (r.children && r.children.length > 0) out.push(...flattenRowsForExport(r.children as IndicatorRow[], depth + 1))
  }
  return out
}
```

- [ ] **Step 4: 运行确认通过**

```bash
npx vitest run src/lib/__tests__/indicator-adapt.test.ts
```

预期：PASS（7 个用例）。

- [ ] **Step 5: 提交**

```bash
git add src/lib/indicator-adapt.ts src/lib/__tests__/indicator-adapt.test.ts
git commit -m "test: 抽取指标行适配与导出展开为 lib/indicator-adapt 纯函数并补测试"
```

### Task 2.2: 抽取 lib/indicator-export.ts

**背景：** `handleExport` 约 70 行混在页面组件中。抽为纯函数：输入原始行 + 视图配置，输出 `exportToExcel` 所需参数（文件名/表头/列/行），格式化逻辑全部可测。

**Files:**
- Create: `web/src/lib/indicator-export.ts`
- Test: `web/src/lib/__tests__/indicator-export.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { buildIndicatorExport, type ExportColumnMeta } from '@/lib/indicator-export'
import type { OperatingRow, StaticRow } from '@/hooks/api-queries'

const opColumns: ExportColumnMeta[] = [
  { key: 'budget', header: '预算金额(万)' }, { key: 'actual', header: '本月实际(万)' }, { key: 'yoy', header: '同比' },
]
const stColumns: ExportColumnMeta[] = [
  { key: 'actual', header: '本期金额(万)' }, { key: 'yoy', header: '变动率' },
]

const opRow: OperatingRow = {
  code: 'OP_02', name: '收入', level: 0, category: '收入', dataType: 'calc', valueType: 'amount', isLeaf: false,
  budget: 100, actual: 50.5, samePeriod: 40, ytd: 500, samePeriodYtd: 400, yoy: 0.25, achievement: 0.5, ytdYoy: 0.125,
}
const ratioRow: OperatingRow = {
  ...opRow, code: 'OP_06', name: '资产负债率', valueType: 'ratio', budget: 0, actual: 0.551, samePeriod: 0.5, ytd: 0.6, samePeriodYtd: 0.55, yoy: 0.1, achievement: 0, ytdYoy: 0.09,
}
const stRow: StaticRow = {
  code: 'ST_10', name: '总资产', level: 0, category: '总资产', dataType: 'data', valueType: 'quantity', isLeaf: true,
  current: 800, yearStart: 700, samePeriod: 600, lastYearStart: 500, yoy: 0.3333,
}

describe('buildIndicatorExport', () => {
  it('经营导出：列按传入配置顺序，科目缩进用全角空格', () => {
    const r = buildIndicatorExport({ isOperating: true, items: [opRow], columns: opColumns, excludeReclassify: false })
    expect(r.filename).toContain('经营指标')
    expect(r.sheetName).toBe('经营指标')
    expect(r.columns.map((c) => c.key)).toEqual(['account', 'budget', 'actual', 'yoy'])
    expect(r.rows).toEqual([{ account: '收入', budget: 100, actual: 50.5, yoy: '25.0%' }])
  })

  it('经营导出：比率值乘 100 加 %，同比按百分比字符串', () => {
    const r = buildIndicatorExport({ isOperating: true, items: [ratioRow], columns: opColumns, excludeReclassify: false })
    expect(r.rows[0].actual).toBe('55.1%')
    expect(r.rows[0].budget).toBe(0)
  })

  it('静态导出：current→本期、quantity 取整、变动率百分比', () => {
    const r = buildIndicatorExport({ isOperating: false, items: [stRow], columns: stColumns, excludeReclassify: false })
    expect(r.filename).toContain('静态指标')
    expect(r.rows).toEqual([{ account: '总资产', actual: 800, yoy: '33.3%' }])
  })

  it('隐藏列由调用方过滤（columns 传参即体现）', () => {
    const r = buildIndicatorExport({ isOperating: true, items: [opRow], columns: [opColumns[0]], excludeReclassify: false })
    expect(r.columns.map((c) => c.key)).toEqual(['account', 'budget'])
  })

  it('去重分类口径文件名追加 _原始口径', () => {
    const r = buildIndicatorExport({ isOperating: true, items: [opRow], columns: opColumns, excludeReclassify: true })
    expect(r.filename).toContain('_原始口径')
  })

  it('嵌套行按深度缩进导出', () => {
    const nested: OperatingRow = { ...opRow, children: [{ ...ratioRow, code: 'OP_0201', level: 1 }] }
    const r = buildIndicatorExport({ isOperating: true, items: [nested], columns: opColumns, excludeReclassify: false })
    expect(r.rows.map((x) => x.account)).toEqual(['收入', '　资产负债率'])
  })
})
```

- [ ] **Step 2: 运行确认失败**（同上，预期 FAIL）

- [ ] **Step 3: 实现 lib/indicator-export.ts**

```ts
import type { OperatingRow, StaticRow } from '@/hooks/api-queries'
import { flattenRowsForExport, type IndicatorRow } from '@/lib/indicator-adapt'

export interface ExportColumnMeta {
  key: string
  header: string
}

export interface IndicatorExportOptions {
  isOperating: boolean
  items: IndicatorRow[]
  /** 可见列配置（已过滤隐藏列，顺序与表格一致） */
  columns: ExportColumnMeta[]
  excludeReclassify: boolean
}

export interface BuiltExport {
  filename: string
  sheetName: string
  columns: { header: string; key: string; width: number }[]
  rows: Record<string, string | number>[]
}

/** 分型格式化：比率乘 100 加 %，数量取整，金额保持数值 */
function fmtVal(v: number, vt: string): string | number {
  if (vt === 'ratio') return `${(v * 100).toFixed(1)}%`
  if (vt === 'quantity') return Math.round(v)
  return v
}

const pct = (v: number) => `${v.toFixed(1)}%`

/** 组装财务指标 Excel 导出参数（文件名/工作表/列/行），格式化逻辑纯函数化便于测试 */
export function buildIndicatorExport({ isOperating, items, columns, excludeReclassify }: IndicatorExportOptions): BuiltExport {
  const scopeSuffix = excludeReclassify ? '_原始口径' : ''
  const flat = flattenRowsForExport(items)
  const widthOf = (k: string) => (k === 'yoy' || k === 'ytdYoy' || k === 'achievement') ? 10 : (isOperating ? 14 : 16)
  const cols: { header: string; key: string; width: number }[] = [
    { header: '科目', key: 'account', width: 40 },
    ...columns.map((c) => ({ header: c.header, key: c.key, width: widthOf(c.key) })),
  ]
  if (isOperating) {
    const rows = flat.map(({ row, depth }) => {
      const o = row as OperatingRow
      const val: Record<string, string | number> = {
        budget: fmtVal(o.budget, o.valueType), actual: fmtVal(o.actual, o.valueType), samePeriod: fmtVal(o.samePeriod, o.valueType),
        yoy: pct(o.yoy), ytd: fmtVal(o.ytd, o.valueType), samePeriodYtd: fmtVal(o.samePeriodYtd, o.valueType),
        ytdYoy: pct(o.ytdYoy), achievement: pct(o.achievement),
      }
      return { account: `${'　'.repeat(depth)}${o.name}`, ...Object.fromEntries(columns.map((c) => [c.key, val[c.key]])) }
    })
    return { filename: `财务指标_经营指标${scopeSuffix}_${new Date().toISOString().slice(0, 10)}.xlsx`, sheetName: '经营指标', columns: cols, rows }
  }
  const rows = flat.map(({ row, depth }) => {
    const s = row as StaticRow
    const val: Record<string, string | number> = {
      actual: fmtVal(s.current, s.valueType), samePeriod: fmtVal(s.samePeriod, s.valueType), yoy: pct(s.yoy),
    }
    return { account: `${'　'.repeat(depth)}${s.name}`, ...Object.fromEntries(columns.map((c) => [c.key, val[c.key]])) }
  })
  return { filename: `财务指标_静态指标${scopeSuffix}_${new Date().toISOString().slice(0, 10)}.xlsx`, sheetName: '静态指标', columns: cols, rows }
}
```

> 注意：原 index.tsx 表头映射（`预算金额(万)`/`本月实际(万)`/`同期实际(万)`/`同比`/`本年累计(万)`/`同期累计(万)`/`累计同比`/`达成率` 与静态 `本期金额(万)`/`同期金额(万)`/`变动率`）将在 Task 2.3 由调用方从 `OPERATING_COLUMNS/STATIC_COLUMNS` 派生后传入，文案保持完全一致。

- [ ] **Step 4: 运行确认通过**（预期 PASS 6 个用例）

- [ ] **Step 5: 提交**

```bash
git add src/lib/indicator-export.ts src/lib/__tests__/indicator-export.test.ts
git commit -m "test: 抽取指标导出组装逻辑为 lib/indicator-export 纯函数并补测试"
```

### Task 2.3: index.tsx 接入新 lib 并删除内联实现

**Files:**
- Modify: `web/src/pages/indicators/index.tsx`

- [ ] **Step 1: 修改导入并替换内联实现**

替换内容（三处）：

```tsx
// 1. 删除文件内 adapt 与 flattenForExport 两个函数定义（原 58-88 行附近）
// 2. 新增导入：
import { adaptRows, flattenRowsForExport } from '@/lib/indicator-adapt'
import { buildIndicatorExport, type ExportColumnMeta } from '@/lib/indicator-export'

// 3. 原 handleExport 函数体整体替换为：
const handleExport = async () => {
  if (exporting) return
  setExporting(true)
  setExportMsg(null)
  setExportErr(null)
  try {
    const headerMap: Record<string, string> = {
      budget: '预算金额(万)', actual: '本月实际(万)', samePeriod: '同期实际(万)', yoy: '同比',
      ytd: '本年累计(万)', samePeriodYtd: '同期累计(万)', ytdYoy: '累计同比', achievement: '达成率',
    }
    const staticHeaderMap: Record<string, string> = { actual: '本期金额(万)', samePeriod: '同期金额(万)', yoy: '变动率' }
    const cols = (isOperating ? OPERATING_COLUMNS : STATIC_COLUMNS)
      .filter((c) => !hiddenColumns.includes(c.key))
      .map((c) => ({ key: c.key, header: isOperating ? headerMap[c.key] : staticHeaderMap[c.key] })) as ExportColumnMeta[]
    const built = buildIndicatorExport({ isOperating, items: activeItems as Row[], columns: cols, excludeReclassify })
    await exportToExcel(built)
    setExportMsg(`已导出：${built.filename}`)
  } catch (err) {
    setExportErr(`导出失败：${err instanceof Error ? err.message : '未知错误'}`)
  } finally {
    setExporting(false)
  }
}
```

同时替换页面内其余使用点：
- `adapt(activeItems as Row[], isOperating)` → `adaptRows(activeItems as Row[], isOperating)`
- `flattenForExport(...)`（overviewOperatingRows/overviewStaticRows 两处）→ `flattenRowsForExport(...)`

- [ ] **Step 2: 验证**

```bash
npm run typecheck
npm run lint
npm test
```

预期：全部通过（含新增 indicator-adapt/indicator-export 测试；现有 215 个用例不回归）。

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "refactor: 指标页导出与数据适配改用 lib 纯函数，页面瘦身"
```

---

## Phase 3：metric-tree 拆分

### Task 3.1: 抽取 metric-columns.ts（列配置单源化）

**Files:**
- Create: `web/src/components/subject-tree/metric-columns.ts`
- Modify: `web/src/components/subject-tree/metric-tree.tsx`

- [ ] **Step 1: 创建 metric-columns.ts**

```ts
/** 指标树值列配置：单源定义列 + 分组（消除 OPERATING_GROUPS 与 OPERATING_COLUMNS 双源维护） */

export type MetricColKind = 'amount' | 'pct' | 'achievement'

export interface MetricColumn {
  key: string
  header: string
  minWidth: number
  kind: MetricColKind
  /** 主列强调（font-medium） */
  primary?: boolean
  /** 次要列降权（text-muted-foreground） */
  secondary?: boolean
  /** 经营指标分组（导出/表头分组由该字段派生） */
  group?: '本月实际' | '本年累计'
}

/** 经营指标值列（达成率归「本年累计」组尾：累计达成率 = 本年累计/全年预算） */
export const OPERATING_COLUMNS: MetricColumn[] = [
  { key: 'budget', header: '预算金额', minWidth: 112, kind: 'amount', group: '本月实际' },
  { key: 'actual', header: '本月实际', minWidth: 112, kind: 'amount', primary: true, group: '本月实际' },
  { key: 'samePeriod', header: '同期实际', minWidth: 112, kind: 'amount', secondary: true, group: '本月实际' },
  { key: 'yoy', header: '同比', minWidth: 80, kind: 'pct', group: '本月实际' },
  { key: 'ytd', header: '本年累计', minWidth: 112, kind: 'amount', primary: true, group: '本年累计' },
  { key: 'samePeriodYtd', header: '同期累计', minWidth: 112, kind: 'amount', secondary: true, group: '本年累计' },
  { key: 'ytdYoy', header: '累计同比', minWidth: 80, kind: 'pct', group: '本年累计' },
  { key: 'achievement', header: '达成率', minWidth: 152, kind: 'achievement', group: '本年累计' },
]

/** 经营指标分组表头：组名 → 明细列 keys（由列配置 group 字段派生，新增列仅改 OPERATING_COLUMNS 一处） */
export const OPERATING_GROUPS: { label: string; keys: string[] }[] = (['本月实际', '本年累计'] as const).map((label) => ({
  label,
  keys: OPERATING_COLUMNS.filter((c) => c.group === label).map((c) => c.key),
}))

/** 列 key → 列对象索引（消除表头渲染的 find 重复遍历） */
export const OPERATING_COL_BY_KEY = new Map(OPERATING_COLUMNS.map((c) => [c.key, c]))

/** 静态指标值列（单行表头，无分组） */
export const STATIC_COLUMNS: MetricColumn[] = [
  { key: 'actual', header: '本期金额', minWidth: 112, kind: 'amount', primary: true },
  { key: 'samePeriod', header: '同期金额', minWidth: 112, kind: 'amount', secondary: true },
  { key: 'yoy', header: '变动率', minWidth: 80, kind: 'pct' },
]
```

- [ ] **Step 2: metric-tree.tsx 改用新模块**

删除文件内 `MetricColKind/MetricColumn/OPERATING_COLUMNS/OPERATING_GROUPS/OPERATING_COL_BY_KEY/STATIC_COLUMNS` 定义（原 76-116 行），改为：

```ts
import { OPERATING_COLUMNS, OPERATING_GROUPS, OPERATING_COL_BY_KEY, STATIC_COLUMNS, type MetricColumn } from '@/components/subject-tree/metric-columns'
```

并删除文件顶部 `/* eslint-disable react/only-export-components ... */` 注释（该注释仅为导出列配置而加，列配置已移出）。

- [ ] **Step 3: 验证**

```bash
npm run typecheck
npm run lint
npm test
```

预期：全部通过。`OPERATING_GROUPS` 派生结果与原先硬编码一致（可加临时断言验证：`OPERATING_GROUPS[0].keys === ['budget','actual','samePeriod','yoy']`，Task 3.4 的测试将锁定）。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor: 抽取指标列配置为 metric-columns 单源模块，分组表头自动派生"
```

### Task 3.2: 抽取 metric-cell.tsx（单元格渲染器）

**Files:**
- Create: `web/src/components/subject-tree/metric-cell.tsx`
- Modify: `web/src/components/subject-tree/metric-tree.tsx`

- [ ] **Step 1: 创建 metric-cell.tsx**

```tsx
import type { ReactNode } from 'react'
import { ChevronRight, ChevronDown, MessageSquarePlus } from 'lucide-react'
import { cn, formatMetricValue, getChangeColor } from '@/lib/utils'
import { calcYoy, calcYtdYoy, calcAchievement, type MetricValue } from '@/lib/metric-values'
import type { SubjectNode } from '@/types'
import { RateBar } from '@/components/ui/rate-bar'
import type { MetricColumn } from '@/components/subject-tree/metric-columns'

/** 密度 → 数据行纵向内边距（对齐 DataTable 三档命名） */
export const ROW_PAD: Record<'default' | 'dense' | 'compact', string> = {
  default: 'py-2',
  dense: 'py-1.5',
  compact: 'py-1',
}

/** 分类列固定宽度（px）：sticky 偏移与列宽单一来源（用户要求 96px） */
export const CATEGORY_COL_WIDTH = 96

/** 涨跌彩色变化值（红涨绿跌、无箭头、等宽数字居中）：统一按相对增长率百分比显示；零值显示 '-' */
export function ChangeText({ value }: { value: number }) {
  return (
    <span className={cn('font-num', getChangeColor(value))}>
      {value === 0 ? '-' : `${(value * 100).toFixed(1)}%`}
    </span>
  )
}

/** 数值单元格：按列配置渲染（金额/数量/比率分型格式化；同比红涨绿跌；达成率进度条 + 条内居中的百分比） */
export function renderValueCells(
  mv: MetricValue | undefined,
  columns: MetricColumn[],
  valueType?: SubjectNode['valueType'],
  rowPad = ROW_PAD.default,
) {
  const fmt = (v: number) => formatMetricValue(v, valueType)
  const yoyOf = (key: string, value: MetricValue) => (key === 'ytdYoy' ? calcYtdYoy(value) : calcYoy(value))
  return columns.map((col) => {
    const cellBase = cn(
      'whitespace-nowrap border-b px-3 align-middle text-center font-num',
      rowPad,
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

/** 科目名称单元格：缩进 + 展开折叠箭头 + 名称 + 悬停浮现分析图标；sticky 锁定首列（横向滚动时保持科目上下文） */
export function SubjectCell({
  node,
  indentDepth,
  expandedCodes,
  onToggle,
  stickyLeftPx = 0,
  onAnalyze,
  analyzeDisabled,
  analyzeHint,
  rowPad = ROW_PAD.default,
}: {
  node: SubjectNode
  indentDepth: number
  expandedCodes: Set<string>
  onToggle: (code: string) => void
  /** sticky 左偏移（px）：分类列存在时传 CATEGORY_COL_WIDTH，普通布局 0 */
  stickyLeftPx?: number
  onAnalyze?: (node: SubjectNode) => void
  analyzeDisabled?: boolean
  analyzeHint?: string
  /** 数据行纵向内边距（对齐密度三档；缺省 py-2） */
  rowPad?: string
}) {
  const hasChildren = node.children.length > 0
  const isExpanded = expandedCodes.has(node.code)
  return (
    <td
      className={cn(
        'sticky z-[1] min-w-[160px] border-b border-r bg-background px-4 align-middle shadow-[8px_0_12px_-8px_rgba(0,0,0,0.3)] transition-colors group-hover:bg-muted',
        rowPad,
      )}
      style={{ left: stickyLeftPx }}
    >
      <div className="relative flex items-center" style={{ paddingLeft: indentDepth * 20 }}>
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.code)}
            className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={isExpanded ? '折叠' : '展开'}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : (
          <span className="mr-1 inline-block h-5 w-5 shrink-0" />
        )}
        <span className={cn(indentDepth === 0 && 'font-semibold', 'relative whitespace-nowrap text-foreground')}>
          {node.name}
          {/* 分析入口：行悬停/键盘聚焦时在科目名右侧浮现；absolute 锚定名称右缘（不随列宽/缩进漂移），且不占列宽 */}
          {onAnalyze && (
            <button
              type="button"
              onClick={() => onAnalyze(node)}
              disabled={analyzeDisabled}
              title={analyzeDisabled ? analyzeHint : '撰写单项分析'}
              aria-label="撰写单项分析"
              className={cn(
                'absolute -right-6 top-1/2 -translate-y-1/2 rounded p-0.5 text-primary opacity-0 transition-opacity hover:bg-primary/10 focus-visible:opacity-100 group-hover:opacity-100',
                analyzeDisabled && 'cursor-not-allowed opacity-0 hover:bg-transparent group-hover:opacity-40',
              )}
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </div>
    </td>
  )
}
```

> 注：上方案例中 import 语句需合并到文件顶部（`calcAchievement` 并入第 7 行 import），不要保留中间 import。

- [ ] **Step 2: metric-tree.tsx 改用新模块**

删除 `ChangeText`、`CATEGORY_COL_WIDTH`、`ROW_PAD`、`renderValueCells`、`SubjectCell` 五个定义（原 54-223 行），改为：

```ts
import { CATEGORY_COL_WIDTH, ROW_PAD, SubjectCell, renderValueCells, type ChangeText } from '@/components/subject-tree/metric-cell'
```

删除不再使用的导入：`formatMetricValue`、`getChangeColor`（utils）、`calcYoy/calcYtdYoy`（metric-values，`MetricValue` 类型仍用于 Props）、`RateBar`、`MessageSquarePlus`、`ChevronRight/ChevronDown`（行渲染移走后不再用）。保留 `cn`、`TABLE_HEAD_BASE`、`Popover/PopoverContent/PopoverTrigger`、`Checkbox`、`Filter`、`ArrowUp/ArrowDown/ArrowUpDown`、`Fragment/useState/ReactNode`、`SortDirection`、`MetricValue` 类型。

> 提示：若 `ReactNode`/`useState` 不再使用则一并删除（以 typecheck 报错为准，逐项清理，禁止留 unused import）。

- [ ] **Step 3: 验证**

```bash
npm run typecheck
npm run lint
npm test
```

预期：全部通过（组件行为未变，仍无组件测试——Task 3.4 补齐）。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor: 抽取指标树单元格渲染为 metric-cell 模块"
```

### Task 3.3: 补 metric-tree 组件测试

**Files:**
- Test: `web/src/components/subject-tree/__tests__/metric-tree.test.tsx`

- [ ] **Step 1: 写测试**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MetricTree } from '@/components/subject-tree/metric-tree'
import { OPERATING_COLUMNS, OPERATING_GROUPS, STATIC_COLUMNS } from '@/components/subject-tree/metric-columns'
import type { SubjectNode } from '@/types'

const tree: SubjectNode[] = [
  {
    code: 'OP_02', name: '收入', level: 0, category: '收入', dataType: 'calc', valueType: 'amount', children: [
      { code: 'OP_0201', name: '灶具收入', level: 1, category: '收入', dataType: 'data', valueType: 'amount', children: [] },
      { code: 'OP_0202', name: '热水器收入', level: 1, category: '收入', dataType: 'data', valueType: 'ratio', children: [] },
    ],
  },
  { code: 'OP_06', name: '经营指标', level: 0, category: '经营指标', dataType: 'display', children: [] },
]

const valueMap = new Map<string, { budget: number; actual: number; samePeriod: number; ytd: number; samePeriodYtd: number }>([
  ['OP_02', { budget: 100, actual: 50, samePeriod: 40, ytd: 500, samePeriodYtd: 400 }],
  ['OP_0201', { budget: 60, actual: 30, samePeriod: 25, ytd: 300, samePeriodYtd: 250 }],
  ['OP_0202', { budget: 40, actual: 0.55, samePeriod: 0.5, ytd: 0.6, samePeriodYtd: 0.55 }],
])

function renderOperating(overrides: Partial<Parameters<typeof MetricTree>[0]> = {}) {
  return render(
    <MetricTree
      nodes={tree}
      valueMap={valueMap as never}
      variant="operating"
      expandedCodes={new Set(['OP_02'])}
      onToggle={() => {}}
      categoryColumn
      {...overrides}
    />,
  )
}

describe('metric-columns 配置一致性', () => {
  it('OPERATING_GROUPS 覆盖全部经营列且顺序正确', () => {
    const all = OPERATING_GROUPS.flatMap((g) => g.keys)
    expect(all).toEqual(OPERATING_COLUMNS.map((c) => c.key))
    expect(OPERATING_GROUPS[0]).toEqual({ label: '本月实际', keys: ['budget', 'actual', 'samePeriod', 'yoy'] })
    expect(OPERATING_GROUPS[1]).toEqual({ label: '本年累计', keys: ['ytd', 'samePeriodYtd', 'ytdYoy', 'achievement'] })
  })

  it('静态列配置含本期/同期/变动率', () => {
    expect(STATIC_COLUMNS.map((c) => c.key)).toEqual(['actual', 'samePeriod', 'yoy'])
  })
})

describe('MetricTree 经营指标渲染', () => {
  it('渲染分组表头与科目树', () => {
    renderOperating()
    expect(screen.getByText('本月实际')).toBeInTheDocument()
    expect(screen.getByText('本年累计')).toBeInTheDocument()
    expect(screen.getByText('收入')).toBeInTheDocument()
    expect(screen.getByText('灶具收入')).toBeInTheDocument()
  })

  it('分类列渲染 level0 名称（跨行）', () => {
    renderOperating()
    expect(screen.getByText('收入')).toBeInTheDocument()
  })

  it('比率科目值按分型格式化（55.1% 千分位两小数 → 0.551 转 55.1%）', () => {
    renderOperating({ expandedCodes: new Set(['OP_02']) })
    const row = screen.getByText('热水器收入').closest('tr')!
    expect(within(row).getByText('55.1%')).toBeInTheDocument()
  })

  it('排序点击触发 onSortChange 三态循环', () => {
    const onSortChange = vi.fn()
    renderOperating({ onSortChange, sortKey: null, sortDirection: null })
    fireEvent.click(screen.getByRole('button', { name: '按本月实际排序' }))
    expect(onSortChange).toHaveBeenCalledWith('actual', 'asc')
  })

  it('隐藏列不渲染表头与数据', () => {
    renderOperating({ hiddenColumns: ['yoy', 'achievement'] })
    expect(screen.queryByText('同比')).not.toBeInTheDocument()
    expect(screen.queryByText('达成率')).not.toBeInTheDocument()
  })
})
```

> 注：`valueMap as never` 仅为类型简化；MetricTree 的 valueMap 类型为 `Map<string, MetricValue>`，测试数据满足字段子集（budget/actual/samePeriod/ytd/samePeriodYtd），若 tsconfig strict 报错则改为完整构造 `MetricValue`（含 yoy/achievement/ytdYoy 可选字段的按需补全）。

- [ ] **Step 2: 运行确认失败**

```bash
npx vitest run src/components/subject-tree/__tests__/metric-tree.test.tsx
```

预期：FAIL（测试文件不存在）。

- [ ] **Step 3: 运行确认通过**

```bash
npx vitest run src/components/subject-tree/__tests__/metric-tree.test.tsx
```

预期：PASS。若 `55.1%` 断言因 `formatMetricValue` 实现差异失败，以实际格式修正断言（行为不变原则：测试跟随现有实现，不反过来改实现）。

- [ ] **Step 4: 验证全量并提交**

```bash
npm run typecheck
npm run lint
npm test
git add -A
git commit -m "test: 补指标树组件测试（列配置一致性/分型渲染/排序/列隐藏）"
```

---

## Phase 4：subject-dialog 表单抽离

### Task 4.1: 抽取 lib/subject-form.ts 纯函数

**Files:**
- Create: `web/src/lib/subject-form.ts`
- Test: `web/src/lib/__tests__/subject-form.test.ts`
- Modify: `web/src/components/subject-tree/subject-dialog.tsx`

- [ ] **Step 1: 写失败测试**

```ts
import { describe, it, expect } from 'vitest'
import { inferValueType, deriveRootCategory } from '@/lib/subject-form'

describe('inferValueType', () => {
  it('含率/占比 → ratio', () => {
    expect(inferValueType('资产负债率')).toBe('ratio')
    expect(inferValueType('回款占比')).toBe('ratio')
  })

  it('含户数/天数/人数 → quantity', () => {
    expect(inferValueType('用户户数')).toBe('quantity')
    expect(inferValueType('回款天数')).toBe('quantity')
    expect(inferValueType('员工人数')).toBe('quantity')
  })

  it('其余 → amount', () => {
    expect(inferValueType('灶具收入')).toBe('amount')
    expect(inferValueType('')).toBe('amount')
  })
})

describe('deriveRootCategory', () => {
  const flat = [
    { code: 'OP_02', parentCode: null },
    { code: 'OP_0201', parentCode: 'OP_02' },
    { code: 'OP_020101', parentCode: 'OP_0201' },
  ]

  it('向上回溯到 level0 根名', () => {
    expect(deriveRootCategory(flat, 'OP_020101', '灶具收入')).toBe('收入')
  })

  it('无上级时用自身名', () => {
    expect(deriveRootCategory(flat, null, '新根')).toBe('新根')
  })

  it('上级链断裂时回退自身名（容错）', () => {
    expect(deriveRootCategory(flat, 'OP_9999', '孤儿')).toBe('孤儿')
  })
})
```

- [ ] **Step 2: 运行确认失败**（预期 FAIL 模块不存在）

- [ ] **Step 3: 实现 lib/subject-form.ts**

```ts
/** 科目表单纯逻辑：值类型推断与类别推导（可独立测试，不依赖组件状态） */

export type SubjectValueType = 'amount' | 'quantity' | 'ratio'
export type SubjectDataType = 'data' | 'calc' | 'display'

/** 按科目名称推断值类型（与后端 seed 打标规则一致），仅作新建时的默认建议 */
export function inferValueType(name: string): SubjectValueType {
  if (/率|占比/.test(name)) return 'ratio'
  if (/户数|天数|（户）|\(户\)|人数/.test(name)) return 'quantity'
  return 'amount'
}

/** 向上追溯到 level0 根，返回根名作为 category（成为根时用自身名；链条断裂回退自身名） */
export function deriveRootCategory(
  flat: { code: string; parentCode: string | null }[],
  parentCode: string | null,
  selfName: string,
): string {
  if (!parentCode) return selfName
  let cur = flat.find((f) => f.code === parentCode)
  let guard = 0
  while (cur && cur.parentCode && guard < 50) {
    cur = flat.find((f) => f.code === cur?.parentCode)
    guard++
  }
  return cur?.name ?? selfName
}
```

> 注意：`deriveRootCategory` 原实现返回 `cur?.name`（FlatSubjectItem.name），抽离时签名改为接收扁平结构；SubjectTreeItem 含 name 字段，兼容。调用处传 `flat`（SubjectTreeItem[]，含 name）。

- [ ] **Step 4: 运行确认通过**（预期 PASS 8 个用例）

- [ ] **Step 5: subject-dialog.tsx 改用纯函数并删除内联实现**

```tsx
// 删除文件内 inferValueType 与 deriveRootCategory 定义（原 37-42、98-108 行），改为：
import { inferValueType, deriveRootCategory, type SubjectDataType, type SubjectValueType } from '@/lib/subject-form'
// 同时删除文件内 type SubjectValueType/SubjectDataType 定义（原 34-35 行）
```

- [ ] **Step 6: 验证并提交**

```bash
npm run typecheck
npm run lint
npm test
git add -A
git commit -m "refactor: 科目弹窗值类型推断与类别推导抽为 lib/subject-form 纯函数并补测试"
```

### Task 4.2: 抽取 use-subject-form hook

**Files:**
- Create: `web/src/hooks/use-subject-form.ts`
- Modify: `web/src/components/subject-tree/subject-dialog.tsx`

- [ ] **Step 1: 实现 use-subject-form.ts**

从 subject-dialog.tsx 迁移全部表单状态与提交编排（状态：code/name/category/parentCode/isLeaf/valueType/valueTypeTouched/dataType/calcFormula/typeHint/error；动作：handleNameChange/handleParentChange/handleTypeChange/submit；派生：previewSubjects/generatedCode/parentChanged/pending）：

```ts
import { useEffect, useMemo, useState } from 'react'
import { nextChildSubjectCode, nextRootSubjectCode, type CodePreviewSubject } from '@/lib/subject-tree'
import { deriveRootCategory, inferValueType, type SubjectDataType, type SubjectValueType } from '@/lib/subject-form'
import { useCreateSubject, useUpdateSubject, useReclassifySubject, useConvertMetric, useMetrics, type SubjectTreeItem } from '@/hooks/api-queries'
import { useConfirm } from '@/components/ui/confirm-dialog'
import type { Metric } from '@/types'

export interface SubjectFormOptions {
  open: boolean
  mode: 'create' | 'edit'
  type: 'operating' | 'static'
  subject?: SubjectTreeItem | null
  flat: SubjectTreeItem[]
  allSubjects?: CodePreviewSubject[]
  canConvert?: boolean
  onClose: () => void
}

/** 科目新增/编辑弹窗表单：状态 + 派生 + 提交编排（创建/类型转换/重分类/更新四分支） */
export function useSubjectForm({ open, mode, type, subject, flat, allSubjects, canConvert = false, onClose }: SubjectFormOptions) {
  const createSubject = useCreateSubject()
  const updateSubject = useUpdateSubject()
  const reclassifySubject = useReclassifySubject()
  const convertMetric = useConvertMetric()
  const { confirm, element: confirmElement } = useConfirm()
  // 全量指标：按科目编码取 metric（类型转换按 metric.id 提交）
  const { data: metricsData } = useMetrics({ pageSize: 1000 })
  const metricByCode = useMemo(() => {
    const m = new Map<string, Metric>()
    for (const item of metricsData?.items ?? []) m.set(item.code, item)
    return m
  }, [metricsData])

  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [parentCode, setParentCode] = useState<string>('none')
  const [isLeaf, setIsLeaf] = useState<'true' | 'false'>('true')
  const [valueType, setValueType] = useState<SubjectValueType>('amount')
  const [valueTypeTouched, setValueTypeTouched] = useState(false)
  const [dataType, setDataType] = useState<SubjectDataType>('data')
  const [calcFormula, setCalcFormula] = useState('')
  const [typeHint, setTypeHint] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 新建编码预览全集：flat（active）+ allSubjects（含 inactive）按 code 合并去重，保证序号与后端一致
  const previewSubjects = useMemo(() => {
    const map = new Map<string, CodePreviewSubject>()
    for (const f of flat) map.set(f.code, f)
    for (const s of allSubjects ?? []) if (!map.has(s.code)) map.set(s.code, s)
    return [...map.values()]
  }, [flat, allSubjects])

  /** 新建模式编码预览（系统自动生成，只读展示；编辑模式沿用 subject.code） */
  const generatedCode = useMemo(() => {
    if (mode !== 'create') return null
    const pc = parentCode === 'none' ? null : parentCode
    if (!pc) {
      const trimmed = name.trim()
      if (!trimmed) return ''
      return nextRootSubjectCode(type === 'operating' ? 'OP' : 'ST', trimmed, previewSubjects).code
    }
    return nextChildSubjectCode(pc, previewSubjects)
  }, [mode, parentCode, name, type, previewSubjects])

  useEffect(() => {
    if (!open) return
    setError(null)
    if (mode === 'edit' && subject) {
      setCode(subject.code)
      setName(subject.name)
      setCategory(subject.category)
      setParentCode(subject.parentCode ?? 'none')
      setIsLeaf(subject.isLeaf ? 'true' : 'false')
      setValueType(subject.valueType ?? 'amount')
      setValueTypeTouched(true) // 编辑模式不随名称自动推断
      const cur = (subject.dataType ?? 'data') as SubjectDataType
      setDataType(cur)
      setCalcFormula('')
      setTypeHint(cur === 'display' ? '展示类为只读展示用途，不支持转换为其他类型' : null)
    } else {
      setCode('')
      setName('')
      setCategory('')
      setParentCode('none')
      setIsLeaf('true')
      setValueType('amount')
      setValueTypeTouched(false)
      setDataType('data')
      setCalcFormula('')
      setTypeHint(null)
    }
  }, [open, mode, subject])

  const pending = createSubject.isPending || updateSubject.isPending || reclassifySubject.isPending || convertMetric.isPending

  /** 指标类型切换：仅更新表单状态（保存时才提交转换），并给出后果提示 */
  const handleTypeChange = (v: SubjectDataType) => {
    setDataType(v)
    if (v === 'calc') setTypeHint('转换为计算类后参与公式计算体系，需填写公式（保存时校验）；公式可含 {编码} 与 {编码@维度} 操作数')
    else if (v === 'display') setTypeHint('展示类为只读展示用途，不参与数据录入与公式计算；保存后不可再转换')
    else setTypeHint('转换为数据类后公式将被清空（保留版本历史），改为手工录入数据')
  }

  // 编辑模式下上级是否变更（变更则走重分类路径，category 自动推导）
  const newParentCode = parentCode === 'none' ? null : parentCode
  const parentChanged = mode === 'edit' && !!subject && newParentCode !== subject.parentCode

  const handleParentChange = (v: string) => {
    setParentCode(v)
    if (mode === 'edit') {
      setCategory(deriveRootCategory(flat, v === 'none' ? null : v, name.trim()))
    }
  }

  const handleNameChange = (v: string) => {
    setName(v)
    if (mode === 'create' && !valueTypeTouched) setValueType(inferValueType(v))
  }

  const submit = async () => {
    setError(null)
    try {
      if (mode === 'create') {
        // 编码由系统按层级自动生成（后端权威赋码），提交不携带 code/level
        const payload: Record<string, unknown> = {
          name: name.trim(),
          type,
          category: category.trim() || name.trim(),
          parentCode: parentCode === 'none' ? null : parentCode,
          isLeaf: isLeaf === 'true',
          valueType,
        }
        await createSubject.mutateAsync(payload)
      } else if (subject) {
        const curType = (subject.dataType ?? 'data') as SubjectDataType
        const typeChanged = dataType !== curType
        if (typeChanged) {
          if (!canConvert) {
            setError('无权进行指标类型转换（需 data:metric:convert 权限）')
            return
          }
          if (dataType === 'calc' && !calcFormula.trim()) {
            setError('转换为计算类需填写公式')
            return
          }
          const metric = metricByCode.get(subject.code)
          if (!metric) {
            setError('该科目暂无指标记录，无法转换类型（可在公式维护中创建）')
            return
          }
          if (dataType === 'data' || dataType === 'display') {
            const ok = await confirm({
              title: dataType === 'display' ? '转换为展示类' : '转换为数据类',
              description: dataType === 'display'
                ? `科目「${subject.name}」将变为只读展示用途，不再参与数据录入与公式计算${curType === 'calc' ? '，现有公式将被清空（保留版本历史）' : ''}，保存后不可再转换。确认转换？`
                : `科目「${subject.name}」将转换为数据类，现有公式将被清空（保留版本历史），改为手工录入数据。确认转换？`,
              danger: dataType === 'display',
              confirmText: '转换',
            })
            if (!ok) return
          }
          await convertMetric.mutateAsync({
            id: metric.id,
            dataType,
            formula: dataType === 'calc' ? calcFormula.trim() : undefined,
          })
        }
        if (parentChanged) {
          // 换父归类：category 向下传播，走重分类路径
          await reclassifySubject.mutateAsync({ id: subject.id, parentCode: newParentCode })
        }
        // 其余可编辑字段（名称/叶子/值类型）；非换父时同步 category/parentCode
        const fieldPayload: Record<string, unknown> = {
          name: name.trim(),
          type,
          isLeaf: isLeaf === 'true',
          valueType,
        }
        if (!parentChanged) {
          fieldPayload.category = category.trim() || name.trim()
          fieldPayload.parentCode = newParentCode
        }
        await updateSubject.mutateAsync({ id: subject.id, data: fieldPayload })
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败')
    }
  }

  return {
    code, name, category, parentCode, isLeaf, valueType, dataType, calcFormula, typeHint, error,
    generatedCode, pending, parentChanged,
    setName, setCategory, setParentCode: handleParentChange, setIsLeaf, setValueType: (v: SubjectValueType) => { setValueType(v); setValueTypeTouched(true) },
    setValueTypeTouched, setDataType: handleTypeChange, setCalcFormula, handleNameChange, submit, confirmElement,
  }
}
```

> 注：`deriveRootCategory` 调用处参数顺序为 `(flat, v, name)`，与 lib 签名 `(flat, parentCode, selfName)` 一致。

- [ ] **Step 2: subject-dialog.tsx 改用 hook**

替换组件主体为薄壳：删除全部 useState/useMemo/useEffect/mutations 相关代码，改为：

```tsx
export function SubjectDialog({ open, mode, type, subject, flat, allSubjects, canConvert = false, onClose }: SubjectDialogProps) {
  const form = useSubjectForm({ open, mode, type, subject, flat, allSubjects, canConvert, onClose })
  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent>
        {/* ...JSX 不变，所有状态引用改为 form.xxx：
            value={form.generatedCode ?? ''}、value={form.code}、value={form.name} 等；
            事件改为 form.setName(e.target.value) / form.handleNameChange(...) 等 */}
        </DialogContent>
      </Dialog>
      {form.confirmElement}
    </>
  )
}
```

JSX 引用映射（逐项替换，文案/结构不变）：
- `generatedCode` → `form.generatedCode`；`code` → `form.code`；`name` → `form.name`；`category` → `form.category`
- `parentCode` → `form.parentCode`；`parentChanged` → `form.parentChanged`；`isLeaf` → `form.isLeaf`
- `valueType` → `form.valueType`；`valueTypeTouched` → `form.valueTypeTouched`；`dataType` → `form.dataType`；`typeHint` → `form.typeHint`；`error` → `form.error`；`pending` → `form.pending`；`calcFormula` → `form.calcFormula`
- `handleNameChange(...)` → `form.handleNameChange(...)`；`handleParentChange(...)` → `form.setParentCode(...)`；`handleTypeChange(...)` → `form.setDataType(...)`；`submit` → `form.submit`；`confirmElement` → `form.confirmElement`
- 值类型 Select 的 onValueChange 原 `(v) => { setValueType(v as SubjectValueType); setValueTypeTouched(true) }` → `form.setValueType(v as SubjectValueType)`
- 删除不再使用的导入（useEffect/useState/useMemo、nextChildSubjectCode/nextRootSubjectCode、各 mutation hooks、useMetrics、useConfirm、inferValueType/deriveRootCategory、Metric 类型）

- [ ] **Step 3: 验证**

```bash
npm run typecheck
npm run lint
npm test
```

预期：全部通过（dialog 无既有测试，以 typecheck + 现有全量测试为准）。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor: 科目弹窗表单状态与提交编排抽为 use-subject-form hook"
```

---

## Phase 5：指标页筛选栏拆分

### Task 5.1: 抽取 indicator-toolbar.tsx

**Files:**
- Create: `web/src/components/indicators/indicator-toolbar.tsx`
- Modify: `web/src/pages/indicators/index.tsx`

- [ ] **Step 1: 创建 indicator-toolbar.tsx**

将 index.tsx 中筛选栏 JSX（原 460-707 行，`actions` prop 内容）整体迁移，组件接收全部状态与回调：

```tsx
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CompanySelect } from '@/components/filters/company-select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { Search, X, MoreHorizontal, Rows3, Columns3, ChevronsDownUp, ChevronsUpDown, Sparkles, Loader2, Eye, Download } from 'lucide-react'

export interface ToolbarColumnMeta {
  key: string
  header: string
}

interface IndicatorToolbarProps {
  dimFilter: string
  onDimFilterChange: (v: string) => void
  periods: string[]
  periodFilter: string
  onPeriodFilterChange: (v: string) => void
  excludeReclassify: boolean
  onExcludeReclassifyChange: (v: boolean) => void
  subjectKeyword: string
  onSubjectKeywordChange: (v: string) => void
  searchOpen: boolean
  onSearchOpenChange: (v: boolean) => void
  isAllExpanded: boolean
  onToggleExpandAll: () => void
  canReportsCreate: boolean
  canReportsView: boolean
  canIndicatorsExport: boolean
  onAiPreanalyze: () => void
  onViewAnalyses: () => void
  onExport: () => void
  aiPreparing: boolean
  aiDisabled: boolean
  exporting: boolean
  exportDisabled: boolean
  density: 'default' | 'dense' | 'compact'
  onDensityChange: (v: 'default' | 'dense' | 'compact') => void
  columnMeta: ToolbarColumnMeta[]
  hiddenColumns: string[]
  onHiddenColumnsChange: (cols: string[]) => void
}

/** 财务指标页筛选与操作工具栏：主体/期间/搜索/重分类口径/展开折叠/AI 预分析/导出/视图设置（响应式收纳） */
export function IndicatorToolbar(props: IndicatorToolbarProps) {
  const {
    dimFilter, onDimFilterChange, periods, periodFilter, onPeriodFilterChange,
    excludeReclassify, onExcludeReclassifyChange, subjectKeyword, onSubjectKeywordChange,
    searchOpen, onSearchOpenChange, isAllExpanded, onToggleExpandAll,
    canReportsCreate, canReportsView, canIndicatorsExport,
    onAiPreanalyze, onViewAnalyses, onExport,
    aiPreparing, aiDisabled, exporting, exportDisabled,
    density, onDensityChange, columnMeta, hiddenColumns, onHiddenColumnsChange,
  } = props
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      {/* ← 原 460-707 行 JSX 原样迁移，所有状态引用替换为 props 解构变量；期间下拉/开关/展开折叠/更多操作/大屏按钮组全部保持 */}
    </div>
  )
}
```

> 迁移规则：原 `setDimFilter`→`onDimFilterChange`、`setPeriodFilter`→`onPeriodFilterChange`、`setExcludeReclassify`→`onExcludeReclassifyChange`、`setSubjectKeyword`→`onSubjectKeywordChange`、`setSearchOpen`→`onSearchOpenChange`、`toggleExpandAll`→`onToggleExpandAll`、`setAiNeedData(true)`→`onAiPreanalyze`、`navigate('/reports/analyses')`→`onViewAnalyses`、`handleExport`→`onExport`、`setDensity`→`onDensityChange`、`setHiddenColumns`→`onHiddenColumnsChange`、`can('reports','create')`→`canReportsCreate` 等。搜索框的 `min-[600px]` 响应式分支与「更多操作」`min-[1300px]` 分支原样保留。

- [ ] **Step 2: index.tsx 接入**

替换 `actions={...}` 巨型 JSX（原 456-708 行）为：

```tsx
actions={
  <IndicatorToolbar
    dimFilter={dimFilter}
    onDimFilterChange={setDimFilter}
    periods={periods}
    periodFilter={periodFilter}
    onPeriodFilterChange={setPeriodFilter}
    excludeReclassify={excludeReclassify}
    onExcludeReclassifyChange={setExcludeReclassify}
    subjectKeyword={subjectKeyword}
    onSubjectKeywordChange={setSubjectKeyword}
    searchOpen={searchOpen}
    onSearchOpenChange={setSearchOpen}
    isAllExpanded={isAllExpanded}
    onToggleExpandAll={toggleExpandAll}
    canReportsCreate={can('reports', 'create')}
    canReportsView={can('reports', 'view')}
    canIndicatorsExport={can('indicators', 'export')}
    onAiPreanalyze={() => setAiNeedData(true)}
    onViewAnalyses={() => navigate('/reports/analyses')}
    onExport={handleExport}
    aiPreparing={overviewPreparing}
    aiDisabled={isLoading || !hasOverviewData}
    exporting={exporting}
    exportDisabled={isLoading || activeItems.length === 0}
    density={density}
    onDensityChange={setDensity}
    columnMeta={isOperating ? OPERATING_COLUMN_META : STATIC_COLUMN_META}
    hiddenColumns={hiddenColumns}
    onHiddenColumnsChange={setHiddenColumns}
  />
}
```

同时新增导入 `IndicatorToolbar`，删除已迁走的图标/组件导入（以 typecheck 报错为准逐项清理：Search/X/Popover 相关/DropdownMenu 相关/MoreHorizontal/Rows3/Columns3/ChevronsUpDown/ChevronsDownUp/Sparkles/Loader2/Eye/Download/CompanySelect/Switch/Label 等——`ArrowLeft`、`History`、`CheckCircle2`、`TriangleAlert`、`Skeleton` 等仍在页面使用则保留）。

- [ ] **Step 3: 验证**

```bash
npm run typecheck
npm run lint
npm test
```

预期：全部通过（指标页无组件测试，以 typecheck + 全量回归为准；可手动 `npm run dev` 目检筛选栏布局与交互）。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "refactor: 指标页筛选工具栏抽为 indicator-toolbar 组件，页面瘦身"
```

---

## Phase 6：全量回归与验收

### Task 6.1: 全量验证

- [ ] **Step 1: web 全量门禁**

```bash
cd d:\flies\pj3\.worktrees\refactor-indicator-tree\web
npm run typecheck
npm run lint
npm test
```

预期：typecheck 无错、lint 无错、全部测试通过（预计 215 + 新增约 30 个用例）。

- [ ] **Step 2: server 回归（确认无意外影响）**

```bash
cd d:\flies\pj3\.worktrees\refactor-indicator-tree\server
npm test
```

预期：637 通过 / 0 失败（`.env` 已复制，FISCAL_START_MONTH=4 生效）。

- [ ] **Step 3: 运行 dev server 目检**

```bash
cd d:\flies\pj3\.worktrees\refactor-indicator-tree
npm run dev:up
```

目检清单（与原工作区对照）：
- 财务指标页：经营/静态两 Tab 的树渲染、展开折叠、分类列、排序、分类筛选、列隐藏、密度、搜索、导出文件名与列
- 数据管理 → 维度/科目体系：经营/静态两个科目面板的搜索/类别筛选/新增/编辑/停用/重新启用/导出
- 无 console 报错

### Task 6.2: 收尾提交与合并准备

- [ ] **Step 1: 确认工作区无遗留**

```bash
git status
git log --oneline -10
```

- [ ] **Step 2: 推送分支**

```bash
git push origin refactor/indicator-tree
```

- [ ] **Step 3: 创建 PR（develop ← refactor/indicator-tree）**，标题与描述说明各 Phase 改动与测试结果。

---

## 验收标准（DoD）

- [ ] 行为不变：页面文案/样式/交互与重构前一致（目检对照）
- [ ] mock 装饰链路完全删除（Grep `decorateTree|rawOperatingAnalysis|rawStaticAnalysis` 无业务命中）
- [ ] `pages/indicators/index.tsx` 从 819 行降至约 350 行内；`metric-tree.tsx` 从 648 行降至约 300 行内
- [ ] 新增测试覆盖：indicator-adapt（7）、indicator-export（6）、subject-form（8）、metric-tree 组件（约 8）、subject-tree 重构后（约 11）
- [ ] 全量测试通过：web 全部用例、server 637 用例
- [ ] typecheck + lint 无错误
- [ ] 每任务独立 commit，提交信息符合 Conventional Commits

## 回滚方案

- 每 Phase 独立提交，若某 Phase 出现回归：`git revert <commit>` 或 `git reset --hard HEAD~N` 回退该 Phase（重构分支不影响 develop）
- 数据库/后端零改动，无数据风险
- 若整体不可用：直接删除 refactor/indicator-tree 分支，develop 不受影响
