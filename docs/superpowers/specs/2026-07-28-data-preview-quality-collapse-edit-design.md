# 数据预览页优化设计：导入质量概览折叠 + 预览数据编辑入口

日期：2026-07-28
状态：已确认（用户已批准）

## 背景与目标

数据管理页「数据预览」标签页（`web/src/pages/data/index.tsx`）当前包含两个 Card：

1. **导入质量概览**：4 个质量统计卡片（导入批次 / 总记录数 / 入库记录 / 异常记录）+ 批次选择与激活 + 批次管理表 + 完整性校验提示 + 异常明细表。内容较长，挤压下方交叉表的可视空间。
2. **数据预览交叉表**：指标 × 公司的实时聚合数值，只读展示。

目标：

- 为「导入质量概览」增加可折叠/展开能力，带明确视觉指示器，折叠偏好可持久化；
- 在数据预览界面提供数据编辑入口，复用现有的重分类/科目调整通道（带校验、预览影响、二次确认、审计留痕），不新增后端接口；
- 保持现有质量统计数据展示不变，UI 风格与现有 Card/Tabs/shadcn 组件体系一致。

## 关键决策

| 决策点 | 结论 | 理由 |
| --- | --- | --- |
| 编辑实现方式 | 复用调整通道（用户已确认） | 交叉表数值为后端从事实表实时聚合的派生值（level0 汇总），无单元格对应的单条记录；财务数据修改须走带审计留痕的调整流程。零后端改动。 |
| 折叠组件实现 | 新建轻量 `Collapsible` 组件（纯 React state + Tailwind） | 项目未安装 `@radix-ui/react-collapsible`；本场景无需引入新依赖；放入 `components/ui/` 后其他页面可复用。 |
| 默认状态与持久化 | 默认展开；折叠状态存 `localStorage`（key: `data-quality-overview-collapsed`） | 首次进入完整呈现；刷新后保持用户偏好。 |

## 组件设计

### 1. Collapsible 组件（新建 `web/src/components/ui/collapsible.tsx`）

轻量受控/非受控折叠容器，接口：

```ts
interface CollapsibleProps {
  /** 受控展开状态；不传时内部管理（配合 defaultOpen） */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  defaultOpen?: boolean
  /** 触发区内容（整行可点击） */
  trigger: (open: boolean) => ReactNode
  children: ReactNode
  className?: string
}
```

- 触发区渲染为 `button`（`w-full text-left`），带 `aria-expanded` 与 `aria-controls`；
- 内容区收起时不渲染（或 `hidden`），展开/收起使用项目现有 `transition-colors` 级别的轻量过渡，不引入高度动画库；
- 无第三方依赖。

### 2. 导入质量概览折叠（`web/src/pages/data/index.tsx`）

- CardHeader 整行作为折叠触发器：左侧保持现有 `AlertTriangle` 图标 + 「导入质量概览」标题；右侧新增 ChevronDown（展开时）/ ChevronRight（收起时）图标 + 「收起」/「展开」文字提示；
- **收起态摘要**：标题右侧显示精简摘要文本，如 `12 批次 · 8,432 条 · 异常 3`（异常 > 0 时红色强调），保证收起后关键质量信息仍可一瞥；
- CardContent 内全部现有内容（4 统计卡、批次选择/激活、批次管理表、完整性提示、异常明细）原样置入折叠内容区，**不做任何结构与数据改动**；
- 折叠状态读写 `localStorage`（key: `data-quality-overview-collapsed`，值 `'1'` 表示收起），初始化时读取，切换时写入。

### 3. 数据编辑入口（`web/src/pages/data/index.tsx` 交叉表 Card 工具栏）

- 在交叉表工具栏（导出按钮旁）新增两个按钮：
  - **「科目调整」**：打开现有 `ReclassifySubjectDialog`；权限门禁 `can('data:reclassify', 'subject')`；
  - **「跨公司重分类」**：打开现有 `ReclassifyCompanyDialog`；权限门禁 `can('data:reclassify', 'company')`；
- **上下文预填**：
  - `defaultTemplateType` = 当前 `browseSubjectType`（`operating` | `static`）；
  - 科目调整对话框：若当前公司多选恰好只勾选 1 家（`browseCompanies.length === 1`），预填该公司为 `defaultCompany`；跨公司重分类同理预填 `defaultSourceCompany`；
- 对话框沿用指标页（`web/src/pages/indicators/index.tsx` L372-L386）的挂载模式：常驻挂载 + `open` prop + `onClose` 回调，以 state（`adjustSubjectOpen` / `reclassifyCompanyOpen`）控制开关；并为每个对话框设置 `key`（由 `browseSubjectType` 与预填公司拼接），使上下文变化时重挂载刷新预填默认值（对话框内部 state 以 props 作 useState 初值，仅首挂载生效）；
- **校验与保存**：完全复用对话框内置流程——字段级校验 → 预览影响（preview API）→ 二次确认（danger confirm）→ 执行 → 写 ReclassificationLog + 审计日志；
- **数据刷新**：`useReclassifyCompany` / `useAdjustSubject` 成功后已自动失效 `['data','cross-table']`、`['indicators']`、`['dashboard']` 缓存，交叉表自动刷新，无需额外代码。

## 不改动的部分

- `web/src/components/reclassify/*`（两个对话框已支持 `defaultTemplateType` / `defaultCompany` / `defaultSourceCompany` props，零改动）；
- 后端全部代码；
- 质量统计的计算逻辑（`qualityStats` useMemo）与展示结构。

## 错误处理

- 折叠状态读取 `localStorage` 失败（隐私模式等）时静默降级为默认展开，不抛错；
- 编辑对话框内的错误处理沿用现有 `FeedbackAlert` 机制，本次不改。

## 测试计划

1. **单元测试**（`web/src/components/ui/collapsible.test.tsx`，vitest + testing-library）：
   - 默认展开渲染 children；
   - 点击触发器收起后 children 不可见，`aria-expanded` 正确翻转；
   - 受控模式下 `open` prop 生效且触发 `onOpenChange`；
2. **手动验证**（浏览器）：
   - 折叠/展开交互与视觉指示器；收起态摘要显示正确；
   - 刷新页面后折叠偏好保持；
   - 「科目调整」/「跨公司重分类」按钮按权限显示；打开后模板类型/公司预填正确；
   - 执行一笔调整后交叉表数值自动刷新；
   - `npm run type-check` / 现有测试全部通过。

## 涉及文件清单

| 文件 | 改动类型 |
| --- | --- |
| `web/src/components/ui/collapsible.tsx` | 新建 |
| `web/src/components/ui/collapsible.test.tsx` | 新建（单测） |
| `web/src/pages/data/index.tsx` | 修改：质量概览包折叠容器；交叉表工具栏加两个编辑入口按钮与对话框挂载 |
