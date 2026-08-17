# 数据质量合并到数据导入页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按拆分布置方案：导入覆盖（CoverageTab）作为数据导入面板的往来专属分区嵌入；科目过滤上提为往来分析叶子导航；删除 transactions「数据质量」目录。

**Architecture:** 纯前端改动（2 文件）：`nav-items.ts` 导航结构调整；`import-panel.tsx` 在质量概览分区之后新增可折叠的「往来导入覆盖」分区（跨模块引用 CoverageTab，不移动文件；折叠偏好 localStorage 独立 key）。旧路由保留兼容，无后端改动。

**Tech Stack:** React + TypeScript + Tailwind；oxlint。

**关键约定**：
- 前端验证：`cd web && npm run lint && npm run build`
- PowerShell 用 `;` 分隔
- 工作区有大量无关未提交改动，**只 git add 指定文件**

---

### Task 1: 导航结构调整（nav-items.ts）

**Files:**
- Modify: `web/src/components/layout/nav-items.ts`

- [ ] **Step 1: 调整往来分析 children**

当前结构（约 L52-64）：

```ts
    children: [
      { path: '/transactions/overview', label: '总览' },
      { path: '/transactions/aging', label: '账龄分析' },
      {
        path: '/transactions/quality',
        label: '数据质量',
        children: [
          { path: '/transactions/coverage', label: '导入覆盖' },
          { path: '/transactions/account-filter', label: '科目过滤' },
        ],
      },
      { path: '/transactions/collections/plans', label: '催收计划' },
    ],
```

替换为：

```ts
    children: [
      { path: '/transactions/overview', label: '总览' },
      { path: '/transactions/aging', label: '账龄分析' },
      { path: '/transactions/account-filter', label: '科目过滤' },
      { path: '/transactions/collections/plans', label: '催收计划' },
    ],
```

（删除「数据质量」目录与「导入覆盖」子项；「科目过滤」上提为叶子；「催收计划」保持。）

- [ ] **Step 2: 验证**

```powershell
cd d:\flies\pj3\web
npm run lint
npm run build
```

Expected: 无错误。

- [ ] **Step 3: Commit**

```powershell
git add web/src/components/layout/nav-items.ts; git commit -m "feat(nav): flatten subject filter under transactions and remove quality group"
```

---

### Task 2: 导入面板嵌入往来导入覆盖分区（import-panel.tsx）

**Files:**
- Modify: `web/src/pages/data/import-panel.tsx`

- [ ] **Step 1: 导入与状态**

1. 顶部导入追加（现有导入中 `usePermission` 已有；追加 CoverageTab 与图标）：

```tsx
import { CoverageTab } from '@/pages/transactions/coverage-tab'
import { Grid3X3 } from 'lucide-react'
```

（`Collapsible`、`cn`、`useState` 已导入；lucide 现有导入块合并 `Grid3X3`。）

2. `ImportPanel` 组件内（`handleQualityOpenChange` 定义之后）追加分区三折叠偏好与权限：

```tsx
  // 往来导入覆盖折叠偏好：localStorage 持久化（'1' = 收起），读写失败静默降级为展开
  const [coverageOpen, setCoverageOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('data-import-coverage-collapsed') !== '1'
    } catch {
      return true
    }
  })
  const handleCoverageOpenChange = (open: boolean) => {
    setCoverageOpen(open)
    try {
      localStorage.setItem('data-import-coverage-collapsed', open ? '0' : '1')
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }
```

3. `can('transactions', 'view')` 判断追加（`canPurgeBatch` 之后）：

```tsx
  const canViewTransactions = can('transactions', 'view')
```

- [ ] **Step 2: 分区三 JSX**

在分区二结束处（`</Collapsible>\n      </div>` 之后、`{confirmElement}` 之前，约 L895-896）插入：

```tsx
      {/* 分区三：往来导入覆盖（合并自往来分析「数据质量」目录；仅持有往来查看权限的用户可见） */}
      {canViewTransactions && (
        <div className="border-t">
          <Collapsible
            open={coverageOpen}
            onOpenChange={handleCoverageOpenChange}
            trigger={(open) => (
              <span className="flex flex-wrap items-center justify-between gap-2 px-6 py-3">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Grid3X3 className="h-4 w-4 text-muted-foreground" />
                  往来导入覆盖
                </span>
                {!open && <span className="text-xs text-muted-foreground">往来批次覆盖率矩阵（公司×期间×类型）</span>}
              </span>
            )}
          >
            <CardContent>
              <CoverageTab />
            </CardContent>
          </Collapsible>
        </div>
      )}
```

注意：
- `Collapsible` 的 trigger 模式参照分区二（L760-778）——先读取分区二 trigger 的实际用法（是否需 `ChevronDown`/`ChevronRight` 图标），保持一致
- `CoverageTab` 自带 `<div className="space-y-4">` 与内部卡片/弹层，包在 `CardContent` 内即可；若 CoverageTab 顶层间距与 CardContent padding 冲突，可改用 `<div className="p-4">` 包裹，以实现视觉效果为准
- 分区三 `border-t` 分隔与分区二一致（`cn(canImport && 'border-t')` 的模式——分区三用无条件 `border-t` 即可，因为前有分区二；若分区二因 canImport 隐藏导致顶部无内容，评估是否需要条件 border-t——**以实际渲染连贯为准，若分区二始终渲染（质量概览始终展示）则无条件 border-t 正确**）

- [ ] **Step 3: 验证**

```powershell
cd d:\flies\pj3\web
npm run lint
npm run build
```

Expected: 无错误。注意跨模块引用 `@/pages/transactions/coverage-tab` 的类型/依赖（CoverageTab 内部引用 TransactionImportDialog 等在 transactions 目录内的组件——路径为相对路径，不因被外部引用而破坏）。

- [ ] **Step 4: Commit**

```powershell
git add web/src/pages/data/import-panel.tsx; git commit -m "feat(data): embed transaction coverage panel into import page"
```

---

## 自审记录

- **Spec 覆盖**：导航调整（Task 1）；分区三嵌入 + 折叠偏好 + 权限门禁（Task 2）；旧路由/页面保留（不动 App.tsx 与 coverage.tsx——符合设计 §2.4）。
- **占位符检查**：步骤含具体代码与插入位置；无 TBD。
- **类型一致性**：`CoverageTab` 导出名（coverage-tab.tsx 现有 `export function CoverageTab`）；`Grid3X3` lucide 图标存在（coverage-tab.tsx 已用）；折叠 key `'data-import-coverage-collapsed'` 与质量概览 key `'data-quality-overview-collapsed'` 命名风格一致。
- **已知确认点**：Collapsible trigger 用法以分区二实际代码为准；CoverageTab 在 CardContent 内的间距以视觉为准。若 import-panel.tsx 已有 `Grid3X3` 或冲突导入，按现有导入调整。
