# 前端功能适配改造 · 功能对照表（Feature Parity）

> **用途**：本文档是「前端功能适配改造」的逐项走查清单。按 9 大功能域 × 路由页组织，逐页盘点核心功能点、依赖的后端 API 端点与真实接线状态，用于改造过程中逐行核对「mock → 真实」的迁移进度。
>
> **路径约定**：「页面文件」列的路径均相对 `web/` 目录；路由定义见 `web/src/App.tsx`。盘点日期：2026-08-28（交付前静态审计更新版）。

**接线状态图例**：

| 图标 | 含义 |
| --- | --- |
| ❌ mock | 未接真实 API：使用本地 mock 数据（`src/mock/*` 等），或组件已开发但未挂载到路由页 |
| 🔶 部分 | 部分功能已接真实 API，部分仍为 mock 或组件未挂载 |
| ✅ 真实 | 已接真实后端 API，全链可用 |

> **交付审计结论（2026-08-28）**：9 大域全部路由页均已接真实 API；原 ❌/🔶 项全部升级为 ✅，残留缺口见文末「遗留缺口」小节。

---

## 1. 认证 / 登录

| 路由 | 页面文件 | 核心功能点 | 依赖 API 端点 | 写操作(是/否) | 接线状态 |
| --- | --- | --- | --- | --- | --- |
| `/login` | `src/pages/login/index.tsx`；修改密码弹窗 `src/components/layout/change-password-dialog.tsx` | 账密登录、rememberMe 7 天免登、会话过期提示、修改密码弹窗、多标签页令牌协调（auto-login 同步） | `POST /auth/login`、`POST /auth/logout`、`POST /auth/auto-login`、`GET /auth/profile`、`PUT /auth/password`、`POST /auth/refresh` | 是 | ✅ 真实 |

## 2. 看板

| 路由 | 页面文件 | 核心功能点 | 依赖 API 端点 | 写操作(是/否) | 接线状态 |
| --- | --- | --- | --- | --- | --- |
| `/dashboard` | `src/pages/dashboard/index.tsx`（组合 `trend-section` / `receivables-card` / `inventory-pie-card` / `product-budget-card` / `subject-budget-card` / `expense-analysis-card` / `expense-structure-card` / `quick-entries` 等卡片） | KPI 卡、趋势图、品类预算、主体预算、费用分析、应收账款、存货、预警、快捷入口；数据时效条取后端 `lastUpdatedAt` | `GET /dashboard/overview`、`GET /dashboard/receivables`、`GET /dashboard/drill`、`GET /dashboard/trend`、`GET /dashboard/product-budget`、`GET /dashboard/subject-budget`、`GET /dashboard/expense-analysis`、`GET /dashboard/alerts` | 否 | ✅ 真实 |
| `/dashboard/analysis/key-metrics` | `src/pages/dashboard/analysis.tsx`（variant=key-metrics）+ `key-metrics-table.tsx`（`key-metrics-heatmap` / `key-metrics-stat-tiles` / `key-metrics-trend-chart`） | 壹品慧关键指标表：KPI 磁贴（12 月 sparkline）、5×12 月度热力、收入/毛利双折线趋势、关键指标明细表；全部由 `GET /dashboard/analysis/key-metrics` + `GET /dashboard/trend` 派生（无 mock 补位） | `GET /dashboard/analysis/key-metrics`、`GET /dashboard/trend` | 否 | ✅ 真实 |
| `/dashboard/analysis/cash-flow` | `src/pages/dashboard/analysis.tsx`（variant=cash-flow）+ `analysis/cash-flow-content.tsx` | 壹品慧业务现金流分析表（现金流板块四行口径） | `GET /indicators/cashflow` | 否 | ✅ 真实 |
| `/dashboard/analysis/receivable-aging` | `analysis/receivable-aging-content.tsx` | 应收账款账龄分析表（主体分布条 + 8 段账龄汇总 + 主体明细） | `GET /dashboard/receivables`、`GET /transactions/aging` | 否 | ✅ 真实 |
| `/dashboard/analysis/inventory-aging` | `analysis/inventory-aging-content.tsx` | 存货库龄分析表（总额四维 + 公司×品类明细） | `GET /inventory/overview`、`GET /inventory/details` | 否 | ✅ 真实 |
| `/dashboard/analysis/category-budget` | `analysis/category-budget-content.tsx` | 品类预算达成表 | `GET /dashboard/product-budget` | 否 | ✅ 真实 |
| `/dashboard/analysis/subject-budget` | `analysis/subject-budget-content.tsx` | 公司（主体）预算达成表 | `GET /dashboard/subject-budget` | 否 | ✅ 真实 |
| `/dashboard/analysis/expense` | `analysis/expense-content.tsx` | 运营费用分析表 | `GET /dashboard/expense-analysis` | 否 | ✅ 真实 |

## 3. 指标

| 路由 | 页面文件 | 核心功能点 | 依赖 API 端点 | 写操作(是/否) | 接线状态 |
| --- | --- | --- | --- | --- | --- |
| `/indicators/operating` | `src/pages/indicators/index.tsx`（`IndicatorPage`，`indicator-filter-bar.tsx`、`indicators-adapters.ts`、`use-indicator-export.ts`；通用组件 `components/indicators/analysis-drawer.tsx`、`ai-overview-panel.tsx`） | 经营指标：科目树、筛选（公司多选 / 期间 / 重分类排除 / 含停用）、交叉表、分析抽屉、AI 概览 SSE、Excel 导出（前端 ExcelJS，按钮按 `indicators:export` 显隐） | `GET /indicators/operating`、`GET /indicators/tree`、`GET /indicators/periods`、`GET /indicators/:code`、`POST /ai/analyze`（SSE）、`POST /ai/overview`（SSE） | 否 | ✅ 真实 |
| `/indicators/static` | `src/pages/indicators/index.tsx`（subjectType=static） | 静态数据指标：同上 | `GET /indicators/static`、`GET /indicators/tree`、`GET /indicators/periods`、`GET /indicators/:code`、`POST /ai/analyze`（SSE） | 否 | ✅ 真实 |
| `/indicators/cashflow` | `src/pages/indicators/index.tsx`（subjectType=cashflow） | 现金流指标：同上 | `GET /indicators/cashflow`、`GET /indicators/tree`、`GET /indicators/periods`、`GET /indicators/:code` | 否 | ✅ 真实 |

## 4. 数据管理

| 路由 | 页面文件 | 核心功能点 | 依赖 API 端点 | 写操作(是/否) | 接线状态 |
| --- | --- | --- | --- | --- | --- |
| `/data/browse` | `src/pages/data/browse.tsx` | 数据交叉表浏览 + 导出（xlsx/pdf，`can('data','export')` 显隐） | `GET /data/cross-table`、`GET /data/export` | 否 | ✅ 真实 |
| `/data/import` | `src/pages/data/import.tsx`（`import-panel.tsx`、`import-upload-zone.tsx`、`import-batch-panel.tsx`、`import-compare-dialog.tsx`、`use-import-flow.ts`） | 导入全链：上传、多表合并、预览警告、批次管理、模板下载、单批/批量激活（激活前预检确认）、新旧对比、回滚、归档、purge | `/data/imports*`（上传 / 合并上传 / 列表 / 预览 / 合并预览 / 激活 / batch-activate-check / 回滚 / 归档 / purge / 模板 / 对比） | 是 | ✅ 真实 |
| `/data/reclassify` | `src/pages/data/reclassify.tsx`（`reclassify-company-dialog.tsx`、`reclassify-subject-dialog.tsx`、`reclassify-logs-panel.tsx`、`reclassify/budget-adjust-dialog.tsx`、`reclassify/shared.tsx`） | 重分类：跨公司调整、科目内调整、预览确认、日志与冲正 | `/data/reclassify*`（预览 / 提交 / 日志 / 冲正） | 是 | ✅ 真实 |
| `/data/reclassify/consolidation` | `src/pages/data/reclassify/consolidation.tsx`（`consolidation-adjust-dialog.tsx`、`consolidation-adjustments-panel.tsx`） | 汇总抵消调整（共同汇总主体解析 + 新增/删除抵消分录） | `/data/consolidation*`（adjustments CRUD、common-summaries） | 是 | ✅ 真实 |
| `/data/dimensions/:sub`（operating / static / company / summary / formulas） | `src/pages/data/dimensions.tsx`（`components/subject-tree/subject-tree-panel.tsx`、`subject-tree.tsx`、`subject-dialog.tsx`、`metric-tree.tsx`、`components/dimension/company-panel.tsx`、`aggregation-map-panel.tsx`、`formula-maintenance.tsx`、`formula-history-dialog.tsx`） | 科目树 CRUD、公司管理、汇总映射、公式维护（新建/编辑/停用/恢复/试算/版本回滚/依赖分析/审批/类型转换/AI 生成/导出/导入） | `/data/subjects*`、`/data/companies`、`/data/aggregation-map`、`/data/metrics*`、`/ai/formula` | 是 | ✅ 真实 |
| `/data/board/:sub`（category / expense / subject / budget-ratio / product） | `src/pages/data/board.tsx`（`components/dimension/product-category-panel.tsx`、`expense-mapping-panel.tsx`、`subject-budget-panel.tsx`、`budget-ratio-panel.tsx`、`product-config-panel.tsx`） | 5 类配置面板（品类 / 费用映射 / 科目预算 / 预算比例 / 关键指标产品）+ check 校验 | `/data/product-categories*`、`/data/expense-mappings*`、`/data/subject-budget-configs*`、`/data/budget-ratios`、`/data/key-metrics-products*` | 是 | ✅ 真实 |

## 5. 往来

| 路由 | 页面文件 | 核心功能点 | 依赖 API 端点 | 写操作(是/否) | 接线状态 |
| --- | --- | --- | --- | --- | --- |
| `/transactions/overview` | `src/pages/transactions/overview.tsx`（`shared.tsx`、`trend-card.tsx`） | 往来总览：汇总指标、趋势、期间与最新截止期 | `GET /transactions/overview`、`GET /transactions/trend`、`GET /transactions/periods`、`GET /transactions/fiscal-years`、`GET /transactions/latest-cutoff` | 否 | ✅ 真实 |
| `/transactions/aging` | `src/pages/transactions/aging.tsx`（`analysis-drawer.tsx`） | 账龄 10 级分桶、带进度导出、明细分析抽屉 | `GET /transactions/aging`、`GET /transactions/aging/export`（带下载进度）、`GET /transactions/accounts` | 否 | ✅ 真实 |
| `/transactions/coverage` | `src/pages/transactions/coverage.tsx`（`coverage-tab.tsx`、`hooks/use-batch-activate.ts`） | 覆盖矩阵 + 批量激活（激活前预检确认） | `GET /transactions/accounts/manage`、`GET /transactions/import/coverage`、`GET /transactions/import/batches/:id/coverage`、`POST /transactions/import`、`POST /data/imports/batch-activate-check`、`POST /data/imports/:id/activate` | 是 | ✅ 真实 |
| `/transactions/account-filter` | `src/pages/transactions/account-filter.tsx`（`account-filter-tab.tsx`） | 往来科目纳入 / 排除配置 | `GET /transactions/accounts/manage`、`PATCH /transactions/accounts/:code/status` | 是 | ✅ 真实 |
| `/transactions/collections/plans` | `src/pages/transactions/collections/plans.tsx`（`collections-tab.tsx`） | 催收计划：CRUD、状态机流转、操作日志、批量建议（从账龄生成） | `/transactions/collections*`（含 generate / logs）、`GET /transactions/counterparties` | 是 | ✅ 真实 |
| `/transactions/collections/salesmen` | `src/pages/transactions/collections/salesmen.tsx` | 业务员管理（列表 / 新建 / 编辑 / 启停） | `GET /transactions/salesmen/manage`、`POST /transactions/salesmen`、`PATCH /transactions/salesmen/:id(/status)` | 是 | ✅ 真实 |
| —（弹窗，附属往来域；组件挂载于 `/data/import`：`import-panel.tsx`） | `src/pages/data/transaction-import-dialog.tsx`（校验规则 `src/lib/file-validation.ts`） | 往来导入弹窗：多文件 ≤12 / XML / 200MB / 金额单位校验 | `POST /transactions/import/preview`、`POST /transactions/import` | 是 | ✅ 真实 |

## 6. 存货

| 路由 | 页面文件 | 核心功能点 | 依赖 API 端点 | 写操作(是/否) | 接线状态 |
| --- | --- | --- | --- | --- | --- |
| `/inventory` | `src/pages/inventory/index.tsx`（`category-pie-card.tsx`、`category-rank-card.tsx`、`company-share-card.tsx`、`detail-table.tsx`、`trend-card.tsx`；工具 `inventory-utils.ts`） | 四维总览、品类饼图、品类排名、公司占比、明细表（维度切换/搜索/排序/导出/单项分析抽屉）、财年趋势 | `GET /inventory/overview`、`GET /inventory/details`、`GET /inventory/trend` | 否 | ✅ 真实 |

> 注：明细表「按公司汇总」维度的公司级单项分析按钮已移除（原为恒禁用装饰按钮），依赖存货根科目静态树，见「遗留缺口」。

## 7. 报告

| 路由 | 页面文件 | 核心功能点 | 依赖 API 端点 | 写操作(是/否) | 接线状态 |
| --- | --- | --- | --- | --- | --- |
| `/reports` | `src/pages/reports/index.tsx` | 报告列表与 CRUD、状态流转、docx/pdf 导出（`lib/report-export.ts` 生成器） | `/reports/*`（列表 / 新建 / 编辑 / 删除 / 导出） | 是 | ✅ 真实 |
| `/reports/analyses` | `src/pages/reports/analyses.tsx`（`analysis-list.tsx`） | 单项分析：检索、CRUD、恢复（回收站）、批量拉取、RichTextEditor 富文本、AI 润色与 SSE 分析 | `/reports/analyses*`、`POST /ai/polish`（SSE，`hooks/use-ai-stream.ts`）、`POST /ai/analyze`（SSE） | 是 | ✅ 真实 |
| `/reports/:reportId/edit`（别名 `/reports/editor/:reportId`） | `src/pages/reports/report-editor.tsx`（导出 `src/lib/report-export.ts`） | 报告编辑器：AI 章节生成、乐观锁保存、版本管理、回滚、docx/pdf 导出 | `/reports/:reportId*`（保存 / 章节 / 版本 / 回滚 / 导出）、`POST /ai/polish`（SSE） | 是 | ✅ 真实 |

## 8. 权限

| 路由 | 页面文件 | 核心功能点 | 依赖 API 端点 | 写操作(是/否) | 接线状态 |
| --- | --- | --- | --- | --- | --- |
| `/admin/users` | `src/pages/admin/users.tsx`（对话框 `admin/dialogs/user-dialog.tsx`、`reset-password-dialog.tsx`、`password-validation.ts`） | 用户列表、用户 CRUD、purge（输入用户名防呆确认）、重置密码、导出 xlsx | `GET /admin/users`、`GET /admin/users/export`、`POST/PUT/DELETE /admin/users*`、`POST /admin/users/:id/reset-password`、`DELETE /admin/users/:id/purge` | 是 | ✅ 真实 |
| `/admin/roles` | `src/pages/admin/roles.tsx`（对话框 `admin/dialogs/role-dialog.tsx`、`clone-role-dialog.tsx`、`permission-dialog.tsx`、`batch-permission-dialog.tsx`） | 角色 CRUD、克隆、权限矩阵、批量权限（四类对话框均已挂载） | `GET /admin/roles`、`GET /admin/permissions`、`POST/PUT/DELETE /admin/roles*`、`POST /admin/roles/:id/clone`、`PUT /admin/roles/:id/permissions`、`PUT /admin/roles/batch-permissions` | 是 | ✅ 真实 |
| `/admin/audit-logs` | `src/pages/admin/audit-logs.tsx` | 审计日志查询与筛选 | `GET /admin/audit-logs` | 否 | ✅ 真实 |

## 9. 工具

| 路由 | 页面文件 | 核心功能点 | 依赖 API 端点 | 写操作(是/否) | 接线状态 |
| --- | --- | --- | --- | --- | --- |
| `/tools/enterprise-lookup` | `src/pages/tools/enterprise-lookup.tsx` | 企业信息搜索、查询历史 | `GET /tools/enterprise/search`、`GET /tools/enterprise/history` | 否 | ✅ 真实 |

---

## 横切要求

以下要求贯穿全部 9 大域，交付审计逐项核对结果：

1. **空交互清零**：✅ 完成。静态审计清除全部残留占位交互：
   - `key-metrics-table.tsx`：KPI 磁贴 / 热力图 / 趋势图 / 明细表原恒为 mock（MOCK_* 常量），已改为由 `GET /dashboard/analysis/key-metrics` + `GET /dashboard/trend` 真实派生；
   - 看板与经营分析子页数据时效条：删除虚构文案（「已完成 92% 采集 / 数据更新于 8 分钟前」），改用后端 `lastUpdatedAt` / 中性同步说明；
   - `quick-entries.tsx`：「AI 经营洞察」误指 `/__design/antd-style`、「审批中心（待办 3 项）」虚构入口，已改为「单项分析（AI 分析/润色）」与「品类预算达成」真实路由；
   - `inventory/detail-table.tsx`：移除「按公司汇总」维度恒禁用的装饰「分析」按钮；
   - pages/ 下无残留 `MOCK_` 数组、空 `onClick`、`alert()`、`TODO` 占位（`src/mock/*` 仅余 `lib/subject-tree.ts` 引用的科目树结构常量，非页面数据 mock）。
2. **权限显隐**：✅ 完成。菜单与页面入口按权限过滤（`nav-filter.ts` + `RequirePermission`），无权限直链跳转 `/no-access`；本次抽查高危操作显隐全部通过（见第 3 条）。
3. **superadmin 高危操作**：✅ 完成。`admin users purge`（`can('admin:users','purge')` 权限码）、`imports rollback/archive/purge`（`data:import:rollback/archive/purge` 权限码，回滚在对比对话框内二次确认）、`metrics purge/convert`（`role === 'superadmin'` 直判）均仅 superadmin 可见；删除类操作均有二次确认或输入防呆；动作全部落入审计日志（`/admin/audit-logs` 可查）。
4. **4 主题无回归**：✅ 静态审计通过。本次改造涉及页面未发现破坏主题联动的硬编码色（2 处疑似项见「遗留缺口」第 5 条，判定为刻意品牌色/模块色板，不影响 4 主题可读性，未修改）；主题切换后的逐页快照对比仍建议人工复核一遍。
5. **导出可用**：✅ 完成。用户导出（`/admin/users/export` + `downloadBlob`）、导入模板（`/data/imports/template`）、数据浏览导出（`/data/export`）、往来账龄带进度导出（`/transactions/aging/export`）、报告 docx/pdf（`/reports/:id/export` + `report-export.ts`）、公式 JSON 导出/导入（`/data/metrics/formulas/export|import`）全链真实可用；指标导出为前端 ExcelJS 生成（服务端 `/indicators/export` 未接线，见遗留缺口第 1 条）。

---

## 遗留缺口

交付审计后仍存在的已知残留（均为后端能力已就绪、前端按最小改动原则未新增功能页，或属基线范围外）：

1. **`GET /indicators/export` 服务端导出未接线**：指标页导出入口存在（按钮按 `can('indicators','export')` 显隐），但走前端 ExcelJS（`use-indicator-export.ts` → `exportToExcel`，支持列设置/分型格式化），未调用服务端 xlsx 端点（`api.exportIndicators` 方法保留未用）。差异影响：指标导出不产生服务端审计日志。如需统一走服务端导出与审计，后续切换 `api.exportIndicators` 并适配其固定列结构。
2. **`POST /indicators/cross` 无消费页面**：后端「公司×指标×期间」交叉查询已就绪（`api.createCrossTable` 方法保留），基线 28 路由页无对应功能页，本次未新增功能（属查询型端点，无 UI 不影响写操作覆盖）。
3. **`POST /ai/report-summary` 无消费 UI**：后端可按报告章节 SSE 生成「概述草稿」，报告编辑器基线功能清单未含「AI 概述」，本次未新增入口。
4. **存货「按公司汇总」公司级单项分析**：依赖存货根科目静态树（未就绪），原恒禁用按钮已移除；「公司×品类」明细维度的单项分析抽屉不受影响。
5. **疑似硬编码色（仅报告，未修改）**：`pages/tools/enterprise-lookup.tsx` 品牌头卡渐变（`#1677ff → #4096ff`）、`pages/admin/audit-logs.tsx` 模块徽标/状态点 antd 色板（`#1677ff/#52c41a/#fa8c16` 等）。判定为刻意的品牌色与模块色板（类似图标色板常量），4 主题下均可读，不破坏主题联动；如后续要求严格 token 化可再收敛。
