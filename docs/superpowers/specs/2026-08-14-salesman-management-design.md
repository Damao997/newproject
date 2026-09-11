# 业务员管理模块 — 设计文档

> **版本**: 1.0
> **日期**: 2026-08-14
> **状态**: 已与用户确认（软删除策略 / 催收计划页入口 / 新增 salesmen 资源码）
> **范围**: 业务员（Salesman）独立管理页面 + 后端管理接口 + 权限资源扩展

---

## 1. 背景与目标

业务员数据当前通过 `CustomerExt` 与 `CollectionPlan` 表的 salesmanId 引用维护，仅能在催收计划页抽屉中新建/选择，缺少独立的查看、编辑、停用管理入口。本模块提供完整的业务员管理能力。

**用户已确认的决策**：
- **软删除为主**：Salesman 表新增 `status`（active/inactive），停用保留历史关联引用
- **入口**：催收计划页内提供「业务员管理」入口（不新增独立导航菜单）
- **权限**：新增三段式资源码 `transactions:salesmen:view/create/update/delete`，角色继承 transactions 权限范围

---

## 2. 数据模型（软删除）

`server/prisma/schema.prisma` 的 `model Salesman`（5.3a）扩展：

```prisma
model Salesman {
  id          String       @id @default(uuid())
  companyCode String       @map("company_code")
  name        String
  phone       String?
  remark      String?
  status      RecordStatus @default(active)   // active / inactive（停用）
  createdAt   DateTime     @default(now()) @map("created_at")

  @@index([companyCode])
  @@index([status])
  @@map("salesman")
}
```

迁移：`npx prisma migrate dev --name salesman_status` + `prisma generate`。

**关联数据处理策略（软删除核心）**：
- 停用**不清空** `customer_ext.salesmanId` / `collection_plan.salesmanId` 引用——历史催收计划与台账扩展数据完整保留（B 端最佳实践：软删除保历史）
- 选项接口（催收计划页「选择现有业务员」）**只返回 active**——停用业务员不再可选，避免新业务误挂
- 历史关联行显示原业务员姓名（不因停用丢失）

---

## 3. 后端接口（CollectionService 扩展 + 路由）

| 接口 | 说明 | 权限（迁移后） |
|------|------|------|
| `GET /transactions/salesmen`（改造） | 选项列表：仅 active + 按公司过滤（现状契约叠加 status 过滤） | transactions:salesmen:view |
| `GET /transactions/salesmen/manage`（新增） | 管理列表：分页 + 姓名/电话关键词 + 公司筛选 + 状态筛选（active/inactive/all，默认 active） | transactions:salesmen:view |
| `POST /transactions/salesmen`（改造） | 新增（现状校验保留：姓名必填 ≤50、电话 ≤30、审计） | transactions:salesmen:create |
| `PATCH /transactions/salesmen/:id`（新增） | 编辑：name/phone/remark（**companyCode 不可改**——防止历史关联语义漂移） | transactions:salesmen:update |
| `PATCH /transactions/salesmen/:id/status`（新增） | 停用/启用切换（status 校验、审计） | transactions:salesmen:update |

**服务方法**（`CollectionService` 内扩展，或独立 `SalesmanService`——**决策：扩展 CollectionService**（业务员与催收强相关，现有 listSalesmen/createSalesman 已在此））：

```ts
// 改造：选项列表仅 active
async listSalesmen(params: { companyCodes?: string[] }) {
  const where: Record<string, unknown> = { status: 'active' }
  if (params.companyCodes) where.companyCode = { in: params.companyCodes }
  ...
}

// 新增：管理列表（分页/关键词/状态筛选）
async listSalesmenManage(params: { companyCodes?: string[]; keyword?: string; status?: string; page?: number; pageSize?: number }) {
  // where: companyCode 过滤 + (name/phone contains keyword) + status 过滤（''|'all' 不过滤）
  // 返回 { items, total, page, pageSize, totalPages }
}

// 新增：编辑（name/phone/remark，companyCode 拒绝变更——body 含 companyCode 且与现有一致时忽略，不一致报错）
async updateSalesman(id: string, patch: { name?: string; phone?: string; remark?: string }, ctx: Ctx) { ... }

// 新增：停用/启用
async setSalesmanStatus(id: string, status: 'active' | 'inactive', ctx: Ctx) { ... }
```

**路由**（`server/src/routes/transactions.ts` 业务员段落）：

```ts
router.get('/salesmen/manage', requirePermission('transactions:salesmen', 'view'), ...)   // 注意：注册在 /salesmen 之前（Express 精确匹配不受影响，但保持顺序清晰）
router.patch('/salesmen/:id', requirePermission('transactions:salesmen', 'update'), ...)
router.patch('/salesmen/:id/status', requirePermission('transactions:salesmen', 'update'), ...)
// 既有 GET/POST /salesmen 的权限从 transactions:view/update 迁移为 transactions:salesmen:view/create
```

**路由冲突检查**：`PATCH /salesmen/:id`（2 段）与 `PATCH /salesmen/:id/status`（3 段）不冲突；`GET /salesmen/manage` 与 `GET /salesmen` 字面量不同不冲突。`/salesmen/manage` 需注册在 `PATCH /salesmen/:id` 之前（Express 按注册顺序，`GET /salesmen/manage` 与方法无关——GET 与 PATCH 不冲突；但保持先 manage 后 :id 的顺序更清晰）。

**权限后端来源**：`requirePermission` 查 `prisma.permission` 表——新增资源码需同步 **seed 权限初始化**（`server/prisma/seed.ts` 的角色权限配置，与前端矩阵对应；确认 seed 中权限码清单并补充）。

---

## 4. 前端设计

### 4.1 入口（催收计划页）

`web/src/pages/transactions/collections-tab.tsx` 筛选卡操作区（搜索框之后）新增按钮：

```tsx
{canViewSalesmen && (
  <Button variant="outline" size="sm" onClick={() => navigate('/transactions/collections/salesmen')}>
    <Users className="mr-1 h-4 w-4" />
    业务员管理
  </Button>
)}
```

- `canViewSalesmen = can('transactions:salesmen', 'view')`（usePermission 支持三段式 resource——确认 usePermission 的 can 签名：`can(resource, action)` 拼接 `resource:action`）
- `useNavigate` 跳转独立页面

### 4.2 独立页面 `web/src/pages/transactions/collections/salesmen.tsx`

路由注册（`web/src/App.tsx`）：`/transactions/collections/salesmen`，`RequirePermission resource="transactions:salesmen" action="view"`（确认 RequirePermission 支持三段式——若只支持两段式，改为 resource="transactions" 自定义守卫，实现时以组件签名为准）。

**页面结构**（遵循项目卡片化规范）：
- **筛选卡**：公司（CompanySelect）+ 状态（全部/启用/停用 Select）+ 搜索（姓名/电话 Input w-[200px]）→ 右侧「新增业务员」按钮（salesmen:create 门禁）
- **列表卡**（DataTable，density="compact"）：
  - 列：姓名 | 联系方式 | 所属公司（getDisplayName）| 备注 | 状态（启用 `bg-success/10 text-success-strong` / 停用 `bg-muted text-muted-foreground` 胶囊）| 创建时间（日期）| 操作（编辑 / 停用·启用，ghost 文字按钮 + `useConfirm` 二次确认）
- **分页**：表格卡底部 border-t 行（项目规范）
- **空态**：无业务员时「暂无业务员数据」

**表单抽屉**（SheetShell，max-w-md）：
- 新增态：公司（CompanySelect 单选，必选）+ 姓名（必填）+ 联系方式 + 备注
- 编辑态：公司只读展示（不可改）+ 姓名 + 联系方式 + 备注
- Label htmlFor/id 关联、FlashMessage 反馈（项目无障碍规范）

**状态持久化**：页面筛选（公司/状态/关键词/分页）持久化到 `pageStateStore`——新增 `transactions.salesmen` tab 状态（`setTransactionsTab('salesmen', ...)` 泛型支持任意 key）。

### 4.3 权限矩阵（`web/src/lib/permissions.ts`）

`transactions:salesmen:view/create/update/delete` 加入角色（**继承规则：salesmen 动作跟随 transactions 动作授予**）：

| 角色 | transactions 权限 | salesmen 新增 |
|------|------------------|--------------|
| superadmin/admin | 全量（ADMIN_PERMISSIONS） | view/create/update/delete |
| finance_manager | view/create/update/export（无 delete） | view/create/update |
| department_manager | view/create/update/export | view/create/update |
| finance_analyst_it | view/create/update/delete/import/export | view/create/update/delete |
| viewer | 无 transactions | 无 |

同步 `server/prisma/seed.ts` 权限种子（如 seed 中按角色配置权限码）。

### 4.4 类型与 hooks

- `web/src/types/index.ts`：`SalesmanItem` 增加 `status: 'active' | 'inactive'`；新增 `SalesmanListResponse = PaginatedResponse<SalesmanItem>`
- `web/src/lib/api.ts`：`getSalesmenManage(params)`、`updateSalesman(id, data)`、`setSalesmanStatus(id, status)`
- `web/src/hooks/api-queries.ts`：`useSalesmenManage(params)`、`useUpdateSalesman()`、`useSetSalesmanStatus()`（onSuccess invalidate `['transactions','salesmen']` 前缀——覆盖选项与管理列表）

---

## 5. 测试要点

**后端**（TDD，扩展 `CollectionService.test.ts` 或新建 `SalesmanService.test.ts`——**决策：扩展 CollectionService.test.ts**，业务员相关用例集中）：
- listSalesmen 仅返回 active（停用后选项接口不可见）
- listSalesmenManage：分页/关键词（姓名/电话）/状态筛选/公司过滤
- updateSalesman：姓名必填/超长校验、companyCode 变更拒绝
- setSalesmanStatus：合法状态切换、非法状态报错、停用后关联引用保留（customer_ext/collection_plan 的 salesmanId 不清空）
- 权限/审计：写操作 recordAudit

**前端**：lint + build；手动验证（入口门禁、页面筛选/表单/停用流、权限矩阵）

---

## 6. 涉及文件清单

**后端**：
- `server/prisma/schema.prisma` + migration（Salesman.status + status 索引）
- `server/prisma/seed.ts`（权限种子补充 salesmen 码——若 seed 含权限初始化）
- `server/src/services/CollectionService.ts`（listSalesmen 改造 + 3 个新方法）
- `server/src/routes/transactions.ts`（3 条新路由 + 2 条既有路由权限迁移）

**前端**：
- `web/src/types/index.ts`（SalesmanItem.status、SalesmanListResponse）
- `web/src/lib/api.ts`（3 个新方法）
- `web/src/hooks/api-queries.ts`（3 个新 hook）
- `web/src/lib/permissions.ts`（4 角色矩阵补充）
- `web/src/stores/pageStateStore.ts`（transactions.salesmen 状态）
- `web/src/App.tsx`（路由注册）
- `web/src/pages/transactions/collections/salesmen.tsx`（新页面）
- `web/src/pages/transactions/collections-tab.tsx`（入口按钮）

---

## 7. 范围外

- 不提供物理删除（软删除为主，YAGNI；如需高危删除后续迭代）
- 不允许修改业务员所属公司（历史关联语义保护）
- 不新增独立导航菜单（入口在催收计划页）
- 不改造既有催收计划/台账页的业务员显示逻辑（停用后历史引用正常显示）
