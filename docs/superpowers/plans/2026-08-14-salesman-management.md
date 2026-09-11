# 业务员管理模块 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现业务员（Salesman）独立管理模块：软删除（status 停用）、管理列表（分页/搜索/公司/状态筛选）、新增/编辑/停用表单与操作、催收计划页入口、独立权限资源码。

**Architecture:** 后端扩展 `CollectionService`（业务员与催收强相关）：`listSalesmen` 改造为仅 active 选项、新增 `listSalesmenManage`/`updateSalesman`/`setSalesmanStatus`；Salesman 表新增 `status` 字段（软删除）；权限新增三段式资源码 `transactions:salesmen:*`（前端矩阵 + seed 权限清单 + requirePermission 同步）。前端新增独立页面 `/transactions/collections/salesmen`（卡片化列表 + SheetShell 表单抽屉），入口按钮放催收计划页筛选卡。

**Tech Stack:** Node + Express + Prisma + PostgreSQL；React + TypeScript + React Query；Vitest；oxlint。

**关键约定**：
- 后端测试真实 DB 模式（`beforeAll` 探测 `SELECT 1`，`dbReady` 跳过；独立测试编码隔离，`afterAll` 清理）
- 前端验证：`cd web && npm run lint && npm run build`
- PowerShell 用 `;` 分隔命令
- 工作区有大量无关未提交改动，**每个任务只 git add 指定文件**
- **权限编码机制（重要）**：前端 `can(resource, action)` 拼接 `${resource}:${action}`；后端 `requirePermission(resource, action)` 查 permission 表 `where { roleId, resource, action }`——**resource 参数传完整权限码**（如 `'transactions:salesmen:view'`），action 传枚举动作（`'view'|'create'|'update'|'delete'`）；seed 的 `PERMISSIONS` 主清单 `{ resource: 完整码, action: 枚举动作 }`，角色 `grants` 数组元素 = 完整码（= PERMISSIONS.resource）。参考现有：`requirePermission('transactions:view', 'view')` + seed `{ resource: 'transactions:view', action: 'view' }` + grants `'transactions:view'` + 前端 `can('transactions', 'view')`。

---

## 阶段一：后端（TDD）

### Task 1: Prisma Salesman.status + 迁移

**Files:**
- Modify: `server/prisma/schema.prisma`

- [ ] **Step 1: 修改 Salesman 模型**

`model Salesman`（5.3a，约 L553-564）增加 status 字段与索引：

```prisma
// 5.3a 业务员表（催收计划归属业务员，按公司隔离；status=inactive 为停用软删除）
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

- [ ] **Step 2: 生成迁移并验证**

```powershell
cd d:\flies\pj3\server
npx prisma migrate dev --name salesman_status
npx prisma generate
npm run typecheck
```

Expected: 迁移成功（salesman 表加 status 列默认 'active' + status 索引）；typecheck 通过。核对迁移 SQL 无意外删改。

- [ ] **Step 3: Commit**

```powershell
git add server/prisma/schema.prisma server/prisma/migrations; git commit -m "feat(prisma): add status field to salesman for soft delete"
```

---

### Task 2: CollectionService 业务员管理方法（TDD）

**Files:**
- Modify: `server/src/services/CollectionService.ts`
- Modify: `server/src/services/CollectionService.test.ts`

- [ ] **Step 1: 写失败测试**

在 `server/src/services/CollectionService.test.ts` 的 describe 内追加用例（放在文件末尾；现有测试已创建业务员「张三」（TEST_COMPANY）与「李四」（EN999902，afterAll 已清理）——**注意：现有用例对 createSalesman 的调用不受影响，但新增用例需要自建数据**）：

```ts
  it('业务员管理：管理列表分页/关键词/状态筛选、编辑、停用', async () => {
    if (!dbReady) return
    // 自建两个业务员：A（active）、B（active 后停用）
    const a = await CollectionService.createSalesman({ companyCode: TEST_COMPANY, name: '管理甲', phone: '13900000001' }, ctx)
    const b = await CollectionService.createSalesman({ companyCode: TEST_COMPANY, name: '管理乙', phone: '13900000002' }, ctx)

    // 管理列表：全部
    const all = await CollectionService.listSalesmenManage({ companyCodes: [TEST_COMPANY], pageSize: 50 })
    expect(all.items.some((s) => s.id === a.id)).toBe(true)
    // 关键词（姓名）
    const kw = await CollectionService.listSalesmenManage({ companyCodes: [TEST_COMPANY], keyword: '管理甲', pageSize: 50 })
    expect(kw.items.map((s) => s.id)).toEqual([a.id])
    // 关键词（电话）
    const kwPhone = await CollectionService.listSalesmenManage({ companyCodes: [TEST_COMPANY], keyword: '13900000002', pageSize: 50 })
    expect(kwPhone.items.map((s) => s.id)).toEqual([b.id])
    // 状态筛选
    const activeOnly = await CollectionService.listSalesmenManage({ companyCodes: [TEST_COMPANY], status: 'active', pageSize: 50 })
    expect(activeOnly.items.some((s) => s.id === b.id)).toBe(true)

    // 编辑：姓名/电话修改；公司不可改
    const edited = await CollectionService.updateSalesman(a.id, { name: '管理甲改', phone: '13900000009' }, ctx)
    expect(edited.name).toBe('管理甲改')
    expect(edited.phone).toBe('13900000009')
    await expect(CollectionService.updateSalesman(a.id, { name: 'x', companyCode: 'EN999902' } as never, ctx)).rejects.toThrow('公司不可修改')

    // 停用：选项接口不再返回，管理列表状态为 inactive；关联引用保留
    const deactivated = await CollectionService.setSalesmanStatus(b.id, 'inactive', ctx)
    expect(deactivated.status).toBe('inactive')
    const options = await CollectionService.listSalesmen({ companyCodes: [TEST_COMPANY] })
    expect(options.some((s) => s.id === b.id)).toBe(false)
    const manageInactive = await CollectionService.listSalesmenManage({ companyCodes: [TEST_COMPANY], status: 'inactive', pageSize: 50 })
    expect(manageInactive.items.some((s) => s.id === b.id)).toBe(true)

    // 非法状态
    await expect(CollectionService.setSalesmanStatus(a.id, 'bogus' as never, ctx)).rejects.toThrow('状态不合法')
  })
```

- [ ] **Step 2: 运行测试确认失败**

```powershell
cd d:\flies\pj3\server
npx vitest run src/services/CollectionService.test.ts
```

Expected: FAIL —— `listSalesmenManage`/`updateSalesman`/`setSalesmanStatus` 不存在；`updateSalesman` 的 companyCode 拒绝未实现。

- [ ] **Step 3: 实现服务方法**

`server/src/services/CollectionService.ts`：

1. **改造 `listSalesmen`**（仅 active 选项）：

```ts
  /**
   * 业务员选项列表（按公司过滤；仅 active——停用业务员不再可选，历史关联保留）
   */
  async listSalesmen(params: { companyCodes?: string[] }) {
    const where: Record<string, unknown> = { status: 'active' }
    if (params.companyCodes) where.companyCode = { in: params.companyCodes }
    const rows = await prisma.salesman.findMany({ where, orderBy: { createdAt: 'desc' } })
    return rows.map((s) => ({ id: s.id, companyCode: s.companyCode, name: s.name, phone: s.phone, remark: s.remark }))
  },
```

2. **`createSalesman` 增加 status 默认写入**（现状 `prisma.salesman.create` 的 data 增加 `status: 'active'`——Prisma 默认值已覆盖，可不改；若类型检查要求则显式加）。**保持现状即可**（default(active) 由 DB 处理）。

3. 新增三个方法（放在 `createSalesman` 之后）：

```ts
  /**
   * 业务员管理列表（分页 + 姓名/电话关键词 + 公司 + 状态筛选；status 空/''/'all' 不过滤）
   */
  async listSalesmenManage(params: { companyCodes?: string[]; keyword?: string; status?: string; page?: number; pageSize?: number }) {
    const page = Math.max(params.page || 1, 1)
    const pageSize = Math.min(Math.max(params.pageSize || 20, 1), 200)
    const where: Record<string, unknown> = {}
    if (params.companyCodes) where.companyCode = { in: params.companyCodes }
    const kw = (params.keyword || '').trim()
    if (kw) {
      where.OR = [
        { name: { contains: kw, mode: 'insensitive' } },
        { phone: { contains: kw, mode: 'insensitive' } },
      ]
    }
    const status = params.status || ''
    if (status && status !== 'all') {
      if (status !== 'active' && status !== 'inactive') throw errors.badRequest('业务员状态不合法')
      where.status = status
    }
    const [items, total] = await Promise.all([
      prisma.salesman.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' } }),
      prisma.salesman.count({ where }),
    ])
    return {
      items: items.map((s) => ({ id: s.id, companyCode: s.companyCode, name: s.name, phone: s.phone, remark: s.remark, status: s.status, createdAt: s.createdAt.toISOString() })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  },

  /**
   * 编辑业务员：姓名/电话/备注；companyCode 不可修改（防止历史关联语义漂移）
   */
  async updateSalesman(id: string, patch: { name?: string; phone?: string; remark?: string; companyCode?: string }, ctx: Ctx) {
    const salesman = await prisma.salesman.findUnique({ where: { id } })
    if (!salesman) throw errors.notFound('业务员不存在')
    if (patch.companyCode !== undefined && patch.companyCode !== salesman.companyCode) {
      throw errors.badRequest('业务员所属公司不可修改')
    }
    const data: Record<string, unknown> = {}
    if (patch.name !== undefined) {
      const name = (patch.name || '').trim()
      if (!name) throw errors.badRequest('业务员姓名必填')
      if (name.length > 50) throw errors.badRequest('业务员姓名不能超过 50 字')
      data.name = name
    }
    if (patch.phone !== undefined) {
      const phone = (patch.phone || '').trim()
      if (phone.length > 30) throw errors.badRequest('联系方式不能超过 30 字')
      data.phone = phone || null
    }
    if (patch.remark !== undefined) data.remark = (patch.remark || '').trim() || null
    if (Object.keys(data).length === 0) throw errors.badRequest('无可更新字段')
    const updated = await prisma.salesman.update({ where: { id }, data: data as never })
    await recordAudit({ userId: ctx.userId, module: 'transactions', action: 'update', targetId: id, detail: { action: 'update-salesman', fields: Object.keys(data) } }, ctx.traceId)
    return { id: updated.id, companyCode: updated.companyCode, name: updated.name, phone: updated.phone, remark: updated.remark, status: updated.status }
  },

  /**
   * 停用/启用业务员（软删除：历史关联 customer_ext/collection_plan 的 salesmanId 保留）
   */
  async setSalesmanStatus(id: string, status: 'active' | 'inactive', ctx: Ctx) {
    const salesman = await prisma.salesman.findUnique({ where: { id } })
    if (!salesman) throw errors.notFound('业务员不存在')
    if (status !== 'active' && status !== 'inactive') throw errors.badRequest('业务员状态不合法')
    const updated = await prisma.salesman.update({ where: { id }, data: { status } })
    await recordAudit({ userId: ctx.userId, module: 'transactions', action: 'update', targetId: id, detail: { action: 'set-salesman-status', status } }, ctx.traceId)
    return { id: updated.id, companyCode: updated.companyCode, name: updated.name, phone: updated.phone, remark: updated.remark, status: updated.status }
  },
```

- [ ] **Step 4: 运行测试确认通过**

```powershell
cd d:\flies\pj3\server
npx vitest run src/services/CollectionService.test.ts
npm run typecheck
```

Expected: PASS（新增 1 用例；既有用例 createSalesman 返回对象不含 status 不影响既有断言）。注意：既有用例「业务员与客商选项接口」断言 `listSalesmen` 含「张三」——张三为 active，改造后仍返回，不受影响。

- [ ] **Step 5: Commit**

```powershell
git add server/src/services/CollectionService.ts server/src/services/CollectionService.test.ts; git commit -m "feat(collection): salesman management methods with soft delete"
```

---

### Task 3: 路由注册 + 权限资源（seed 同步）

**Files:**
- Modify: `server/src/routes/transactions.ts`
- Modify: `server/prisma/seed.ts`

- [ ] **Step 1: 修改既有 salesmen 路由权限**

`server/src/routes/transactions.ts` 业务员段落（现有 `GET /salesmen` 与 `POST /salesmen`）：

```ts
router.get('/salesmen', requirePermission('transactions:salesmen:view', 'view'), asyncHandler(async (req, res) => {
  const companyCodes = await normalizeCompanies(req.authUser as AuthUserContext, req.query.companyCode)
  const data = await CollectionService.listSalesmen({ companyCodes })
  sendOk(res, data)
}))

router.post('/salesmen', requirePermission('transactions:salesmen:create', 'create'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const body = req.body ?? {}
  // 业务员归属单体公司：汇总主体归一化后取第一个成员
  const companyCodes = await normalizeCompanies(authUser, body.companyCode)
  const companyCode = [...(companyCodes ?? [])].sort()[0] ?? ''
  const data = await CollectionService.createSalesman({ companyCode, name: body.name, phone: body.phone, remark: body.remark }, { userId: authUser.userId, traceId: req.traceId })
  sendOk(res, data)
}))
```

（仅权限参数从 `'transactions:view'`/`'transactions:update'` 改为 `'transactions:salesmen:view'`/`'transactions:salesmen:create'`；其余不动。）

- [ ] **Step 2: 新增三条路由**

在 `POST /salesmen` 之后插入：

```ts
// 业务员管理（独立管理页面：列表/编辑/停用）
router.get('/salesmen/manage', requirePermission('transactions:salesmen:view', 'view'), asyncHandler(async (req, res) => {
  const companyCodes = await normalizeCompanies(req.authUser as AuthUserContext, req.query.companyCode)
  const data = await CollectionService.listSalesmenManage({
    companyCodes,
    keyword: req.query.keyword ? String(req.query.keyword) : undefined,
    status: req.query.status ? String(req.query.status) : undefined,
    page: req.query.page ? Number(req.query.page) : undefined,
    pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
  })
  sendOk(res, data)
}))

router.patch('/salesmen/:id', requirePermission('transactions:salesmen:update', 'update'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const data = await CollectionService.updateSalesman(req.params.id as string, req.body ?? {}, { userId: authUser.userId, traceId: req.traceId })
  sendOk(res, data)
}))

router.patch('/salesmen/:id/status', requirePermission('transactions:salesmen:update', 'update'), asyncHandler(async (req, res) => {
  const authUser = req.authUser as AuthUserContext
  const data = await CollectionService.setSalesmanStatus(req.params.id as string, req.body?.status as 'active' | 'inactive', { userId: authUser.userId, traceId: req.traceId })
  sendOk(res, data)
}))
```

**路由冲突检查**：`GET /salesmen/manage` 注册在 `PATCH /salesmen/:id` 之前（GET 与 PATCH 方法不同不冲突，但保持 manage 在前）；`PATCH /salesmen/:id`（2 段）与 `PATCH /salesmen/:id/status`（3 段）段数不同不冲突。

- [ ] **Step 3: seed.ts 权限清单与角色授权**

`server/prisma/seed.ts`：

1. `PERMISSIONS` 数组在「往来分析」段（`{ resource: 'transactions:export', action: 'export' }` 之后）追加：

```ts
  // 往来分析 · 业务员管理
  { resource: 'transactions:salesmen:view', action: 'view' },
  { resource: 'transactions:salesmen:create', action: 'create' },
  { resource: 'transactions:salesmen:update', action: 'update' },
  { resource: 'transactions:salesmen:delete', action: 'delete' },
```

2. 角色 grants 补充（**继承规则：salesmen 动作跟随 transactions 动作**）：
- `ADMIN_GRANTS` 由 `ALL_RESOURCES` 过滤派生（自动包含新码）——**无需改动**
- `ANALYST_IT_GRANTS` 由 `ALL_RESOURCES` 过滤派生（自动包含）——**无需改动**
- `SUPERADMIN_GRANTS = ALL_RESOURCES`——**无需改动**
- `FINANCE_MANAGER_GRANTS`（L129-139）追加：`'transactions:salesmen:view', 'transactions:salesmen:create', 'transactions:salesmen:update'`（跟随其 transactions 无 delete）
- `DEPARTMENT_MANAGER_GRANTS`（L141-149）追加：`'transactions:salesmen:view', 'transactions:salesmen:create', 'transactions:salesmen:update'`
- `VIEWER_GRANTS` 不动

- [ ] **Step 4: 验证**

```powershell
cd d:\flies\pj3\server
npm run typecheck
npx vitest run src/services/CollectionService.test.ts src/services/CustomerLedgerService.test.ts
```

Expected: typecheck 通过；测试全绿（CollectionService 10 + CustomerLedger 7 = 17）。运行 seed 验证权限写入（**注意：seed 会重置演示用户密码以外的数据，谨慎执行**——若本地 DB 可接受，运行 `npm run prisma:seed` 后确认日志无「未在权限主清单中找到」警告；若不宜跑 seed，则仅 typecheck 验证并在汇报中注明需在部署环境执行 seed）。

- [ ] **Step 5: Commit**

```powershell
git add server/src/routes/transactions.ts server/prisma/seed.ts; git commit -m "feat(collection): salesman management routes and permission resources"
```

---

## 阶段二：前端

### Task 4: 前端类型 / API / hooks / 权限矩阵

**Files:**
- Modify: `web/src/types/index.ts`
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/hooks/api-queries.ts`
- Modify: `web/src/lib/permissions.ts`

- [ ] **Step 1: 类型扩展**

`web/src/types/index.ts`：

1. `SalesmanItem` 增加 `status` 与 `createdAt`：

```ts
export interface SalesmanItem {
  id: string
  companyCode: string
  name: string
  phone: string | null
  remark: string | null
  status: 'active' | 'inactive'
  createdAt: string
}
```

2. 追加：

```ts
/** 业务员管理分页响应 */
export type SalesmanListResponse = PaginatedResponse<SalesmanItem>
```

- [ ] **Step 2: api.ts**

`web/src/lib/api.ts` 业务员段落（`getSalesmen` 之前）插入：

```ts
  // 业务员管理（独立管理页面）
  async getSalesmenManage(params: Record<string, unknown>) {
    return this.request({ method: 'GET', url: '/transactions/salesmen/manage', params })
  }

  async updateSalesman(id: string, data: Record<string, unknown>) {
    return this.request({ method: 'PATCH', url: `/transactions/salesmen/${id}`, data })
  }

  async setSalesmanStatus(id: string, status: string) {
    return this.request({ method: 'PATCH', url: `/transactions/salesmen/${id}/status`, data: { status } })
  }
```

- [ ] **Step 3: api-queries.ts**

`web/src/hooks/api-queries.ts` 业务员段落插入：

```ts
export function useSalesmenManage(params: { page?: number; pageSize?: number; companyCode?: string; status?: string; keyword?: string }) {
  return useQuery({
    queryKey: ['transactions', 'salesmen', 'manage', params] as const,
    queryFn: () => api.getSalesmenManage(params as Record<string, unknown>) as Promise<SalesmanListResponse>,
    placeholderData: keepPreviousData,
  })
}

export function useUpdateSalesman() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; data: Record<string, unknown> }) => api.updateSalesman(vars.id, vars.data) as Promise<SalesmanItem>,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions', 'salesmen'] }),
  })
}

export function useSetSalesmanStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; status: string }) => api.setSalesmanStatus(vars.id, vars.status) as Promise<SalesmanItem>,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions', 'salesmen'] }),
  })
}
```

类型导入增加 `SalesmanListResponse`（`SalesmanItem` 已导入）。

- [ ] **Step 4: 权限矩阵**

`web/src/lib/permissions.ts`：

1. `ADMIN_PERMISSIONS`（L20 transactions 行后）追加：

```ts
  'transactions:salesmen:view', 'transactions:salesmen:create', 'transactions:salesmen:update', 'transactions:salesmen:delete',
```

2. `finance_manager`（L64 transactions 行后）与 `department_manager`（L76 后）追加：

```ts
  'transactions:salesmen:view', 'transactions:salesmen:create', 'transactions:salesmen:update',
```

3. `finance_analyst_it`（L94 transactions 行后）追加：

```ts
  'transactions:salesmen:view', 'transactions:salesmen:create', 'transactions:salesmen:update', 'transactions:salesmen:delete',
```

（viewer 不加；admin/superadmin 由 ADMIN_PERMISSIONS 覆盖。）

- [ ] **Step 5: 验证**

```powershell
cd d:\flies\pj3\web
npm run lint
npm run build
```

Expected: 无错误。

- [ ] **Step 6: Commit**

```powershell
git add web/src/types/index.ts web/src/lib/api.ts web/src/hooks/api-queries.ts web/src/lib/permissions.ts; git commit -m "feat(collection): salesman management types, api, hooks and permissions"
```

---

### Task 5: 业务员管理页面 + 入口 + 路由

**Files:**
- Create: `web/src/pages/transactions/collections/salesmen.tsx`
- Modify: `web/src/stores/pageStateStore.ts`
- Modify: `web/src/App.tsx`
- Modify: `web/src/pages/transactions/collections-tab.tsx`

- [ ] **Step 1: pageStateStore 状态扩展**

`web/src/stores/pageStateStore.ts`：

1. `TransactionsState` 类型与 `defaultTransactions` 增加 `salesmen` tab：

```ts
export interface TransactionSalesmenState {
  page: number
  pageSize: number
  /** 'all' | 公司编码 */
  company: string
  /** '' = 全部状态 */
  status: string
  keyword: string
}
```

（在 `TransactionCollectionsState` 之后定义；`TransactionsState` 的 transactions 字段映射与 `defaultTransactions` 各加 `salesmen: defaultSalesmen`，`defaultSalesmen: TransactionSalesmenState = { page: 1, pageSize: PAGINATION.DEFAULT_PAGE_SIZE, company: 'all', status: '', keyword: '' }`。）

- [ ] **Step 2: 创建管理页面 `web/src/pages/transactions/collections/salesmen.tsx`**

```tsx
import { useCallback, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { PageContainer } from '@/components/layout/page-container'
import { Pagination } from '@/components/data-table/pagination'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { usePermission } from '@/hooks/usePermission'
import { useSalesmenManage, useCreateSalesman, useUpdateSalesman, useSetSalesmanStatus } from '@/hooks/api-queries'
import { usePageStore } from '@/stores/pageStateStore'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { CompanySelect } from '@/components/filters/company-select'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { SheetShell } from '@/components/ui/sheet-shell'
import { FlashMessage } from '@/components/ui/flash-message'
import { Loader2, UserPlus } from 'lucide-react'
import type { SalesmanItem } from '@/types'

/**
 * 往来分析 · 业务员管理：业务员主数据（列表/新增/编辑/停用）。
 * 软删除：停用保留历史关联（催收计划/客商扩展），选项接口不再返回停用业务员。
 */

const STATUS_LABELS: Record<string, string> = { active: '启用', inactive: '停用' }

/** 表单抽屉：新增（公司可选）与编辑（公司只读）共用 */
function SalesmanFormDrawer({ target, onClose }: { target: SalesmanItem | null; onClose: () => void }) {
  const [companyCode, setCompanyCode] = useState(target?.companyCode ?? '')
  const [name, setName] = useState(target?.name ?? '')
  const [phone, setPhone] = useState(target?.phone ?? '')
  const [remark, setRemark] = useState(target?.remark ?? '')
  const [errorMsg, setErrorMsg] = useState('')
  const createMutation = useCreateSalesman()
  const updateMutation = useUpdateSalesman()

  const handleSave = async () => {
    setErrorMsg('')
    if (!target && !companyCode) { setErrorMsg('请选择所属公司'); return }
    if (!name.trim()) { setErrorMsg('请输入业务员姓名'); return }
    try {
      if (target) {
        await updateMutation.mutateAsync({ id: target.id, data: { name: name.trim(), phone: phone.trim() || undefined, remark: remark.trim() || undefined } })
      } else {
        await createMutation.mutateAsync({ companyCode, name: name.trim(), phone: phone.trim() || undefined, remark: remark.trim() || undefined })
      }
      onClose()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <SheetShell
      onClose={onClose}
      className="max-w-md"
      title={target ? '编辑业务员' : '新增业务员'}
      description={target ? `${target.name} · ${target.companyCode}` : '录入业务员主数据（所属公司不可修改）'}
      footer={(
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={createMutation.isPending || updateMutation.isPending}>取消</Button>
          <Button size="sm" disabled={createMutation.isPending || updateMutation.isPending} onClick={handleSave}>
            {(createMutation.isPending || updateMutation.isPending) ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            保存
          </Button>
        </div>
      )}
    >
      <div className="space-y-3 p-5">
        <div className="space-y-1.5">
          <Label htmlFor="salesman-form-company">所属公司</Label>
          {target ? (
            <Input id="salesman-form-company" value={target.companyCode} disabled />
          ) : (
            <CompanySelect value={companyCode} onChange={setCompanyCode} />
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="salesman-form-name">姓名（必填）</Label>
          <Input id="salesman-form-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="业务员姓名" maxLength={50} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="salesman-form-phone">联系方式</Label>
          <Input id="salesman-form-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="手机号/电话" maxLength={30} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="salesman-form-remark">备注</Label>
          <Textarea id="salesman-form-remark" rows={3} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="选填" />
        </div>
        {errorMsg && <FlashMessage type="error">{errorMsg}</FlashMessage>}
      </div>
    </SheetShell>
  )
}

export default function SalesmenPage() {
  const setTransactionsTab = usePageStore((s) => s.setTransactionsTab)
  const page = usePageStore((s) => s.transactions.salesmen.page)
  const pageSize = usePageStore((s) => s.transactions.salesmen.pageSize)
  const companyFilter = usePageStore((s) => s.transactions.salesmen.company)
  const statusFilter = usePageStore((s) => s.transactions.salesmen.status)
  const keyword = usePageStore((s) => s.transactions.salesmen.keyword)
  const setPage = useCallback((v: number) => setTransactionsTab('salesmen', { page: v }), [setTransactionsTab])
  const setPageSize = useCallback((v: number) => setTransactionsTab('salesmen', { pageSize: v }), [setTransactionsTab])
  const setCompanyFilter = useCallback((v: string) => setTransactionsTab('salesmen', { company: v }), [setTransactionsTab])
  const setStatusFilter = useCallback((v: string) => setTransactionsTab('salesmen', { status: v }), [setTransactionsTab])
  const setKeyword = useCallback((v: string) => setTransactionsTab('salesmen', { keyword: v }), [setTransactionsTab])
  const [formTarget, setFormTarget] = useState<SalesmanItem | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const { can } = usePermission()
  const { getDisplayName } = useCompanyDisplayName()
  const { confirm, element: confirmElement } = useConfirm()
  const statusMutation = useSetSalesmanStatus()

  const companyCode = companyFilter === 'all' ? undefined : companyFilter
  const canCreate = can('transactions:salesmen', 'create')
  const canUpdate = can('transactions:salesmen', 'update')

  const { data, isLoading } = useSalesmenManage({
    page,
    pageSize,
    companyCode,
    status: statusFilter || undefined,
    keyword: keyword || undefined,
  })

  const items = data?.items || []
  const total = data?.total || 0

  const handleToggleStatus = async (row: SalesmanItem) => {
    const next = row.status === 'active' ? 'inactive' : 'active'
    const ok = await confirm({
      title: next === 'inactive' ? '停用业务员' : '启用业务员',
      description: `确定${next === 'inactive' ? '停用' : '启用'}「${row.name}」吗？${next === 'inactive' ? '停用后不再出现在选择列表中，历史关联数据保留。' : ''}`,
      confirmText: next === 'inactive' ? '停用' : '启用',
      danger: next === 'inactive',
    })
    if (!ok) return
    try {
      await statusMutation.mutateAsync({ id: row.id, status: next })
    } catch (e) {
      // 状态变更失败由 mutation 抛出；此处保持静默（列表未刷新即未生效）
      console.error(e)
    }
  }

  const columns: DataTableColumn<SalesmanItem>[] = useMemo(() => [
    { key: 'name', header: '姓名' },
    { key: 'phone', header: '联系方式', render: (row) => <span className="text-xs">{row.phone || '-'}</span> },
    {
      key: 'companyCode', header: '所属公司',
      render: (row) => <span title={row.companyCode}>{getDisplayName(row.companyCode, undefined)}</span>,
    },
    { key: 'remark', header: '备注', render: (row) => <span className="text-xs text-muted-foreground">{row.remark || '-'}</span> },
    {
      key: 'status', header: '状态',
      render: (row) => (
        <span className={cn('rounded px-1.5 py-0.5 text-xs', row.status === 'active' ? 'bg-success/10 text-success-strong' : 'bg-muted text-muted-foreground')}>
          {STATUS_LABELS[row.status] ?? row.status}
        </span>
      ),
    },
    {
      key: 'createdAt', header: '创建时间',
      render: (row) => <span className="text-xs">{new Date(row.createdAt).toLocaleDateString('zh-CN')}</span>,
    },
    {
      key: 'actions', header: '操作',
      render: (row) => (
        <div className="flex gap-1">
          {canUpdate && (
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => { setFormTarget(row); setFormOpen(true) }}>
              编辑
            </Button>
          )}
          {canUpdate && (
            <Button variant="ghost" size="sm" className={cn('h-7 px-2 text-xs', row.status === 'active' && 'text-destructive')} onClick={() => handleToggleStatus(row)}>
              {row.status === 'active' ? '停用' : '启用'}
            </Button>
          )}
        </div>
      ),
    },
  ], [canUpdate, getDisplayName, handleToggleStatus])

  return (
    <PageContainer title="业务员管理">
      <div className="space-y-4">
        {/* 筛选卡 */}
        <Card className="rounded-card p-4">
          <div className="flex flex-wrap items-center gap-3">
            <CompanySelect value={companyFilter} onChange={(v) => { setCompanyFilter(v); setPage(1) }} />
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v === 'all' ? '' : v); setPage(1) }}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="状态" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="active">启用</SelectItem>
                <SelectItem value="inactive">停用</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="搜索姓名/电话..."
              className="w-[200px]"
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPage(1) }}
            />
            {canCreate && (
              <Button className="ml-auto" size="sm" onClick={() => { setFormTarget(null); setFormOpen(true) }}>
                <UserPlus className="mr-1 h-4 w-4" />
                新增业务员
              </Button>
            )}
          </div>
        </Card>

        {/* 列表卡 */}
        <Card className="rounded-card overflow-hidden">
          <div className="pt-4">
            {isLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">加载中…</div>
            ) : items.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">暂无业务员数据</div>
            ) : (
              <div className="px-2 pb-2">
                <DataTable
                  columns={columns}
                  data={items}
                  rowKey={(row) => row.id}
                  density="compact"
                  caption="业务员列表"
                />
              </div>
            )}
          </div>
          {total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2.5">
              <span className="text-xs text-muted-foreground">共 {total} 条</span>
              <Pagination
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
                summary=""
              />
            </div>
          )}
        </Card>

        {formOpen && <SalesmanFormDrawer target={formTarget} onClose={() => setFormOpen(false)} />}
        {confirmElement}
      </div>
    </PageContainer>
  )
}
```

注意：`handleToggleStatus` 在 useMemo 依赖中出现——它每次渲染重建，导致 columns useMemo 失效。**修正**：`handleToggleStatus` 用 `useCallback` 包裹（依赖 `confirm`/`statusMutation`），columns 依赖数组含 `handleToggleStatus`。实现时按此调整；`confirm` 来自 useConfirm（其函数引用是否稳定取决于实现——若不稳定，columns 每次重建可接受，页面数据量小）。

- [ ] **Step 3: 路由注册（App.tsx）**

`web/src/App.tsx`：lazy 引入 + 路由：

```tsx
const SalesmenPage = lazy(() => import('@/pages/transactions/collections/salesmen'))
```

路由（`transactions/collections/plans` 之后）：

```tsx
                <Route path="transactions/collections/salesmen" element={<RequirePermission resource="transactions:salesmen" action="view"><SalesmenPage /></RequirePermission>} />
```

（确认 `RequirePermission` 支持三段式 resource——其内部 `can(resource, action)` 拼接完整码，支持。）

- [ ] **Step 4: 催收计划页入口（collections-tab.tsx）**

`web/src/pages/transactions/collections-tab.tsx`：

1. 导入追加：

```tsx
import { useNavigate } from 'react-router-dom'
import { Users } from 'lucide-react'
```

2. `CollectionsTab` 内（`const { can } = usePermission()` 附近）追加：

```tsx
  const navigate = useNavigate()
  const canViewSalesmen = can('transactions:salesmen', 'view')
```

3. 筛选卡筛选行（搜索 Input 之后、`</div>` 之前）插入：

```tsx
        {canViewSalesmen && (
          <Button variant="outline" size="sm" className="ml-auto" onClick={() => navigate('/transactions/collections/salesmen')}>
            <Users className="mr-1 h-4 w-4" />
            业务员管理
          </Button>
        )}
```

- [ ] **Step 5: 验证**

```powershell
cd d:\flies\pj3\web
npm run lint
npm run build
```

Expected: 无错误。若 oxlint 报未使用（如 `canCreate`/`UserPlus` 在无权限角色下不可达但代码存在——导出使用即不报），按报错清理。

- [ ] **Step 6: Commit**

```powershell
git add web/src/pages/transactions/collections/salesmen.tsx web/src/stores/pageStateStore.ts web/src/App.tsx web/src/pages/transactions/collections-tab.tsx; git commit -m "feat(collection): salesman management page with entry from collections tab"
```

---

## 自审记录

- **Spec 覆盖**：Salesman.status + 索引（Task 1）；listSalesmen 仅 active + manage 列表（分页/关键词/公司/状态）+ updateSalesman（公司不可改）+ setSalesmanStatus（软删除保留关联）（Task 2）；路由 3 新 + 2 权限迁移 + seed 权限清单与角色授权（Task 3）；前端类型/api/hooks/权限矩阵（Task 4）；页面/路由/入口/持久化（Task 5）。
- **占位符检查**：所有步骤含具体代码与命令；无 TBD。
- **类型一致性**：`SalesmanItem.status/createdAt`（Task 4 定义，Task 5 页面使用）；`SalesmanListResponse`（Task 4，Task 5 useSalesmenManage）；服务方法签名 `listSalesmenManage({companyCodes,keyword,status,page,pageSize})`/`updateSalesman(id,{name,phone,remark,companyCode},ctx)`/`setSalesmanStatus(id,status,ctx)`（Task 2 定义，Task 3 路由调用，Task 4 hook 映射）；权限码 `transactions:salesmen:view/create/update/delete`（Task 3 seed + Task 4 前端矩阵一致）。
- **已知确认点**：`useConfirm` 的 `confirm` 返回值与 `danger` prop（项目 confirm-dialog.tsx 已用，参照 coverage-tab 用法）；`CompanySelect` 单选模式 value 支持空串（参照 collections-tab 现状）；`PageContainer` title 用法（参照 plans.tsx）。实现时如与描述不符，以实际组件签名为准并记录。
- **seed 执行注意**：Task 3 Step 4 的 seed 运行需谨慎（会差量同步权限），本地 DB 可执行；生产环境由部署流程执行 migrate/seed。
