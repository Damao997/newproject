# 数据质量功能合并到数据导入页 — 设计文档

> **版本**: 1.0
> **日期**: 2026-08-14
> **状态**: 已与用户确认（拆分布置：导入覆盖并入导入页、科目过滤上提为往来分析叶子、删除数据质量目录）
> **范围**: 导航结构调整 + import-panel 嵌入往来导入覆盖分区

---

## 1. 背景与目标

现状：
- 数据管理模块的导入面板（`web/src/pages/data/import-panel.tsx`）**已内嵌质量概览分区**（跨批次统计/激活/完整性校验/异常明细，分区二）
- transactions 模块仍保留独立「数据质量」导航目录（`/transactions/quality`），含**导入覆盖**（`/transactions/coverage`）与**科目过滤**（`/transactions/account-filter`）两个子页

目标（用户确认的拆分布置）：
1. **导入覆盖**（往来批次覆盖率矩阵）合并到数据导入页面——作为导入面板的往来专属分区，实现导入面板与数据质量概览的统一展示
2. **科目过滤**（往来科目纳入/排除配置，与导入无关）上提为往来分析模块的叶子导航（与账龄分析平级）
3. 删除 transactions 的「数据质量」目录

---

## 2. 设计决策

### 2.1 组件归属（不移动文件）

`CoverageTab` 组件**保留在** `web/src/pages/transactions/coverage-tab.tsx`（不移动文件——避免跨目录 import 路径大改与 lint 边界风险），由 `import-panel.tsx` 跨模块引用：

```tsx
import { CoverageTab } from '@/pages/transactions/coverage-tab'
```

跨模块引用轻微耦合，换取零移动风险；CoverageTab 内部状态（`pageStateStore.transactions.coverage`）、权限门禁（`canImport`）、草稿激活弹层与 `TransactionImportDialog` 挂载均自洽，嵌入后独立工作。

### 2.2 导入面板第三分区（往来导入覆盖）

`import-panel.tsx` 在分区二（质量概览）之后新增**分区三「往来导入覆盖」**（可折叠，独立折叠偏好 key）：

- 折叠偏好：`localStorage` key `'data-import-coverage-collapsed'`（'1' = 收起，与质量概览模式一致）
- 分区头与收起态摘要：`往来导入覆盖` + 收起态显示覆盖率关键数字（由 CoverageTab 数据派生有难度——**简化：收起态仅显示「往来批次覆盖率矩阵」静态文案**，不派生数据，避免跨组件状态耦合）
- 展开态内容：`<CoverageTab />`（自带筛选卡/统计卡/矩阵卡/草稿激活/导入对话框）

### 2.3 导航结构调整（nav-items.ts）

**往来分析 children**（删除「数据质量」目录）：

```ts
      { path: '/transactions/overview', label: '总览' },
      { path: '/transactions/aging', label: '账龄分析' },
      { path: '/transactions/account-filter', label: '科目过滤' },
      { path: '/transactions/collections/plans', label: '催收计划' },
```

**数据管理 children**：不变（导入覆盖并入导入管理页内部，无新路由）。

### 2.4 路由与旧链接兼容

- `/transactions/coverage` 路由与 `coverage.tsx` 页面**保留**（旧收藏链接/分享链接不破坏），仅导航移除
- `/transactions/account-filter` 路由与页面已存在，导航层级调整后直接可达
- `App.tsx` 的 `LEGACY_TRANSACTION_TABS` 兼容逻辑（含 'coverage'/'account-filter'）不动

### 2.5 权限

- 导入覆盖内嵌后仍由 `CoverageTab` 内部 `can('transactions', 'import')` 门禁控制（数据范围/权限不变）
- 数据导入页本身 `data:import:upload` 门禁不变；往来覆盖分区对无 transactions 权限的用户**隐藏**（在 import-panel 中加 `can('transactions', 'view')` 条件渲染分区三）

---

## 3. 涉及文件清单

**前端**：
- `web/src/components/layout/nav-items.ts`（导航调整）
- `web/src/pages/data/import-panel.tsx`（分区三嵌入 CoverageTab + 折叠偏好）

**无后端改动**；`coverage-tab.tsx`/`account-filter.tsx`/`coverage.tsx`/`App.tsx` 均不动。

---

## 4. 测试要点

- 导航：往来分析下出现「科目过滤」叶子；「数据质量」目录消失；数据管理导航不变
- 导入页：分区三「往来导入覆盖」可折叠/展开、偏好持久化；展开显示覆盖率矩阵（公司/期间/类型、草稿激活、导入按钮）
- 权限：无 transactions:view 用户看不到分区三；有权限用户正常
- 旧链接：`/transactions/coverage` 与 `/transactions/account-filter` 直接访问仍可用
- 回归：导入面板分区一/二功能不变；科目过滤页功能不变
- lint + build

---

## 5. 范围外

- 不移动 coverage-tab.tsx 文件位置
- 不删除旧路由（链接兼容）
- 不改动 CoverageTab 内部逻辑（含草稿激活、导入对话框）
- 不合并分区二与分区三（质量概览与往来覆盖保持独立折叠区，避免 1500 行单文件失控）
