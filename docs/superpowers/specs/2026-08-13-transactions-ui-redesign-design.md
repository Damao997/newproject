# 往来分析模块 UI 优化 — 设计文档

> **版本**: 1.0
> **日期**: 2026-08-13
> **状态**: 已与用户逐节确认（视觉伴侣 mockup 驱动）
> **范围**: transactions 模块 5 处页面/组件 UI/UX 优化 + 催收计划页后端扩展

---

## 1. 背景与目标

内部往来模块（transactions）存在以下体验问题：

- **总览六大类型卡片**：仅显示期末余额大数字，信息密度低，无账龄结构与风险提示
- **账龄分析**：9 个筛选/操作控件挤在一行，8 段账龄数字无风险视觉引导
- **分析抽屉**：9 个账龄快照 chip 用 3 列网格平铺，拥挤且无层次
- **科目过滤**：说明文字占用空间，分组无统计，状态点含义不直观
- **催收管理**：无状态总览、逾期金额无视觉层级、分页独立成卡、对话框无障碍不达标

**目标**：在保持项目现有设计体系（Radix + Shadcn + Tailwind + Design Token，见 `docs/plans/frontend-design-proposal.md` v3.6）的前提下，逐页优化信息层级、交互方式与视觉呈现，不改变业务口径与权限模型。

**约束（用户已确认）**：按项目现有规范执行（antd 仅限 ProTable，禁止在其他文件 import antd）；配色一律 Design Token 类名，禁止硬编码 hex（`chart-theme.ts` 为唯一 hex 来源）；数字一律 `font-num`。

---

## 2. 总览页 · 六大往来类型卡片（A+B 组合）

### 2.1 卡片结构（自上而下）

| 层 | 内容 | 数据来源 |
|----|------|----------|
| 标题行 | 类型名 + 左侧 4px 语义色竖条（AR=info 蓝 / AP=destructive 红，替代原右上角 AR/AP 徽标） | `transactionType` + `direction` |
| 大数字 | 期末余额（万，`font-num`，`text-2xl font-bold`） | `totalClosingBalance` |
| 账龄堆叠条 | 8 段圆角堆叠条，颜色随账龄渐深：1个月/2个月=success 系、3个月/4-6月=info 系、半年以上/1年至2年=warning 系、2年至3年/3年以上=destructive 系（同系两段用不同深浅/透明度区分） | `aging`（8 段，单位元，占比 = 段值/期末余额） |
| 占比摘要行 | `1年内 X% · 1-3年 Y% · 3年+ Z%`（3年+ 占比按风险档着色） | `aging` 聚合 |
| 信息行 | 较期初变动率（红涨绿跌，`getChangeColor` 语义）+ 总笔数 + 内/外笔数 | `totalOpeningBalance`→变动率、`recordCount`、`internalCount/externalCount` |
| 风险提示行 | 圆点 + 文案，按 3年+ 占比分档 | `aging` |

### 2.2 风险提示分档规则

- 3年+ 占比 **> 20%**：红（`text-destructive`）+ 文案「3 年以上账龄占 X%，存在高逾期风险」
- 3年+ 占比 **5%~20%**：黄（`text-warning-strong`）+ 文案「X 年以上账龄占 Y%，建议关注回收」（取账龄最大且占比 ≥5% 的非 1 年内段作为提示段）
- 3年+ 占比 **< 5%**：绿（`text-success-strong`）+ 文案「账龄结构良好，1 年内占 X%」
- **零余额卡**：显示「暂无余额」灰态（`text-muted-foreground`），不渲染堆叠条与信息行，不可点击

### 2.3 交互

- 整卡可点击 → 跳转 `/transactions/aging` 并预选该往来类型（`pageStateStore` 写入 `aging.type`）
- 堆叠条各段 title/Tooltip 显示段名 + 金额（万）
- 无期初数据（`totalOpeningBalance` 为 0）时隐藏「较期初」项
- 变动率计算：`(closing - opening) / |opening|`，opening 为 0 时隐藏

### 2.4 实现要点

- 复用现有 `Card` 基类（`rounded-card`、白底细边框），不新增全局组件
- 金额单位沿用现有 `formatAmount`（元→万 + 小字号「万」后缀）
- 现状 `overview.tsx` 中 KPI 三卡与趋势图不动

---

## 3. 账龄分析页（方案 A：筛选分区 + 表格风险着色）

### 3.1 筛选卡两行布局

**行 1（核心筛选 + 高频操作）**：公司（`CompanySelect`）· 期间 · 往来类型 · 分组方式 → 右侧（`ml-auto`）：导出 Excel · 撰写单项分析 · 查看分析

**行 2（明细筛选）**：以顶部虚线分隔（`border-t border-dashed` + `pt-3`），行首小标签「明细筛选」（`text-xs text-muted-foreground` 胶囊），内容：科目（`AccountMultiSelect`）· 对象类型（`PartyTypeSelect`）· 搜索往来对象（`Input w-[200px]`）· 仅显示小计（`Switch`）

- 两行均为 `flex flex-wrap items-center gap-3`，小屏自动换行
- 筛选卡维持 `Card rounded-card p-4`
- 「仅显示小计」开关仍与行 1 控件同页同状态（`pageStateStore` 持久化不变）

### 3.2 表格风险着色

- 账龄 8 段数值列按段位加**浅色底**：1个月/2个月 `bg-success/[0.06]`、3个月/4-6月 `bg-info/[0.06]`、半年以上/1年至2年 `bg-warning/[0.08]`、2年至3年/3年以上 `bg-destructive/[0.06]`；0 值显示「-」且不着色
- **3年以上列**非零值：`text-destructive font-medium`
- 期末余额列保持 `font-num font-medium`（不添色）
- 小计行 `bg-muted/50`、合计行 `bg-primary/5` 维持现状；表头 `bg-muted/50 text-black` 居中维持
- 着色仅作用于数据行；「仅显示小计」时数据行隐藏，着色逻辑不受影响

### 3.3 其他

- 表格卡头（`border-b px-4 py-2.5`）行统计「共 N 行」维持
- 导出参数与行为不变
- 账龄明细（按往来对象分组）即现有 `groupBy='counterparty'` 视图，交互不变，受益于筛选分区与着色

---

## 4. 分析抽屉（方案 B：可折叠快照）

文件：`web/src/pages/transactions/analysis-drawer.tsx`，外壳沿用 `SheetShell`（max-w-xl 不变）。

### 4.1 快照区重设计

**默认态（折叠）**，容器为 `rounded-md border bg-muted/30 p-3`：
- 第一行：`期末余额` 小标签 + 右侧大数字（`text-lg font-bold font-num`，万）
- 账龄堆叠条（同 §2.1 的 8 段渐深色条，`h-1.5`）
- 三段占比行：`1年内 X% · 1-3年 Y% · 3年+ Z%`（3年+ 按档着色）
- 底部居中「展开账龄明细」按钮（`Button variant="ghost" size="sm"`，`ChevronDown` 图标 + 文字）

**展开态**：8 段账龄改为 **4 列 × 2 行** 紧凑网格（替代原 grid-cols-3 的 9 chip 布局）：
- 每格：段名（`text-[10px] text-muted-foreground`）+ 金额（`font-num text-xs`）
- **3年以上格**：边框与文字 `destructive` 系强调（`border-destructive/30 text-destructive`）
- 段格顺序固定 `AGING_GROUPS`；金额为 0 的段显示「-」
- 展开/折叠为组件内 `useState`，切换 target 重挂载时重置为折叠

### 4.2 选择器区

- 公司 + 往来类型两个 `Select` 保持现有实现（h-8），无布局改动
- 无快照数据时的提示文案「该公司在 X 无 Y 数据（仍可撰写分析）」维持

### 4.3 表单区与底部

- 标题 Input、富文本编辑器、删除/取消/保存按钮维持现状
- `ContextChip` 组件不再用于往来抽屉（指标抽屉仍可用），不改动组件本身

---

## 5. 科目过滤页（方案 A：分组统计 + 搜索 + 图例）

文件：`web/src/pages/transactions/account-filter-tab.tsx`。

### 5.1 头部区

- 原长说明文字（「点击标签即可排除/恢复…」段落）**移除**，要点收进标题旁 Info 图标 + Tooltip（`PageContainer`/卡头内实现，文案保留原意）
- 头部统计维持：已纳入 N · 已排除 M
- 头部右侧新增**搜索框**（`Input h-8 w-[180px]`，placeholder「搜索科目…」）：前端过滤，匹配 `name`/`code`（含去前缀后的 displayName），为空显示全部

### 5.2 分组区

- 每组类型标题行右侧新增计数徽章：`纳入 X · 排除 Y`（`text-[10px] bg-muted rounded px-1.5 py-0.5 text-muted-foreground`）
- 标签样式维持：纳入 = 白底描边 + 绿点（有数据）/ 灰点（无数据）、排除 = 灰底划线 + 黄点
- 组标题与计数徽章仅在 `showAll` 展开时显示计数徽章同样有效（统计基于全部科目，不随展开收敛）

### 5.3 底部

- 「显示全部 N 个科目 / 收起无数据科目」按钮维持
- 新增**图例行**（`text-[10px] text-muted-foreground`，border-t 分隔）：`● 有数据`（success）· `● 已排除`（warning）· `○ 暂无数据`（灰点描边）
- 权限逻辑（`canUpdate`）与 `useUpdateAccountStatus` 调用不变

---

## 6. 催收计划页重构（含后端扩展）

文件：`web/src/pages/transactions/collections-tab.tsx`（页面入口 `collections/plans.tsx` 标题「催收计划」已符合，无需改；Tab 挂载处与导航文案从「催收管理」统一为「催收计划」，核对 `nav-items`/菜单文案）。

### 6.1 数据模型扩展（Prisma + migration）

`server/prisma/schema.prisma`：

```prisma
// 6.1.1 新增业务员表
model Salesman {
  id          String   @id @default(uuid())
  companyCode String   @map("company_code")
  name        String
  phone       String?  @map("phone")
  remark      String?
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([companyCode])
  @@map("salesman")
}

// 6.1.2 CollectionPlan 新增字段
model CollectionPlan {
  // ...现有字段不变
  billedUncollectedAmount Decimal?  @map("billed_uncollected_amount") @db.Decimal(18, 2) // 已开票未收款金额
  salesmanId              String?   @map("salesman_id")                                    // 业务员
  statusNote              String?   @map("status_note")                                    // 最近一次状态变更说明
  // ...
}
```

- 迁移：`npx prisma migrate dev --name collection-plan-extend`（命名以实际为准）
- 业务员数据范围：按 `companyCode` 归属，创建/查询均校验公司权限（沿用 `normalizeCompanies` 模式）
- 审计：业务员创建/更新、计划字段更新均走 `recordAudit`

### 6.2 后端 API 扩展（`CollectionService` + `routes/transactions.ts`）

| 接口 | 说明 |
|------|------|
| `GET /transactions/salesmen?companyCode=` | 业务员选项列表（按公司过滤，权限 transactions:view） |
| `POST /transactions/salesmen` | 新建业务员（name 必填、phone 选填，权限 transactions:update） |
| `PATCH /collections/:id` | 扩展字段：`billedUncollectedAmount`（≥0 校验）、`salesmanId`（存在性 + 公司匹配校验）、`statusNote`（随 status 变更时更新，字符串，≤500 字）、`plannedDate`（已支持） |
| `GET /transactions/counterparties?companyCode=&keyword=&transactionType=应收账款` | 客商选项（从账龄/明细数据 distinct 聚合，支持关键词 LIKE，供编辑抽屉选择） |

- `create` 接口保持现有字段不变（不新增新建计划 UI，但接口兼容新字段无副作用）
- `update` 中 `overdueAmount` **不可改**（保持只读，不加入 patch 白名单——现状已如此，需确认前端不传该字段）
- DTO 扩展：`CollectionPlanItem` 增加 `billedUncollectedAmount`、`salesmanName`（join 查询）、`statusNote`

### 6.3 表格列（DataTable）

| 列 | 渲染要点 |
|----|----------|
| 公司 | 现有 `getDisplayName` |
| 客商 | 现有名称 + 编码双行 |
| 科目 | 现有 |
| **金额**（原「逾期金额」更名） | `font-num` 右对齐；**分级着色**：≥100万 `text-destructive font-semibold`、≥10万 `text-warning-strong`、其余默认；**只读不可编辑** |
| **已开票未收款金额**（新） | `font-num` 右对齐；**hover 显示「编辑」文字按钮**，点击打开抽屉式编辑（见 6.4） |
| **业务员**（新） | 显示 `salesmanName`（无则「-」）；**hover 显示「编辑」文字按钮**，点击打开抽屉式编辑（见 6.4） |
| 计划日期 | `plannedDate`；**已过期且状态非 full/bad_debt** 时 `text-destructive font-medium`（日期 < 今天）；title 提示「已逾期」 |
| 方式 / 实际回收 | 现有 |
| 状态 | 现有胶囊（`STATUS_STYLES`）不变；`title` 附加 `statusNote` |
| 操作 | **hover 显示文字按钮**：「更新」= 状态更新对话框；「记录」= 催收记录对话框（均从现有 ghost 图标/文字按钮改为 hover 浮现） |

### 6.4 交互细节

**hover 按钮模式**（整页统一）：
- 单元格 hover（`group` 容器 + `group-hover:visible`）显示文字按钮（`Button variant="ghost" size="sm" h-7 px-2 text-xs`，纯文字「编辑」/「更新」）
- 非 hover 时按钮 `invisible`（保留占位不跳动）；无权限时不渲染
- 与 DataTable `rowClassName`/`cellClassName` 机制兼容（DataTable 列 `render` 内实现，无需改 DataTable 组件）

**已开票未收款金额编辑抽屉**：
- 触发：表格该单元格 hover「编辑」或点击数值本身
- 抽屉内容（`SheetShell` 复用，`max-w-md`）：标题「编辑已开票未收款金额」+ 副标题（公司 · 客商 · 科目）；`Label` + `Input type="number"`（默认值与 `overdueAmount`（金额）一致）；底部「取消 / 保存」（保存走 `PATCH /collections/:id` 的 `billedUncollectedAmount`，FlashMessage 反馈）

**业务员编辑抽屉**：
- 触发：表格该单元格 hover「编辑」
- 抽屉内容（`SheetShell`，`max-w-md`）：标题「业务员」+ 副标题（公司）；两段：
  - 「选择现有业务员」：`Select` 列出 `GET /transactions/salesmen` 选项（显示 姓名 + 电话）
  - 「新建业务员」区：**常驻两行输入**（姓名必填 + 联系方式选填）+「添加」按钮 → `POST /transactions/salesmen` 成功后自动选中并清空输入
  - 底部「取消 / 保存」→ `PATCH /collections/:id` 的 `salesmanId`
- 无 `transactions:update` 权限时：抽屉只读（隐藏编辑控件），仍可查看

**状态更新对话框**（现有 `UpdateStatusDialog` 增强）：
- 新增「催收状态说明」`Label` + `Textarea`（≤500 字，选填），随状态/实际回收金额一起 `PATCH` 提交（`statusNote`）
- 修复无障碍：现有 `<label>` 改为 `Label htmlFor` + 控件 `id` 关联（新状态 Select、实际回收金额 Input、状态说明 Textarea）
- 状态流转规则（`STATUS_TRANSITIONS`）不变

**催收记录对话框**：`Label` 关联修复（Textarea），其余不变

### 6.5 状态统计条 + 筛选卡

- 筛选卡内新增**状态统计条**（筛选行下方 `border-t border-dashed pt-2`）：五状态 `● 待催收 N · ● 催收中 N · ● 部分回收 N · ● 全额回收 N · ● 坏账 N` + 右侧「逾期合计 X 万」（红色 `font-num`）
- 点击状态项 → 设置 `statusFilter` 并 `setPage(1)`（与现有状态下拉联动：点击统计条后下拉同步显示该状态，均有「全部状态」复位入口）
- 统计来源：新增 `GET /collections/stats?companyCode=`（返回各状态计数 + 金额合计），或列表接口返回 `stats` 字段（**决策：列表响应体 `data` 增加 `stats` 字段**，随分页查询一起返回，避免额外请求）
- 「生成催收建议」按钮维持（权限 `transactions:create`）

### 6.6 分页

- 分页从独立卡移入**表格卡底部 border-t 行**：`flex items-center justify-between px-4 py-2.5 border-t`，左侧「共 N 条」、右侧 `Pagination`（现有组件）
- 空数据时不渲染分页行；「暂无催收计划」空态文案维持

---

## 7. 无障碍与规范符合性（全模块）

- 所有对话框表单：`Label htmlFor` + 控件 `id`（新状态 Select、实际回收金额、状态说明、业务员姓名/电话、已开票金额）
- 纯图标/文字 hover 按钮补 `aria-label`（「编辑已开票金额」「编辑业务员」「更新状态」等）
- 颜色一律 Design Token 类名（`text-destructive`/`text-warning-strong`/`text-success-strong` 及 `/10`、`/15` 透明度变体），禁止 hex 与 Tailwind 调色板类
- 数字一律 `font-num`；表头居中、`bg-muted/50 text-black` 维持
- 金额单位统一「万」（数据域存元，展示层除以 10000，沿用 `formatAmount`/`formatMoneyWan`）
- 卡片化布局维持：筛选卡 `rounded-card p-4`、表格卡 `rounded-card overflow-hidden` 卡头 `border-b px-4 py-2.5`
- 权限：所有新按钮按 `usePermission` 门禁（view/create/update/export 语义与现状一致）；后端接口权限标注见 §6.2

---

## 8. 范围外（本次不做）

- 内部往来页（internal.tsx）、导入覆盖页（coverage-tab.tsx）不改造
- 总览 KPI 三卡与趋势图不改造
- 催收计划「手动新建」入口不做（用户已确认）
- 指标分析抽屉（indicators）不动（仅确认 `ContextChip` 共用组件不受影响）
- 不引入 antd 组件；不改动 DataTable/SheetShell 等共享组件本体

---

## 9. 测试要点

- 总览卡片：零余额卡灰态、风险分档三色、无期初隐藏变动率、点击钻取预选类型（`pageStateStore` 联动）
- 账龄页：筛选两行布局小屏换行、表格着色在「仅显示小计」时正确隐藏、3年以上列强调
- 分析抽屉：折叠/展开切换、target 切换重挂载回折叠态、无快照提示
- 科目过滤：搜索过滤、计数徽章、图例、展开/收起与搜索共存
- 催收计划：
  - 后端单测：`billedUncollectedAmount` ≥0 校验、`salesmanId` 公司匹配校验、`statusNote` 随状态变更、`overdueAmount` 不可改（patch 白名单拒绝）
  - 权限：无 update 权限时 hover 按钮不出现、抽屉只读
  - 前端：状态统计条过滤联动、金额分级着色边界（=100万、=10万）、日期逾期判定（今天不标红）、分页入卡、hover 按钮可见性
  - 无障碍：三个对话框 Label 关联（可 lint/axe 抽查）
- 回归：生成催收建议、催收记录、导出 Excel、审计日志

---

## 10. 涉及文件清单

**前端**：
- `web/src/pages/transactions/overview.tsx`（六大类型卡片）
- `web/src/pages/transactions/aging.tsx`（筛选分区 + 着色）
- `web/src/pages/transactions/analysis-drawer.tsx`（可折叠快照）
- `web/src/pages/transactions/account-filter-tab.tsx`（搜索 + 徽章 + 图例）
- `web/src/pages/transactions/collections-tab.tsx`（重构）
- `web/src/pages/transactions/shared.tsx`（如提取账龄堆叠条/风险分档等局部共用，视实现）
- `web/src/types/index.ts`（CollectionPlanItem 类型扩展）

**后端**：
- `server/prisma/schema.prisma` + migration（Salesman 表、CollectionPlan 三字段）
- `server/src/services/CollectionService.ts`（update 扩展、stats、salesmen、counterparties）
- `server/src/routes/transactions.ts`（新路由）
- `server/src/types` / DTO 对应处

---

*设计文档由视觉伴侣 mockup 逐节确认后定稿。*
