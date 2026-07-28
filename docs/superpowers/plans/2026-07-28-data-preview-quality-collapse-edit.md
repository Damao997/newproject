# 数据预览页优化（质量概览折叠 + 编辑入口）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为数据管理页「数据预览」标签页的导入质量概览增加可折叠能力（含 localStorage 持久化与收起态摘要），并在交叉表工具栏提供复用现有重分类/科目调整通道的数据编辑入口。

**Architecture:** 新建零依赖的 `Collapsible` 轻量组件（受控/非受控，render-prop 触发区，带 aria 属性）；`web/src/pages/data/index.tsx` 将质量概览 Card 内容包入该组件，并在交叉表工具栏按权限渲染两个按钮，常驻挂载现有 `ReclassifySubjectDialog` / `ReclassifyCompanyDialog`（`key` 随上下文变化以刷新预填）。后端零改动。

**Tech Stack:** React 19 + TypeScript + Tailwind CSS + lucide-react 图标 + vitest/@testing-library（web 目录）。

**Spec:** `docs/superpowers/specs/2026-07-28-data-preview-quality-collapse-edit-design.md`

**约定提醒（给零上下文工程师）：**
- 所有命令在 `d:\flies\pj3\web` 目录执行；shell 是 PowerShell，多命令用 `;` 分隔，不能用 `&&`。
- 单测文件放 `__tests__` 子目录（项目现有惯例，如 `components/data-table/__tests__/`）。
- 中文注释风格、`cn()` 类名合并、`@/` 路径别名均沿用现有代码。
- git 提交在仓库根 `d:\flies\pj3` 执行；husky pre-commit 会对暂存文件跑 lint 与类型检查。

---

### Task 1: Collapsible 通用折叠组件（TDD）

**Files:**
- Create: `web/src/components/ui/collapsible.tsx`
- Test: `web/src/components/ui/__tests__/collapsible.test.tsx`

- [ ] **Step 1: 写失败的测试**

创建 `web/src/components/ui/__tests__/collapsible.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { Collapsible } from '@/components/ui/collapsible'

describe('Collapsible', () => {
  it('默认展开并渲染内容', () => {
    render(
      <Collapsible trigger={() => <span>标题</span>}>
        <p>正文内容</p>
      </Collapsible>,
    )
    expect(screen.getByText('正文内容')).toBeVisible()
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
  })

  it('defaultOpen=false 时初始收起', () => {
    render(
      <Collapsible defaultOpen={false} trigger={() => <span>标题</span>}>
        <p>正文内容</p>
      </Collapsible>,
    )
    expect(screen.getByText('正文内容')).not.toBeVisible()
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  })

  it('点击触发器切换展开/收起，trigger 收到最新状态', () => {
    render(
      <Collapsible trigger={(open) => <span>{open ? '收起' : '展开'}</span>}>
        <p>正文内容</p>
      </Collapsible>,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('正文内容')).not.toBeVisible()
    expect(screen.getByText('展开')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByText('正文内容')).toBeVisible()
    expect(screen.getByText('收起')).toBeInTheDocument()
  })

  it('受控模式：open prop 生效且点击回调 onOpenChange', () => {
    const onOpenChange = vi.fn()
    function Controlled() {
      const [open, setOpen] = useState(true)
      return (
        <Collapsible
          open={open}
          onOpenChange={(o) => {
            onOpenChange(o)
            setOpen(o)
          }}
          trigger={() => <span>标题</span>}
        >
          <p>正文内容</p>
        </Collapsible>
      )
    }
    render(<Controlled />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.getByText('正文内容')).not.toBeVisible()
  })

  it('aria-controls 指向内容区 id', () => {
    render(
      <Collapsible trigger={() => <span>标题</span>}>
        <p>正文内容</p>
      </Collapsible>,
    )
    const btn = screen.getByRole('button')
    const panelId = btn.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    expect(document.getElementById(panelId as string)).toContainElement(screen.getByText('正文内容'))
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/components/ui/__tests__/collapsible.test.tsx`（在 `web` 目录）
Expected: FAIL，报错为无法解析 `@/components/ui/collapsible`（模块不存在）。

- [ ] **Step 3: 实现最小组件**

创建 `web/src/components/ui/collapsible.tsx`：

```tsx
import { useId, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * 轻量折叠容器（零依赖，替代未安装的 @radix-ui/react-collapsible）。
 *
 * 受控（传 open + onOpenChange）或非受控（defaultOpen）两用；
 * 触发区为整行可点击按钮（render-prop 拿到当前展开态自定义指示器），
 * 内容区收起时以 hidden 隐藏并通过 aria-expanded / aria-controls 关联。
 */
interface CollapsibleProps {
  /** 受控展开状态；不传时由内部管理（配合 defaultOpen） */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** 非受控初始状态，默认展开 */
  defaultOpen?: boolean
  /** 触发区内容（整行可点击），入参为当前展开态 */
  trigger: (open: boolean) => ReactNode
  children: ReactNode
  className?: string
}

export function Collapsible({ open, onOpenChange, defaultOpen = true, trigger, children, className }: CollapsibleProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const isControlled = open !== undefined
  const actualOpen = isControlled ? open : internalOpen
  const panelId = useId()

  const handleToggle = () => {
    const next = !actualOpen
    if (!isControlled) setInternalOpen(next)
    onOpenChange?.(next)
  }

  return (
    <div className={className}>
      <button
        type="button"
        aria-expanded={actualOpen}
        aria-controls={panelId}
        onClick={handleToggle}
        className={cn('w-full text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-ring')}
      >
        {trigger(actualOpen)}
      </button>
      <div id={panelId} hidden={!actualOpen}>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/components/ui/__tests__/collapsible.test.tsx`
Expected: PASS（5 个用例全绿）。

- [ ] **Step 5: 提交**

```powershell
cd d:\flies\pj3; git add web/src/components/ui/collapsible.tsx web/src/components/ui/__tests__/collapsible.test.tsx; git commit -m "feat(web): 新增零依赖 Collapsible 折叠组件"
```

---

### Task 2: 导入质量概览接入折叠（含持久化与收起态摘要）

**Files:**
- Modify: `web/src/pages/data/index.tsx`（约 L1-L40 imports、L78 附近 state、L626-L728 质量概览 Card）

- [ ] **Step 1: 添加 import 与折叠状态**

在 `web/src/pages/data/index.tsx`：

1）lucide-react import 中追加 `ChevronRight`（`ChevronDown` 已有）：

```tsx
import {
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Trash2,
  Archive,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
```

2）追加组件 import（放在 `import { Badge }` 附近）：

```tsx
import { Collapsible } from '@/components/ui/collapsible'
```

3）在 `const [activeTab, setActiveTab] = useState(...)` 之后添加折叠状态（localStorage 读写失败静默降级）：

```tsx
  // 导入质量概览折叠偏好：localStorage 持久化（'1' = 收起），读写失败静默降级为展开
  const QUALITY_COLLAPSED_KEY = 'data-quality-overview-collapsed'
  const [qualityOpen, setQualityOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(QUALITY_COLLAPSED_KEY) !== '1'
    } catch {
      return true
    }
  })
  const handleQualityOpenChange = (open: boolean) => {
    setQualityOpen(open)
    try {
      localStorage.setItem(QUALITY_COLLAPSED_KEY, open ? '0' : '1')
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }
```

- [ ] **Step 2: 质量概览 Card 包入 Collapsible**

将 `<TabsContent value="browse">` 内质量概览 Card 的 `<CardHeader>...</CardHeader>` 与 `<CardContent ...>` 外层改为 Collapsible。**`<CardContent className="space-y-4">` 内的全部现有内容一行不改**，只替换外壳：

原结构（L626-L633 附近）：

```tsx
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <AlertTriangle className="mr-2 h-5 w-5" />
                导入质量概览
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
```

改为：

```tsx
          <Card>
            <Collapsible
              open={qualityOpen}
              onOpenChange={handleQualityOpenChange}
              trigger={(open) => (
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center">
                      <AlertTriangle className="mr-2 h-5 w-5" />
                      导入质量概览
                    </CardTitle>
                    <div className="flex items-center gap-3 text-muted-foreground">
                      {/* 收起态摘要：关键质量数字一瞥（异常 > 0 红色强调） */}
                      {!open && (
                        <span className="font-num text-sm">
                          {qualityStats.batchCount} 批次 · {qualityStats.totalRows} 条 ·{' '}
                          <span className={cn(qualityStats.errorRows > 0 && 'font-medium text-red-700')}>
                            异常 {qualityStats.errorRows}
                          </span>
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-xs">
                        {open ? '收起' : '展开'}
                        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </span>
                    </div>
                  </div>
                </CardHeader>
              )}
            >
              <CardContent className="space-y-4">
```

并把该 CardContent 的闭合处（原 L727-L728 `</CardContent>` 与 `</Card>` 之间）补上 `</Collapsible>`：

```tsx
              </CardContent>
            </Collapsible>
          </Card>
```

注意：CardContent 内部含 Select/Button/DataTable 等交互元素，它们位于 Collapsible 的内容区（普通 div）而非触发按钮内，无嵌套交互元素问题。

- [ ] **Step 3: 类型检查 + 现有测试回归**

Run（`web` 目录）: `npx tsc -b; npm run test`
Expected: 类型检查无错误；全部测试 PASS。

- [ ] **Step 4: 提交**

```powershell
cd d:\flies\pj3; git add web/src/pages/data/index.tsx; git commit -m "feat(web): 导入质量概览支持折叠收起（localStorage 持久化 + 收起态摘要）"
```

---

### Task 3: 交叉表工具栏编辑入口 + 调整对话框挂载

**Files:**
- Modify: `web/src/pages/data/index.tsx`（imports、权限常量、对话框 state、交叉表工具栏 L785-L791 附近、组件末尾对话框挂载）

- [ ] **Step 1: 添加 import、权限常量与对话框状态**

1）追加 import（对话框组件 + 图标）：

```tsx
import { ReclassifyCompanyDialog } from '@/components/reclassify/reclassify-company-dialog'
import { ReclassifySubjectDialog } from '@/components/reclassify/reclassify-subject-dialog'
```

并在 lucide-react import 中追加 `ArrowLeftRight`（加到 `ChevronRight,` 之后）。

2）在权限常量区（`const canApproveMetric = ...` 之后）追加：

```tsx
  const canReclassifyCompany = can('data:reclassify', 'company')
  const canReclassifySubject = can('data:reclassify', 'subject')
```

3）在 `handleQualityOpenChange` 定义之后追加对话框开关状态：

```tsx
  // 数据编辑入口：复用重分类/科目调整通道（校验、预览影响、二次确认、审计留痕均在对话框内）
  const [adjustSubjectOpen, setAdjustSubjectOpen] = useState(false)
  const [reclassifyCompanyOpen, setReclassifyCompanyOpen] = useState(false)
```

4）在 `companyTriggerLabel` useMemo 之后追加预填公司推导（多选恰好 1 家时预填）：

```tsx
  // 编辑对话框预填：公司多选恰好只选 1 家时预填该公司
  const singleBrowseCompany = browseCompanies.length === 1 ? browseCompanies[0] : undefined
```

- [ ] **Step 2: 工具栏按钮改造**

交叉表 Card 工具栏中，将原导出按钮块（L785-L791）：

```tsx
                {canExport && (
                  <Button variant="outline" size="sm" className="ml-auto shrink-0" onClick={handleBrowseExport}>
                    <Download className="mr-2 h-4 w-4" />
                    导出
                  </Button>
                )}
```

替换为右侧按钮组（编辑入口按权限显示 + 原导出按钮）：

```tsx
                <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
                  {canReclassifySubject && (
                    <Button variant="outline" size="sm" onClick={() => setAdjustSubjectOpen(true)}>
                      <ArrowLeftRight className="mr-2 h-4 w-4" />
                      科目调整
                    </Button>
                  )}
                  {canReclassifyCompany && (
                    <Button variant="outline" size="sm" onClick={() => setReclassifyCompanyOpen(true)}>
                      <ArrowLeftRight className="mr-2 h-4 w-4" />
                      跨公司重分类
                    </Button>
                  )}
                  {canExport && (
                    <Button variant="outline" size="sm" onClick={handleBrowseExport}>
                      <Download className="mr-2 h-4 w-4" />
                      导出
                    </Button>
                  )}
                </div>
```

- [ ] **Step 3: 挂载对话框**

在组件返回 JSX 的 `{confirmElement}`（原 L880）之前追加（常驻挂载 + `open` prop，`key` 随上下文变化重挂载以刷新预填默认值——对话框内部以 props 作 useState 初值仅首挂载生效）：

```tsx
      {/* 同公司科目间调整（预填当前指标类型与单选公司） */}
      <ReclassifySubjectDialog
        key={`adjust-${browseSubjectType}-${singleBrowseCompany ?? 'all'}`}
        open={adjustSubjectOpen}
        onClose={() => setAdjustSubjectOpen(false)}
        defaultTemplateType={browseSubjectType}
        defaultCompany={singleBrowseCompany}
      />

      {/* 跨公司重分类（预填当前指标类型与单选源公司） */}
      <ReclassifyCompanyDialog
        key={`reclassify-${browseSubjectType}-${singleBrowseCompany ?? 'all'}`}
        open={reclassifyCompanyOpen}
        onClose={() => setReclassifyCompanyOpen(false)}
        defaultTemplateType={browseSubjectType}
        defaultSourceCompany={singleBrowseCompany}
      />
```

- [ ] **Step 4: 类型检查 + 全量测试**

Run（`web` 目录）: `npx tsc -b; npm run test`
Expected: 类型检查无错误；全部测试 PASS。

- [ ] **Step 5: 提交**

```powershell
cd d:\flies\pj3; git add web/src/pages/data/index.tsx; git commit -m "feat(web): 数据预览交叉表增加科目调整/跨公司重分类编辑入口"
```

---

### Task 4: 浏览器手动验证

**Files:** 无代码改动（验证任务）

- [ ] **Step 1: 启动本地前端**

Run（`web` 目录）: `npm run dev`（后台运行；后端若未启动，在 `server` 目录 `npm run dev`，端口见 `server/.env`）
Expected: Vite dev server 启动（默认 http://localhost:5173）。

- [ ] **Step 2: 验证折叠功能**

登录后进入「数据管理 → 数据预览」：
1. 质量概览默认展开，标题行右侧显示「收起 ▼」；
2. 点击标题行 → 内容收起，指示器变「展开 ▶」，标题右侧出现摘要「N 批次 · N 条 · 异常 N」（4 个统计卡片数值与摘要一致）；
3. 刷新页面 → 保持收起状态（localStorage 生效）；再展开后刷新 → 保持展开。

- [ ] **Step 3: 验证编辑入口**

1. 以拥有 `data:reclassify:*` 权限的账号（如 admin）可见「科目调整」「跨公司重分类」按钮；以 viewer 等无权限账号不可见；
2. 指标类型切到「静态指标」、公司多选只勾 1 家后点开「科目调整」→ 模板类型预填「静态数据」、公司预填所选公司；
3. 执行一笔小额科目调整（填原因）→ 确认后交叉表对应数值自动刷新。

- [ ] **Step 4: 完成后按 finishing-a-development-branch 流程收尾**

---

## Self-Review 记录

- **Spec 覆盖**：折叠组件（Task 1）、质量概览折叠+持久化+摘要（Task 2）、编辑入口+预填+权限门禁+对话框挂载（Task 3）、手动验证（Task 4）——spec 全部需求均有对应任务；「不改动部分」（reclassify 组件、后端、qualityStats 逻辑）计划中均未触碰。✓
- **占位符扫描**：所有代码步骤均给出完整代码与精确锚点行号。✓
- **类型一致性**：`Collapsible` props（open/onOpenChange/defaultOpen/trigger/children/className）在 Task 1 定义与 Task 2 使用一致；`qualityOpen`/`handleQualityOpenChange`、`adjustSubjectOpen`/`reclassifyCompanyOpen`、`singleBrowseCompany` 命名跨任务一致。✓
- 与 spec 的差异：单测路径按项目惯例放 `__tests__` 子目录（spec 写的是同级 `collapsible.test.tsx`），属惯例对齐，不影响设计。
