# 前端优化 Phase 3+4：大文件拆分与细节打磨 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 3 将 4 个超大文件（import-panel 999 行 / indicators 884 行 / inventory 884 行 / admin/dialogs 772 行）按职责拆分，全部降到 400 行以下；Phase 4 完成细节打磨（达成率阈值配置化、导出体验统一、移动端表格卡式化评估）。

**Architecture:** 拆分遵循"行为零变化"原则——纯代码搬迁 + 接口接线，不重构逻辑；组件边界以现有 JSX 分区为天然边界（分区一/二/三）；互斥逻辑已在 Phase 1 收敛为 `useExclusiveCompanyFilter`（P0-3 已完成，本 Phase 不再处理）。Phase 4 的 KPI 卡 hover 钻取暗示已被 antd 化重构实现（0780779），仅剩阈值配置化与导出统一。

**Tech Stack:** React 19 / antd 门面化组件体系（4f24262 起已合入 develop）/ Vitest + Testing Library / oxlint

**验证基线（先跑一遍确保全绿）：** `cd web && npx vitest run && npm run lint`

---

## 任务一览

| # | 任务 | 文件 | 拆分目标 |
|---|------|------|----------|
| 1 | import-panel 拆分 | `pages/data/import-panel.tsx`（999） | 拆 3 组件 + 1 hook，主文件 < 400 |
| 2 | indicators 拆分 | `pages/indicators/index.tsx`（884） | 拆 FilterBar/Export/adapters，主文件 < 400 |
| 3 | inventory 拆分 | `pages/inventory/index.tsx`（884） | 拆明细表组件，主文件 < 400 |
| 4 | admin/dialogs 拆分 | `pages/admin/dialogs.tsx`（772） | 按对话框拆 6 文件，主文件转 re-export |
| 5 | 达成率阈值配置化 + KPI 可点击性确认 | `components/charts/kpi-card.tsx` + `lib/constants.ts` | 75/60 提为常量；P2-9 验证已完成 |
| 6 | 导出体验统一 + 移动端评估 | 各导出点 + 评估报告 | loading 统一 + 反馈形式梳理 |

---

## Task 1: import-panel.tsx 拆分

**Files:**
- Create: `web/src/pages/data/import-upload-zone.tsx`（上传+预览区）
- Create: `web/src/pages/data/import-batch-panel.tsx`（质量概览+批次管理区）
- Create: `web/src/pages/data/use-import-flow.ts`（导入流状态机 hook）
- Modify: `web/src/pages/data/import-panel.tsx`（主文件瘦身）

### Step 1: 读源文件，建立移动清单

读 `web/src/pages/data/import-panel.tsx` 全文（999 行），按以下分区标记代码归属：

| 归属 | 内容（按现有代码行段） | 目标文件 |
|------|------------------------|----------|
| hook | 状态：selectedBatchId/qualityOpen/coverageOpen/activateMsg/importOpen/compareSource/uploadedInfo/file/dragOver/previewResult/templateType/fy 相关 + 全部 handler（acceptFile/handleFileSelect/handleDragOver/handleDrop/handleUpload/handleCancel/handlePreview/handleActivate/handleRowActivate/handleBatchActivate/handleArchive/handlePurgeBatch）+ mutations + 派生（qualityStats/selectableIds/selectedCount/toggleSelect/compareCandidates/currentFy/fyOptions/budgetFiscalYear） | `use-import-flow.ts` |
| 组件 A | JSX 分区一（上传卡：文件选择/模板类型/期间/预算覆盖/上传按钮 + preview 结果展示 + uploadedInfo 成功条）——从 JSX 中"分区一"注释到"分区二"注释前 | `import-upload-zone.tsx` |
| 组件 B | JSX 分区二（质量概览 Collapsible：统计卡/批次管理按钮组/批次表格/激活失败明细/完整性校验/批次异常明细）——从"分区二"注释到"分区三"注释前 | `import-batch-panel.tsx` |
| 保留 | 权限常量、batchStatusLabel/templateTypeLabel、ImportErrorRow、errorColumns/sampleColumns/batchColumns、分区三（CoverageTab 已独立）、confirmElement/ImportCompareDialog/TransactionImportDialog、fetch 相关 queries | `import-panel.tsx` |

### Step 2: 创建 use-import-flow hook

Create `web/src/pages/data/use-import-flow.ts`（签名与完整实现）：

```ts
import { useCallback, useMemo, useState } from 'react'
import { usePageStore, usePeriodStore } from '@/stores/pageStateStore'
import { useUploadImport, usePreviewImport, useActivateImport, useArchiveImport, usePurgeImport, useBatchActivate } from '@/hooks/api-queries'

/** 导入流状态机：上传→预览→激活 全链路状态与 handler（从 import-panel.tsx 原样搬迁，零逻辑变更） */
export function useImportFlow(opts: {
  canImport: boolean
  importsData: unknown
  selectedBatch: unknown
}) {
  // ... 从 import-panel.tsx 原样搬迁：selectedBatchId/qualityOpen/coverageOpen/activateMsg/
  //     importOpen/compareSource/uploadedInfo/file/dragOver/previewResult/templateType/
  //     fy 相关状态、全部 handler、mutations、派生 useMemo
  // 返回：所有原 ImportPanel 使用的状态与 handler（保持同名）
}
```

> **搬迁规则**：从 import-panel.tsx 原函数体中**原样移动**（含注释），只改两处：(a) 组件内直接使用的 props（canImport、importsData、selectedBatch）改为入参；(b) 返回对象按使用点列出全部字段。`batchStatusLabel`/`templateTypeLabel`/`ImportErrorRow`/`fmtPeriods` 若仅被搬迁代码使用则一并迁入，否则留在原文件。

### Step 3: 创建 UploadZone 组件

Create `web/src/pages/data/import-upload-zone.tsx`（接口签名）：

```tsx
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import type { ImportErrorRow } from './import-panel'

interface UploadZoneProps {
  canImport: boolean
  canArchive: boolean
  canPurgeBatch: boolean
  // 状态（来自 useImportFlow）
  file: File | null
  dragOver: boolean
  templateType: string
  setTemplateType: (v: string) => void
  fyOptions: string[]
  currentFy: string
  budgetFiscalYear: string
  setBudgetFyOverride: (v: string | null) => void
  previewResult: unknown
  uploading: boolean
  previewing: boolean
  activating: boolean
  uploadedInfo: unknown
  selectedBatch: unknown
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onUpload: () => Promise<void>
  onCancel: () => void
  onPreview: () => Promise<void>
  onActivate: () => Promise<void>
}

/** 上传与预览区：文件选择/模板类型/期间/预算覆盖/上传 + 预览结果（警告/抽样/错误/确认导入） */
export function UploadZone(props: UploadZoneProps) { /* 搬迁分区一 JSX + 所需局部派生 */ }
```

> 搬迁规则：分区一 JSX 原样移动；`errorColumns`/`sampleColumns` 若仅分区一使用则作为模块级常量迁入本文件（否则留在 import-panel 导出）；`templateTypeLabel` 等常量随迁。

### Step 4: 创建 BatchPanel 组件

Create `web/src/pages/data/import-batch-panel.tsx`（接口签名）：

```tsx
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import type { ImportBatch } from '@/types'

interface BatchPanelProps {
  canImport: boolean
  // 状态（来自 useImportFlow）
  qualityOpen: boolean
  onQualityOpenChange: (open: boolean) => void
  qualityStats: { batchCount: number; totalRows: number; successRows: number; errorRows: number }
  recentBatches: ImportBatch[]
  selectedBatch: ImportBatch | null
  selectedBatchId: string | null
  selectedCount: number
  batchActivate: unknown
  activateMsg: string | null
  detailFetching: boolean
  batchErrors: ImportErrorRow[]
  errorColumns: DataTableColumn<ImportErrorRow>[]
  batchColumns: DataTableColumn<ImportBatch>[]
  onToggleSelect: (id: string) => void
  onSelectBatch: (id: string) => void
  onActivate: () => Promise<void>
  onBatchActivate: () => Promise<void>
  onArchive: (b: ImportBatch) => Promise<void>
  onPurge: (b: ImportBatch) => Promise<void>
}

/** 导入质量概览与批次管理区（可折叠） */
export function BatchPanel(props: BatchPanelProps) { /* 搬迁分区二 JSX + 所需局部派生 */ }
```

### Step 5: 主文件瘦身

Modify `web/src/pages/data/import-panel.tsx`——移除已搬迁的 handler/状态/JSX 分区一二，替换为：

```tsx
const flow = useImportFlow({ canImport, importsData, selectedBatch })
// 组件组合：
<UploadZone
  canImport={canImport}
  canArchive={canArchive}
  canPurgeBatch={canPurgeBatch}
  {...flow.uploadZoneProps}
/>
<div className={cn(canImport && 'border-t')}>
  <BatchPanel canImport={canImport} {...flow.batchPanelProps} />
</div>
```

> 具体 props 接线按 flow 返回字段与组件接口对齐（可合并为分组 props 对象，保持可读性）。**目标：import-panel.tsx < 400 行**（保留：权限常量、queries、fetch 逻辑、分区三 CoverageTab、对话框挂载、confirmElement）。

### Step 6: 验证 + 提交

Run: `cd web && npx vitest run && npm run lint && npm run build`
Expected: 全绿。`(Get-Content web/src/pages/data/import-panel.tsx).Count` < 400。

手工冒烟（dev）：上传文件 → 预览 → 确认导入 → 激活批次 → 质量面板折叠/展开 → 往来覆盖分区——全部行为与拆分前一致。

**重要**：工作区存在大量并行未提交改动——提交时用 `git add <明确列出的本任务文件>`，**禁止** `git add .` / `-A`。import-panel.tsx 若被并行改动污染（先 `git status` 检查），报告后谨慎用 `git add -p`。

```bash
git add web/src/pages/data/import-panel.tsx web/src/pages/data/import-upload-zone.tsx web/src/pages/data/import-batch-panel.tsx web/src/pages/data/use-import-flow.ts
git commit -m "refactor(web): import-panel 拆分 UploadZone/BatchPanel/useImportFlow，主文件降至 400 行内"
```

---

## Task 2: indicators/index.tsx 拆分

**Files:**
- Create: `web/src/pages/indicators/indicators-adapters.ts`（三类科目适配映射）
- Create: `web/src/pages/indicators/use-indicator-export.ts`（导出 hook）
- Create: `web/src/pages/indicators/indicator-filter-bar.tsx`（筛选+列设置+密度）
- Modify: `web/src/pages/indicators/index.tsx`（主文件瘦身）

### Step 1: 读源文件，建立移动清单

读 `web/src/pages/indicators/index.tsx` 全文（884 行），按以下归属标记：

| 归属 | 内容 | 目标文件 |
|------|------|----------|
| adapters | 三类科目（operating/static/cashflow）的适配映射：query hook 选择、列定义、导出列 keys、valueType 分型格式、树构建差异等（isOperating/isCashflow 分支相关的纯映射） | `indicators-adapters.ts` |
| export | handleExport 全链路 + exporting/exportMsg/exportErr 状态 + flattenForExport + 导出文件构建 | `use-indicator-export.ts` |
| filter | 筛选区 JSX（主体/期间/去重分类/科目搜索）+ 列设置 + 密度切换 + 相关状态与 handler | `indicator-filter-bar.tsx` |
| 保留 | IndicatorPage 骨架（树构建/展开折叠/AI 分析/主表格 JSX） | `index.tsx` |

### Step 2: 创建 adapters 模块

Create `web/src/pages/indicators/indicators-adapters.ts`：

```ts
import type { DataTableColumn } from '@/components/data-table/data-table'
import type { SubjectNode } from '@/components/subject-tree/types'

/** 三类科目（经营/静态/现金流）的列定义与查询适配（从 index.tsx 原样搬迁，零逻辑变更） */
export function buildColumnsFor(subjectType: 'operating' | 'static' | 'cashflow'): DataTableColumn<SubjectNode>[]
export function exportKeysFor(subjectType: 'operating' | 'static' | 'cashflow'): readonly string[]
export function queryHookFor(subjectType: 'operating' | 'static' | 'cashflow') { /* 返回对应 query hook */ }
export function valueFormatterFor(subjectType: 'operating' | 'static' | 'cashflow') { /* 分型格式化 */ }
```

> 搬迁规则：从 index.tsx 中把与 `subjectType` 分支相关的纯函数/映射（列定义、导出列 keys、值类型格式化、query 选择）原样迁入，函数名按上表（原实现若为内联三目则提取为函数）。**adapters 文件不放 React 状态**（纯函数模块）。

### Step 3: 创建 use-indicator-export hook

Create `web/src/pages/indicators/use-indicator-export.ts`：

```ts
import { useCallback, useState } from 'react'
import type { SubjectNode } from '@/components/subject-tree/types'

/** 指标导出：loading + 结果反馈状态（从 index.tsx 原样搬迁） */
export function useIndicatorExport(opts: {
  subjectType: 'operating' | 'static' | 'cashflow'
  getRows: () => SubjectNode[]  // 调用方提供当前排序/过滤后的行
  getHiddenColumns: () => string[]
  getFilenameScope: () => string
}) {
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const [exportErr, setExportErr] = useState<string | null>(null)
  const handleExport = useCallback(async () => { /* 原 handleExport 逻辑搬迁 */ }, [...])
  return { exporting, exportMsg, exportErr, handleExport, clearExportMsg: () => setExportMsg(null) }
}
```

### Step 4: 创建 IndicatorFilterBar

Create `web/src/pages/indicators/indicator-filter-bar.tsx`：

```tsx
interface IndicatorFilterBarProps {
  subjectType: 'operating' | 'static' | 'cashflow'
  // 主体/期间/去重分类/搜索 状态与 handler
  // 列设置 + 密度状态与 handler
  // 更多操作下拉（AI 预分析/查看分析/导出）
}

/** 指标页筛选与视图设置区（筛选+列设置+密度+更多操作） */
export function IndicatorFilterBar(props: IndicatorFilterBarProps) { /* 搬迁筛选区 JSX */ }
```

### Step 5: 主文件瘦身

Modify `web/src/pages/indicators/index.tsx`——移除已搬迁部分，保留页面骨架（树构建/展开折叠/AI 分析/主表格），**目标 < 400 行**。

### Step 6: 验证 + 提交

Run: `cd web && npx vitest run && npm run lint && npm run build` + 行数检查。

手工冒烟：经营/静态/现金流三个子页——筛选/列设置/密度/导出/AI 预分析/展开折叠全部正常。

```bash
git add web/src/pages/indicators/index.tsx web/src/pages/indicators/indicators-adapters.ts web/src/pages/indicators/use-indicator-export.ts web/src/pages/indicators/indicator-filter-bar.tsx
git commit -m "refactor(web): indicators 拆分 adapters/导出 hook/筛选栏，主文件降至 400 行内"
```

---

## Task 3: inventory/index.tsx 拆分

**Files:**
- Create: `web/src/pages/inventory/detail-table.tsx`（公司×品类明细表）
- Create: `web/src/pages/inventory/inventory-utils.ts`（排序/导出列/维度常量等纯函数）
- Modify: `web/src/pages/inventory/index.tsx`（主文件瘦身）

### Step 1: 读源文件，建立移动清单

读 `web/src/pages/inventory/index.tsx` 全文（884 行），按以下归属标记：

| 归属 | 内容 | 目标文件 |
|------|------|----------|
| utils | DetailDim 类型、ViewRow/SortState、sortValue/makeComparator/round2、exportColumns、DIM_TITLES/DIM_EMPTY_*/DIM_REGION_LABELS/DIM_SEARCH_EMPTY_*、NUMERIC_EXPORT_COLUMNS、formatDays | `inventory-utils.ts` |
| 明细表 | 详情表格 JSX（明细区：维度切换/搜索/排序表头/选择/导出按钮/展开分析）+ viewRows/visibleRows/sort/selected 相关状态与 handler（cycleSort/toggleAll/toggleOne/doExport/handleAnalyze 等明细表专属部分）+ SortableTh | `detail-table.tsx` |
| 保留 | InventoryPage 骨架（KPI 卡行/筛选卡/汇总卡区/公司份额/品类占比）+ StatCard/ChangeRate/QueryError + useDefaultCompanyCode + 汇总相关 handler（handleCategoryClick/handleAnalyzeCompany） | `index.tsx` |

> 注：互斥逻辑已收敛于 useExclusiveCompanyFilter（Phase 1 Task 6），不在此任务范围。`doExport` 若同时服务汇总卡与明细表，明细表导出迁入 detail-table，汇总卡导出保留在主文件（或提取共享导出工具进 inventory-utils）。

### Step 2: 创建 inventory-utils

Create `web/src/pages/inventory/inventory-utils.ts`——纯函数与常量原样搬迁（含注释），导出类型与函数。

### Step 3: 创建 DetailTable

Create `web/src/pages/inventory/detail-table.tsx`：

```tsx
import type { InventoryDetailRow } from '@/types'
import type { DetailDim, ViewRow } from './inventory-utils'

interface DetailTableProps {
  detailDim: DetailDim
  setDetailDim: (d: DetailDim) => void
  rows: InventoryDetailRow[]           // detailsQuery 原始行
  period: string
  categoryCode: string
  categoryName: string
  // 排序/选择/导出/分析 状态由组件内部管理（原 index.tsx 的明细表专属 state 迁入）
}

/** 存货明细表：维度切换/搜索/排序/行选择/导出/单项分析（公司×品类视图） */
export function DetailTable(props: DetailTableProps) { /* 搬迁明细表 JSX + 状态 */ }
```

### Step 4: 主文件瘦身

Modify `web/src/pages/inventory/index.tsx`——移除已搬迁部分，**目标 < 400 行**。

### Step 5: 验证 + 提交

Run: `cd web && npx vitest run && npm run lint && npm run build` + 行数检查。

手工冒烟：存货页——维度切换（公司/品类/明细）、搜索、排序、行选择、导出、单项分析、KPI 卡/汇总卡正常。

```bash
git add web/src/pages/inventory/index.tsx web/src/pages/inventory/detail-table.tsx web/src/pages/inventory/inventory-utils.ts
git commit -m "refactor(web): inventory 拆分明细表组件与工具模块，主文件降至 400 行内"
```

---

## Task 4: admin/dialogs.tsx 拆分

**Files:**
- Create: `web/src/pages/admin/dialogs/user-dialog.tsx`、`role-dialog.tsx`、`permission-dialog.tsx`、`batch-permission-dialog.tsx`、`clone-role-dialog.tsx`、`reset-password-dialog.tsx`
- Create: `web/src/pages/admin/dialogs/shared.tsx`（DataScopeSelect/PermissionMatrix/validatePassword）
- Modify: `web/src/pages/admin/dialogs.tsx`（转为 re-export 入口）

### Step 1: 读源文件，建立移动清单

读 `web/src/pages/admin/dialogs.tsx` 全文（772 行），按对话框拆分（各自接口/实现/内部子组件整体搬迁）：

| 归属 | 内容 |
|------|------|
| shared | validatePassword、DataScopeSelect、PermissionMatrix（+ 其内部 helpers） |
| user-dialog | UserDialog（L107-226） |
| role-dialog | RoleDialog（L227-310） |
| permission-dialog | PermissionDialog（L436-547） |
| batch-permission-dialog | BatchPermissionDialog（L548-651） |
| clone-role-dialog | CloneRoleDialog（L652-708） |
| reset-password-dialog | ResetPasswordDialog（L709-772） |

### Step 2: 逐对话框拆文件

每个文件模式（以 user-dialog 为例）：

```tsx
// web/src/pages/admin/dialogs/user-dialog.tsx
import { useCreateUser, useUpdateUser } from '@/hooks/api-queries'
// ...原 UserDialog 实现整体搬迁（import 按需调整，接口不变）

// web/src/pages/admin/dialogs.tsx（瘦身为 re-export）
export { UserDialog } from './dialogs/user-dialog'
export { RoleDialog } from './dialogs/role-dialog'
export { PermissionDialog } from './dialogs/permission-dialog'
export { BatchPermissionDialog } from './dialogs/batch-permission-dialog'
export { CloneRoleDialog } from './dialogs/clone-role-dialog'
export { ResetPasswordDialog } from './dialogs/reset-password-dialog'
```

> 所有调用方（users.tsx/roles.tsx）import 路径 `@/pages/admin/dialogs` 不变——re-export 兼容。shared 子组件按需 import（`import { DataScopeSelect } from './dialogs/shared'`）。**目标：dialogs.tsx 仅剩 re-export（约 10 行）**。

### Step 3: 验证 + 提交

Run: `cd web && npx vitest run && npm run lint && npm run build`（重点回归 admin-pages.test.tsx、users-confirm.test.tsx）。

手工冒烟：用户管理（新增/编辑/重置密码）、角色管理（新增/编辑/权限矩阵/批量权限/克隆/删除）全部正常。

```bash
git add web/src/pages/admin/dialogs.tsx web/src/pages/admin/dialogs/
git commit -m "refactor(web): admin 对话框按职责拆 6 文件，dialogs.tsx 瘦身为 re-export 入口"
```

---

## Task 5: 达成率阈值配置化 + KPI 可点击性确认

**Files:**
- Modify: `web/src/lib/constants.ts`（新增达成率阈值常量）
- Modify: `web/src/components/charts/kpi-card.tsx`（引用常量）
- Test: `web/src/lib/__tests__/constants.test.ts`（阈值常量断言）

### Step 1: 写失败测试

Create `web/src/lib/__tests__/constants.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { ACHIEVEMENT_RATE_THRESHOLDS } from '@/lib/constants'

describe('达成率红绿灯阈值', () => {
  it('达标线 75 / 预警线 60（与 KPI 卡分级语义一致）', () => {
    expect(ACHIEVEMENT_RATE_THRESHOLDS.PASS).toBe(75)
    expect(ACHIEVEMENT_RATE_THRESHOLDS.WARN).toBe(60)
  })
})
```

### Step 2: 跑测试确认失败

Run: `cd web && npx vitest run src/lib/__tests__/constants.test.ts`
Expected: FAIL——常量不存在。

### Step 3: 实现常量

Modify `web/src/lib/constants.ts`（文件末尾追加）：

```ts
/** 达成率红绿灯阈值（与 kpi-card 分级语义联动；后端口径变更时先改此处） */
export const ACHIEVEMENT_RATE_THRESHOLDS = {
  /** ≥ 达标线：绿色（持续关注） */
  PASS: 75,
  /** ≥ 预警线且 < 达标线：黄色（需改善计划） */
  WARN: 60,
} as const
```

### Step 4: 改造 kpi-card.tsx

Modify `web/src/components/charts/kpi-card.tsx`——`rateColorClass` 引用常量：

```tsx
import { ACHIEVEMENT_RATE_THRESHOLDS } from '@/lib/constants'

/** 达成率红绿灯三档：≥75 达标绿 / 60-75 预警黄 / <60 未达标红；无预算灰（阈值见 ACHIEVEMENT_RATE_THRESHOLDS） */
function rateColorClass(rate: number | null): string {
  if (rate === null) return 'text-muted-foreground'
  if (rate >= ACHIEVEMENT_RATE_THRESHOLDS.PASS) return 'text-success-strong'
  if (rate >= ACHIEVEMENT_RATE_THRESHOLDS.WARN) return 'text-warning-strong'
  return 'text-destructive'
}
```

### Step 5: KPI 可点击性确认（P2-9）

已由 antd 化重构实现（0780779）：`cursor-pointer hover:-translate-y-0.5 hover:shadow-md` + hover 淡入 ArrowUpRight（kpi-card.tsx:67,82-87）。**无需改动**，在报告中确认即可。

### Step 6: 验证 + 提交

Run: `cd web && npx vitest run && npm run lint && npm run build`
Expected: 全绿。

```bash
git add web/src/lib/constants.ts web/src/lib/__tests__/constants.test.ts web/src/components/charts/kpi-card.tsx
git commit -m "refactor(web): 达成率阈值 75/60 配置化到 constants，供后端口径联动"
```

---

## Task 6: 导出体验统一 + 移动端评估

**Files:**
- Modify: 各导出按钮页（见清单）
- Create: `docs/plans/移动端表格卡式化评估.md`（评估报告）

### Step 1: 梳理导出点现状

grep 全部导出入口：`Select-String -Path web/src -Pattern '导出|handleExport|exportToExcel|saveAs' -Recurse -Include *.tsx,*.ts`，建立清单：

| 页面 | 导出按钮 | loading 态 | 结果反馈 |
|------|---------|-----------|----------|
| indicators/index.tsx | ✅ | exporting state + 按钮 loading | 内联 exportMsg/exportErr 条（成功/失败分色，保持到下次导出） |
| transactions/aging.tsx | ✅ | exporting + 进度 | FlashMessage（Phase 1 已改） |
| admin/users.tsx | 待查 | 待查 | FlashMessage（页面已有） |
| admin/roles.tsx | 待查 | 待查 | FlashMessage（页面已有） |
| inventory（明细导出） | 待查 | exporting | 待查 |
| 其他（browse/collections 等） | 待查 | 待查 | 待查 |

### Step 2: 统一规则（按现状差距修复）

1. **loading 态**：所有导出按钮必须有 loading（exporting state + 按钮 disabled/loading 图标）——缺失的补齐（参考 indicators 的 `{exporting ? <Loader2 .../> : <Download .../>}` 模式）
2. **结果反馈**：统一为 FlashMessage（成功/失败，autoHideMs 4000）或页面内常驻条（indicators 现状）——**决策**：indicators 的内联条含文件名信息且"保持到下次导出"语义明确，保留；其余页面统一 FlashMessage
3. **失败路径**：catch 必须展示错误信息（无 window.alert——lint 已强制）

按清单逐页核对与修复，**每页修复独立小提交或合并为一个提交**（视差距大小）。

### Step 3: 移动端表格卡式化评估

Create `docs/plans/移动端表格卡式化评估.md`——基于现状（DataTable 支持横向滚动 maxHeight、density 三档、冻结列）输出评估：

- 现状能力盘点：DataTable 在 <640px 的横向滚动行为、密集表格的可读性、操作列触达性
- 卡式化的适用场景：仅明细型表格（inventory 明细/账龄明细）值得卡式化；指标树/科目树类层级表格不适合
- 建议：Phase 5 前不做全站卡式化；优先做"关键操作列固定 + 触控目标 ≥40px + 横向滚动提示"三项低成本改进
- 结论：**评估完成，暂不实施**（记录在案，避免范围蔓延）

### Step 4: 验证 + 提交

Run: `cd web && npx vitest run && npm run lint && npm run build`

```bash
git add <修复的导出页面文件> docs/plans/移动端表格卡式化评估.md
git commit -m "refactor(web): 导出按钮 loading 与反馈统一，输出移动端表格卡式化评估"
```

---

## 收尾验收标准（Phase 3+4）

- [ ] import-panel.tsx / indicators/index.tsx / inventory/index.tsx 均 < 400 行；admin/dialogs.tsx 为 re-export 入口
- [ ] 拆分后全量测试全绿（基线 38 文件 / 256 用例 + 新增）
- [ ] 达成率阈值来自 ACHIEVEMENT_RATE_THRESHOLDS 常量
- [ ] 导出按钮 loading 态齐全、反馈形式统一
- [ ] 移动端评估报告存档

## 假设与说明

1. **行为零变化原则**：所有拆分为纯搬迁 + 接口接线，禁止顺手重构（lint/类型修正除外）；若搬迁中发现明显 bug，报告为 DONE_WITH_CONCERNS 不擅自修改。
2. **antd 门面化已合入**（4f24262-dac26ed）：拆分基于当前 develop 状态（antd 组件体系），若目标文件含 antd 化产物（如 SheetShell→Drawer），搬迁时原样保留。
3. **并行开发活动**：工作区存在大量未提交改动（server/expense-mapping-panel 等），每个任务提交必须显式 `git add` 目标文件；目标文件被并行污染时先报告。
4. **行数统计口径**：`(Get-Content <file>).Count` 含空行（拆分目标 <400 为含空行口径）。
5. **Phase 4 的 KPI 可点击性**（P2-9）已由 antd 化实现，本 Phase 仅确认不做改动；移动端评估为报告不实现（方案原文"评估"）。
