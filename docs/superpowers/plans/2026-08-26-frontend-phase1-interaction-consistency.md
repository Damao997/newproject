# 前端优化 Phase 1：交互反馈收敛与占位页跳转 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清除 `web/src` 全部 15 处原生 `window.alert/confirm/prompt`（迁移到 `useConfirm` / `FlashMessage` / 对话框体系），收敛三页互斥逻辑为单一来源，补全经营分析占位页信息架构断层，并以 `no-alert` lint 规则防回潮。

**Architecture:** 全部迁移到代码库既有反馈体系（`useConfirm` 支持 danger/requireInput、`FlashMessage` 支持语义色/自动消失），不新增 Toast 基础设施——登录过期场景登录页已有 `?expired=1` 提示条，仅移除请求层 alert。三页互斥逻辑抽取为共享 hook（Phase 3 组件化时天然可内聚进 `CompanyMultiSelect`）。

**Tech Stack:** React 19 / React Router 7 / Zustand / Radix UI / Tailwind / Vitest + Testing Library / oxlint 1.74

**验证基线（先跑一遍确保全绿）：** `cd web && npx vitest run && npm run lint`

---

## 任务一览

| # | 任务 | 文件 | 消除的原生弹窗 |
|---|------|------|----------------|
| 1 | 登录过期提示去弹窗 | `src/lib/api.ts` | api.ts:118 |
| 2 | 用户停用/彻底删除确认框 | `src/pages/admin/users.tsx` | users.tsx:116,132 |
| 3 | 单项分析删除确认框 | `src/hooks/use-analysis-form.ts` + 2 个 drawer | use-analysis-form.ts:99 |
| 4 | 修改密码成功轻提示 | `src/components/layout/change-password-dialog.tsx` | change-password-dialog.tsx:131 |
| 5 | 富文本链接对话框 + 润色轻提示 | 新建 `src/components/editor/link-dialog.tsx` + `rich-text-editor.tsx` | rich-text-editor.tsx:46,199,204 |
| 6 | 三页互斥逻辑收敛 + 账龄导出失败轻提示 | 新建 `src/hooks/use-exclusive-company-filter.tsx` + overview/aging/inventory | overview.tsx:81,86、aging.tsx:116,121,242、inventory:315,320 |
| 7 | 经营分析占位页跳转与说明 | `src/pages/dashboard/analysis-placeholder.tsx` + `analysis.tsx` | —（P0-2） |
| 8 | 启用 no-alert lint 防线 | `.oxlintrc.json` | —（防回潮） |

> 注：方案文档原列 17 处，其中 2 处为注释提及（`admin/dialogs.tsx:713`、`confirm-dialog.tsx:30`），真实调用 15 处。Task 6 将 P0-3 互斥逻辑提前到 Phase 1 收敛（否则 no-alert 无法全绿；hook 形式与 Phase 3 组件化方向兼容）。

---

## Task 1: 登录过期提示去原生弹窗

**Files:**
- Modify: `web/src/lib/api.ts:106-120`
- Test: `web/src/lib/__tests__/session-expired.test.ts`

**背景：** 登录页已消费 `?expired=1` 并渲染"登录已过期，请重新登录"提示条（`web/src/pages/login/index.tsx:141-147`），请求层弹窗属双轨提示，直接移除。

- [ ] **Step 1: 写失败测试**

Create `web/src/lib/__tests__/session-expired.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleSessionExpired } from '@/lib/api'

const { logoutMock } = vi.hoisted(() => ({ logoutMock: vi.fn() }))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: { getState: () => ({ logout: logoutMock }) },
}))

describe('handleSessionExpired 会话失效降级', () => {
  const originalLocation = window.location

  beforeEach(() => {
    logoutMock.mockClear()
    vi.spyOn(window, 'alert').mockImplementation(() => {})
    // jsdom 不支持真实导航：以可写 location stub 断言跳转目标
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'location', { value: originalLocation, writable: true })
  })

  it('登出并跳转登录页（携带 expired 参数），不再使用原生弹窗', () => {
    handleSessionExpired(new Error('令牌已过期'))
    expect(logoutMock).toHaveBeenCalledTimes(1)
    expect(window.location.href).toBe('/login?expired=1')
    expect(window.alert).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run src/lib/__tests__/session-expired.test.ts`
Expected: FAIL——`handleSessionExpired` 未导出（import 报错）。

- [ ] **Step 3: 实现**

Modify `web/src/lib/api.ts:109-120`，将私有函数改为导出并移除 alert：

```ts
/**
 * 会话失效降级处理：本地登出 → 跳转登录页（携带 expired 提示参数）。
 * 提示由登录页展示（/login?expired=1 → "登录已过期，请重新登录"提示条），请求层不再弹窗。
 * _reason 保留参数位：后续如需按失败原因差异化提示可在此扩展。
 */
export function handleSessionExpired(_reason: unknown): void {
  useAuthStore.getState().logout()
  if (sessionExpiredNotified) return
  sessionExpiredNotified = true
  window.location.href = '/login?expired=1'
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run src/lib/__tests__/session-expired.test.ts`
Expected: PASS（1 个用例）。

- [ ] **Step 5: 全量回归 + 提交**

Run: `cd web && npx vitest run`
Expected: 全部通过。

```bash
git add web/src/lib/api.ts web/src/lib/__tests__/session-expired.test.ts
git commit -m "refactor(web): 登录过期提示移除原生 alert，交由登录页提示条展示"
```

---

## Task 2: 用户管理停用/彻底删除改用 useConfirm

**Files:**
- Modify: `web/src/pages/admin/users.tsx:114-137, 368-383`
- Test: `web/src/pages/admin/__tests__/users-confirm.test.tsx`

- [ ] **Step 1: 写失败测试**

Create `web/src/pages/admin/__tests__/users-confirm.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useAuthStore } from '@/stores/authStore'
import type { User } from '@/types'
import UsersPage from '../users'

const { disableMutate, purgeMutate } = vi.hoisted(() => ({
  disableMutate: vi.fn(),
  purgeMutate: vi.fn(),
}))

vi.mock('@/hooks/api-queries', () => ({
  useUsers: () => ({
    data: {
      items: [
        { id: 'u1', username: 'zhangsan', name: '张三', role: 'viewer', status: 'active', dataScope: '*', createdAt: '', updatedAt: '', lastLoginAt: null },
        { id: 'u2', username: 'lisi', name: '李四', role: 'viewer', status: 'inactive', dataScope: '*', createdAt: '', updatedAt: '', lastLoginAt: null },
      ],
      total: 2,
    },
  }),
  useRoles: () => ({ data: [] }),
  useUpdateUser: () => ({ mutate: vi.fn(), isPending: false }),
  useDisableUser: () => ({ mutate: disableMutate, isPending: false }),
  usePurgeUser: () => ({ mutate: purgeMutate, isPending: false }),
}))

const ADMIN_PERMISSIONS = [
  'admin:users:view', 'admin:users:create', 'admin:users:update', 'admin:users:delete',
  'admin:users:reset-password', 'admin:users:export', 'admin:users:purge',
]

function setAdminSession() {
  const user: User = {
    id: 'u-admin', username: 'admin', name: '管理员', role: 'admin',
    permissions: ADMIN_PERMISSIONS, dataScope: '全部', status: 'active', createdAt: '', updatedAt: '',
  }
  useAuthStore.setState({ user, isAuthenticated: true })
}

describe('用户管理：停用/彻底删除走确认对话框（替代原生 confirm）', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, isAuthenticated: false })
    setAdminSession()
    disableMutate.mockClear()
    purgeMutate.mockClear()
  })

  /** 打开指定用户名所在行的操作菜单（MoreHorizontal 按钮） */
  const openRowMenu = (name: string) => {
    const row = screen.getByText(name).closest('tr')
    if (!row) throw new Error(`未找到 ${name} 所在行`)
    fireEvent.click(row.querySelector('button') as HTMLButtonElement)
  }

  it('停用：先弹确认框，确认后才调用停用接口', async () => {
    render(<UsersPage />)
    openRowMenu('张三')
    fireEvent.click(await screen.findByRole('menuitem', { name: '停用' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('确认停用用户「张三」？停用后其登录会话将失效。')
    fireEvent.click(screen.getByRole('button', { name: '停用' }))
    await waitFor(() => expect(disableMutate).toHaveBeenCalledWith('u1'))
  })

  it('停用：取消确认则不调用接口', async () => {
    render(<UsersPage />)
    openRowMenu('张三')
    fireEvent.click(await screen.findByRole('menuitem', { name: '停用' }))
    await screen.findByRole('dialog')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(disableMutate).not.toHaveBeenCalled()
  })

  it('彻底删除：需输入用户名才能确认（防呆），确认后调用删除接口', async () => {
    render(<UsersPage />)
    openRowMenu('李四')
    fireEvent.click(await screen.findByRole('menuitem', { name: '彻底删除' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('将物理删除用户「李四」（lisi）')
    const confirmBtn = screen.getByRole('button', { name: '彻底删除' })
    expect(confirmBtn).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('lisi'), { target: { value: 'lisi' } })
    expect(confirmBtn).toBeEnabled()
    fireEvent.click(confirmBtn)
    await waitFor(() => expect(purgeMutate).toHaveBeenCalledWith('u2'))
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run src/pages/admin/__tests__/users-confirm.test.tsx`
Expected: FAIL——点击"停用"菜单项后无确认对话框（仍走原生 confirm，jsdom 中直接跳过并调用接口）。

- [ ] **Step 3: 实现**

Modify `web/src/pages/admin/users.tsx`:

(1) 顶部新增 import（放 `FlashMessage` import 后）：

```tsx
import { useConfirm } from '@/components/ui/confirm-dialog'
```

(2) 替换 `handleDisableUser` / `handlePurgeUser`（原 114-137 行），并在组件顶部新增确认 hook：

```tsx
  // 确认对话框：停用 danger 红色；彻底删除 danger + 输入用户名防呆
  const { confirm, element: confirmElement } = useConfirm()

  /** 停用：走专用 DELETE 接口（后端会同步吊销刷新令牌），需二次确认 */
  const handleDisableUser = async (u: User) => {
    const ok = await confirm({
      title: '停用用户',
      description: `确认停用用户「${u.name}」？停用后其登录会话将失效。`,
      confirmText: '停用',
      danger: true,
    })
    if (!ok) return
    disableUser.mutate(u.id, {
      onSuccess: () => setFlash({ type: 'success', text: `已停用用户「${u.name}」` }),
      onError: alertError('停用失败'),
    })
  }
```

```tsx
  const handlePurgeUser = async (u: User) => {
    const ok = await confirm({
      title: '彻底删除用户',
      description: `将物理删除用户「${u.name}」（${u.username}），此操作不可恢复！请输入用户名确认。`,
      confirmText: '彻底删除',
      danger: true,
      requireInput: u.username,
    })
    if (!ok) return
    purgeUser.mutate(u.id, {
      onSuccess: () => setFlash({ type: 'success', text: `已彻底删除用户「${u.name}」` }),
      onError: alertError('彻底删除失败'),
    })
  }
```

(3) 在 JSX 弹窗区（`<ResetPasswordDialog ... />` 之后、`</PageContainer>` 之前）渲染确认框：

```tsx
      {confirmElement}
    </PageContainer>
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run src/pages/admin/__tests__/users-confirm.test.tsx`
Expected: PASS（3 个用例）。同时跑 `npx vitest run src/pages/admin/__tests__/admin-pages.test.tsx` 确认原有冒烟测试不回归。

- [ ] **Step 5: 提交**

```bash
git add web/src/pages/admin/users.tsx web/src/pages/admin/__tests__/users-confirm.test.tsx
git commit -m "refactor(web): 用户停用/彻底删除改用 useConfirm（danger + 输入防呆）"
```

---

## Task 3: 单项分析删除确认改用 useConfirm（共享 hook）

**Files:**
- Modify: `web/src/hooks/use-analysis-form.ts:1, 96-110, 112`
- Modify: `web/src/components/indicators/analysis-drawer.tsx:244-246`
- Modify: `web/src/pages/transactions/analysis-drawer.tsx:115, 240-241`
- Test: `web/src/hooks/__tests__/use-analysis-form.test.tsx`

> 注：方案文档称 use-analysis-form.ts:99 为"放弃编辑确认"，实际是**删除分析确认**（`remove()` 内），本任务按真实语义处理。

- [ ] **Step 1: 写失败测试**

Create `web/src/hooks/__tests__/use-analysis-form.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useAnalysisForm } from '@/hooks/use-analysis-form'

const { deleteMutateAsync } = vi.hoisted(() => ({ deleteMutateAsync: vi.fn() }))

vi.mock('@/hooks/api-queries', () => ({
  useAnalyses: () => ({ data: { items: [{ id: 'a1', title: '既有分析', content: '<p>x</p>' }] } }),
  useCreateAnalysis: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateAnalysis: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteAnalysis: () => ({ mutateAsync: deleteMutateAsync, isPending: false }),
}))

/** 宿主组件：模拟真实使用场景（existingId 回填后出现删除按钮，确认框由 hook 渲染） */
function Host() {
  const form = useAnalysisForm({
    fetchParams: { companyCode: 'C1', subjectCode: 'S1', period: '2026-01' },
    buildPayload: (title, content) => ({
      companyCode: 'C1', subjectCode: 'S1', subjectType: 'operating',
      fiscalYear: '2026', period: '2026-01', title, content,
    }),
    defaultTitle: () => '默认标题',
  })
  return (
    <div>
      {form.existingId && <button onClick={() => void form.remove()}>删除</button>}
      {form.confirmElement}
    </div>
  )
}

describe('useAnalysisForm 删除确认', () => {
  beforeEach(() => deleteMutateAsync.mockReset())

  it('取消确认时不调用删除接口', async () => {
    render(<Host />)
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    expect(await screen.findByRole('dialog')).toHaveTextContent('确认删除该单项分析')
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deleteMutateAsync).not.toHaveBeenCalled()
  })

  it('确认后调用删除接口并复位表单', async () => {
    deleteMutateAsync.mockResolvedValue(undefined)
    render(<Host />)
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(deleteMutateAsync).toHaveBeenCalledWith('a1'))
    // 删除成功 → existingId 复位 → 删除按钮消失
    await waitFor(() => expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument())
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run src/hooks/__tests__/use-analysis-form.test.tsx`
Expected: FAIL——`confirmElement` 不存在（TypeScript 编译错误），且删除直接调用接口无确认。

- [ ] **Step 3: 实现**

Modify `web/src/hooks/use-analysis-form.ts`:

(1) 新增 import：

```ts
import { useConfirm } from '@/components/ui/confirm-dialog'
```

(2) hook 内部（`optsRef` 声明之后）接入 useConfirm：

```ts
  // 删除确认（危险操作红色按钮）；confirmElement 由调用方在 JSX 中渲染
  const { confirm, element: confirmElement } = useConfirm()
```

(3) `remove()` 改用确认对话框（原 96-99 行）：

```ts
  const remove = async () => {
    if (!existingId) return
    const text = optsRef.current.deleteConfirmText ?? '确认删除该单项分析？删除后引用它的报告章节将标记为"原文已删除"。'
    const ok = await confirm({ title: '删除分析', description: text, confirmText: '确认删除', danger: true })
    if (!ok) return
    setFeedback(null)
```

(4) 返回值新增 `confirmElement`（原 112 行）：

```ts
  return { title, setTitle, content, setContent, existingId, feedback, busy, save, remove, confirmElement }
```

(5) 调用方渲染确认框：

`web/src/components/indicators/analysis-drawer.tsx`——`DrawerBody` 根 fragment 内（`{element}` 之后）追加：

```tsx
      {element}
      {form.confirmElement}
```

`web/src/pages/transactions/analysis-drawer.tsx`——`TransactionDrawerBody` 目前单根 `SheetShell`，改为 fragment 包裹（原 115 行 `return (` 与 240-241 行）：

```tsx
  return (
    <>
      <SheetShell
        ...
      </SheetShell>
      {form.confirmElement}
    </>
  )
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run src/hooks/__tests__/use-analysis-form.test.tsx`
Expected: PASS（2 个用例）。再跑 `npx vitest run` 全量回归。

- [ ] **Step 5: 提交**

```bash
git add web/src/hooks/use-analysis-form.ts web/src/components/indicators/analysis-drawer.tsx web/src/pages/transactions/analysis-drawer.tsx web/src/hooks/__tests__/use-analysis-form.test.tsx
git commit -m "refactor(web): 单项分析删除确认改用 useConfirm（共享 hook 内收敛）"
```

---

## Task 4: 修改密码成功提示改用 FlashMessage

**Files:**
- Modify: `web/src/components/layout/change-password-dialog.tsx:1, 93-95, 130-131, 139-219`
- Test: `web/src/components/layout/__tests__/change-password-dialog.test.tsx`

- [ ] **Step 1: 写失败测试**

Create `web/src/components/layout/__tests__/change-password-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ChangePasswordDialog } from '../change-password-dialog'

const { closePasswordDialogMock, updateUserMock, setTokensMock } = vi.hoisted(() => ({
  closePasswordDialogMock: vi.fn(),
  updateUserMock: vi.fn(),
  setTokensMock: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  api: { updatePassword: vi.fn().mockResolvedValue({ accessToken: 'at', refreshToken: 'rt' }) },
}))

vi.mock('@/stores/authStore', () => ({
  useAuthStore: () => ({
    user: { name: '测试用户' },
    passwordDialog: { open: true, force: false },
    closePasswordDialog: closePasswordDialogMock,
    updateUser: updateUserMock,
    setTokens: setTokensMock,
  }),
}))

describe('修改密码对话框', () => {
  beforeEach(() => {
    closePasswordDialogMock.mockClear()
    updateUserMock.mockClear()
    setTokensMock.mockClear()
  })

  it('修改成功后展示 FlashMessage 轻提示而非原生弹窗', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    render(<ChangePasswordDialog />)
    fireEvent.change(screen.getByLabelText('原密码'), { target: { value: 'old1234' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'new1234a' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'new1234a' } })
    fireEvent.click(screen.getByRole('button', { name: '确认修改' }))
    expect(await screen.findByText('密码修改成功')).toBeInTheDocument()
    expect(alertSpy).not.toHaveBeenCalled()
    // 静默续期行为不变：新令牌对写回 store
    expect(updateUserMock).toHaveBeenCalledWith({ mustChangePassword: false })
    expect(setTokensMock).toHaveBeenCalledWith('at', 'rt')
    expect(closePasswordDialogMock).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run src/components/layout/__tests__/change-password-dialog.test.tsx`
Expected: FAIL——"密码修改成功"通过 alert 弹窗展示，jsdom 中无 DOM 文本；且 `window.alert` 被调用。

- [ ] **Step 3: 实现**

Modify `web/src/components/layout/change-password-dialog.tsx`:

(1) 新增 import（放 `api` import 后）：

```tsx
import { FlashMessage } from '@/components/ui/flash-message'
```

(2) 组件内新增成功提示 state（`isSubmitting` state 附近）：

```tsx
  // 成功轻提示（替代原生 alert）：对话框关闭后于页面展示，3s 自动消失
  const [successFlash, setSuccessFlash] = useState(false)
```

(3) 提交成功分支（原 130-131 行）替换 alert：

```tsx
      closePasswordDialog()
      setSuccessFlash(true)
```

(4) 组件根改为 fragment，末尾渲染 FlashMessage（原 139 行 `return (` 与结尾）：

```tsx
  return (
    <>
      <Dialog
        ...
      </Dialog>
      {successFlash && (
        <FlashMessage type="success" autoHideMs={3000} onAutoHide={() => setSuccessFlash(false)} className="px-4 pt-2">
          密码修改成功
        </FlashMessage>
      )}
    </>
  )
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd web && npx vitest run src/components/layout/__tests__/change-password-dialog.test.tsx`
Expected: PASS（1 个用例）。

- [ ] **Step 5: 提交**

```bash
git add web/src/components/layout/change-password-dialog.tsx web/src/components/layout/__tests__/change-password-dialog.test.tsx
git commit -m "refactor(web): 修改密码成功提示由原生 alert 改为 FlashMessage 轻提示"
```

---

## Task 5: 富文本链接对话框与润色轻提示

**Files:**
- Create: `web/src/components/editor/link-dialog.tsx`
- Modify: `web/src/components/editor/rich-text-editor.tsx:43-53, 196-208, 216-229`
- Test: `web/src/components/editor/__tests__/link-dialog.test.tsx`

- [ ] **Step 1: 写失败测试（LinkDialog 独立组件）**

Create `web/src/components/editor/__tests__/link-dialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LinkDialog } from '../link-dialog'

describe('LinkDialog 链接编辑对话框（替代原生 prompt）', () => {
  it('确定时回传输入的 URL', () => {
    const onConfirm = vi.fn()
    render(<LinkDialog open initialUrl="https://a.com" onConfirm={onConfirm} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('链接地址'), { target: { value: 'https://b.com' } })
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(onConfirm).toHaveBeenCalledWith('https://b.com')
  })

  it('清空后确定回传空串（移除链接语义，与旧 prompt 行为一致）', () => {
    const onConfirm = vi.fn()
    render(<LinkDialog open initialUrl="https://a.com" onConfirm={onConfirm} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('链接地址'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(onConfirm).toHaveBeenCalledWith('')
  })

  it('取消时不回传', () => {
    const onCancel = vi.fn()
    render(<LinkDialog open initialUrl="https://a.com" onConfirm={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onCancel).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run src/components/editor/__tests__/link-dialog.test.tsx`
Expected: FAIL——`../link-dialog` 模块不存在。

- [ ] **Step 3: 创建 LinkDialog 组件**

Create `web/src/components/editor/link-dialog.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface LinkDialogProps {
  open: boolean
  /** 初始链接地址（无链接时 'https://'） */
  initialUrl: string
  /** 确定回调：空串表示移除链接（与旧 prompt 行为一致） */
  onConfirm: (url: string) => void
  onCancel: () => void
}

/** 链接编辑对话框：替代原生 prompt；打开时回填当前链接，清空确定 = 移除链接 */
export function LinkDialog({ open, initialUrl, onConfirm, onCancel }: LinkDialogProps) {
  const [url, setUrl] = useState(initialUrl)

  useEffect(() => {
    if (open) setUrl(initialUrl)
  }, [open, initialUrl])

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>编辑链接</DialogTitle>
          <DialogDescription>输入链接地址；清空后确定将移除当前链接。</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="link-url">链接地址</Label>
          <Input
            id="link-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button onClick={() => onConfirm(url.trim())}>确定</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: 跑测试确认通过（组件部分）**

Run: `cd web && npx vitest run src/components/editor/__tests__/link-dialog.test.tsx`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 接入 RichTextEditor（替换 prompt 与润色 alert）**

Modify `web/src/components/editor/rich-text-editor.tsx`:

(1) 新增 import：

```tsx
import { LinkDialog } from './link-dialog'
```

(2) `Toolbar` 的 `setLink` 改为触发父级回调（原 44-53 行；`Toolbar` 签名与 `<ToolButton ... onClick={setLink}>` 同步改为 `onEditLink`）：

```tsx
function Toolbar({ editor, onPolish, onEditLink }: { editor: Editor; onPolish?: () => void; onEditLink: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 px-2 py-1">
      ...
      <ToolButton title="链接" active={editor.isActive('link')} onClick={onEditLink}><LinkIcon className="h-4 w-4" /></ToolButton>
```

(3) `RichTextEditor` 组件内新增链接对话框 state 与 hint state（`polish` state 附近）：

```tsx
  // 链接编辑对话框（替代原生 prompt）：打开时回填当前链接
  const [linkDialog, setLinkDialog] = useState<{ open: boolean; initialUrl: string }>({ open: false, initialUrl: 'https://' })
  // 操作引导轻提示（替代原生 alert）：2.5s 自动消失
  const [hint, setHint] = useState<string | null>(null)

  useEffect(() => {
    if (!hint) return
    const t = window.setTimeout(() => setHint(null), 2500)
    return () => window.clearTimeout(t)
  }, [hint])

  const openLinkDialog = () => {
    const previous = editor.getAttributes('link').href as string | undefined
    setLinkDialog({ open: true, initialUrl: previous ?? 'https://' })
  }

  const confirmLink = (url: string) => {
    setLinkDialog((s) => ({ ...s, open: false }))
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }
```

(4) `handlePolish` 的两处 alert 改为 hint（原 196-208 行）：

```tsx
  const handlePolish = () => {
    const { from, to } = editor.state.selection
    if (from === to) {
      setHint('请先在编辑器中选中需润色的文本。')
      return
    }
    const text = editor.state.doc.textBetween(from, to, '\n')
    if (!text.trim()) {
      setHint('选区为空，无可润色的文本。')
      return
    }
    setPolish({ from, to, text })
  }
```

(5) JSX 接线（原 216-229 行）：工具栏回调、hint 条、对话框：

```tsx
  return (
    <div className={cn('overflow-hidden rounded-md border bg-background', className)}>
      {editable && <Toolbar editor={editor} onPolish={polishEnabled ? handlePolish : undefined} onEditLink={openLinkDialog} />}
      {hint && (
        <p role="status" className="border-t px-3 py-1.5 text-[12px] text-muted-foreground">{hint}</p>
      )}
      <div className="flex">
        <div className="min-w-0 flex-1">
          <EditorContent editor={editor} />
        </div>
        {polish && (
          <PolishPanel original={polish.text} onApply={applyPolish} onClose={() => setPolish(null)} />
        )}
      </div>
      <LinkDialog
        open={linkDialog.open}
        initialUrl={linkDialog.initialUrl}
        onConfirm={confirmLink}
        onCancel={() => setLinkDialog((s) => ({ ...s, open: false }))}
      />
    </div>
  )
```

- [ ] **Step 6: 验证 + 提交**

Run: `cd web && npx vitest run && npm run lint`
Expected: 全绿。`npm run build`（tsc）通过（Toolbar 签名变更影响面仅本文件）。

手工冒烟清单（dev 环境 `npm run dev --prefix web`）：
1. 指标分析抽屉 → 选中文本 → 点链接图标 → 对话框出现，输入 URL → 确定 → 选中文字变链接；
2. 再次点链接图标 → 回填旧 URL → 清空 → 确定 → 链接被移除；
3. 不选文本点"AI 润色" → 工具栏下方出现引导提示，2.5s 后消失。

```bash
git add web/src/components/editor/link-dialog.tsx web/src/components/editor/rich-text-editor.tsx web/src/components/editor/__tests__/link-dialog.test.tsx
git commit -m "refactor(web): 富文本链接输入改对话框、润色提示改轻提示，移除原生 prompt/alert"
```

---

## Task 6: 三页互斥逻辑收敛为共享 hook + 账龄导出失败轻提示

**Files:**
- Create: `web/src/hooks/use-exclusive-company-filter.tsx`
- Modify: `web/src/pages/transactions/overview.tsx:73-92, 145-160`
- Modify: `web/src/pages/transactions/aging.tsx:108-127, 241-242, 272-395`
- Modify: `web/src/pages/inventory/index.tsx:307-326, 605-618`
- Test: `web/src/hooks/__tests__/use-exclusive-company-filter.test.tsx`

> 本任务同时消除 P0-3 的 3 份复制粘贴与 P0-1 剩余 7 处 alert（含 aging 导出失败），是 no-alert 全绿的前提。

- [ ] **Step 1: 写失败测试**

Create `web/src/hooks/__tests__/use-exclusive-company-filter.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useExclusiveCompanyFilter } from '@/hooks/use-exclusive-company-filter'
import type { Company } from '@/types'

const ENTITY = { code: 'C1', type: 'entity' } as unknown as Company
const SUMMARY = { code: 'S1', type: 'summary' } as unknown as Company

function Host({ companies, prev }: { companies: Company[]; prev: string[] }) {
  const setSelected = vi.fn()
  const { handleCompaniesChange, noticeElement } = useExclusiveCompanyFilter({
    companies,
    getPrev: () => prev,
    setSelected,
  })
  return (
    <div>
      <button onClick={() => handleCompaniesChange(['C1', 'S1'])}>勾选 C1+S1</button>
      <button onClick={() => handleCompaniesChange(['S1'])}>勾选 S1</button>
      {noticeElement}
    </div>
  )
}

describe('useExclusiveCompanyFilter 主体互斥过滤', () => {
  it('新增单体时自动移除已选汇总主体并以轻提示告知', () => {
    render(<Host companies={[ENTITY, SUMMARY]} prev={['S1']} />)
    fireEvent.click(screen.getByRole('button', { name: '勾选 C1+S1' }))
    expect(screen.getByText('单体公司与汇总主体不能同时筛选，已自动取消已选汇总主体。')).toBeInTheDocument()
  })

  it('新增汇总时自动移除已选单体公司并以轻提示告知', () => {
    render(<Host companies={[ENTITY, SUMMARY]} prev={['C1']} />)
    fireEvent.click(screen.getByRole('button', { name: '勾选 C1+S1' }))
    expect(screen.getByText('单体公司与汇总主体不能同时筛选，已自动取消已选单体公司。')).toBeInTheDocument()
  })

  it('无冲突时直接透传选择结果，不出现提示', () => {
    render(<Host companies={[ENTITY, SUMMARY]} prev={['C1']} />)
    fireEvent.click(screen.getByRole('button', { name: '勾选 S1' }))
    expect(screen.queryByText(/不能同时筛选/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run src/hooks/__tests__/use-exclusive-company-filter.test.tsx`
Expected: FAIL——`use-exclusive-company-filter` 模块不存在。

- [ ] **Step 3: 创建共享 hook**

Create `web/src/hooks/use-exclusive-company-filter.tsx`:

```ts
import { useCallback, useState } from 'react'
import { FlashMessage } from '@/components/ui/flash-message'
import type { Company } from '@/types'

/**
 * 主体互斥过滤：单体公司与汇总主体不能同时筛选（防止成员公司双重计数）。
 * 新增勾选某一类时自动取消另一类，并以轻提示告知（替代三处复制的 window.alert）。
 * getPrev 由调用方提供（各页持久化 store 路径不同）。
 */
export function useExclusiveCompanyFilter(opts: {
  companies: Company[] | undefined
  getPrev: () => string[]
  setSelected: (codes: string[]) => void
}) {
  const { companies, getPrev, setSelected } = opts
  const [notice, setNotice] = useState<string | null>(null)

  const handleCompaniesChange = useCallback((next: string[]) => {
    const prev = getPrev()
    const typeOf = (code: string) => companies?.find((c) => c.code === code)?.type
    const added = next.filter((c) => !prev.includes(c))
    if (added.length > 0) {
      const addedType = typeOf(added[added.length - 1])
      if (addedType === 'entity' && next.some((c) => typeOf(c) === 'summary')) {
        setNotice('单体公司与汇总主体不能同时筛选，已自动取消已选汇总主体。')
        setSelected(next.filter((c) => typeOf(c) !== 'summary'))
        return
      }
      if (addedType === 'summary' && next.some((c) => typeOf(c) === 'entity')) {
        setNotice('单体公司与汇总主体不能同时筛选，已自动取消已选单体公司。')
        setSelected(next.filter((c) => typeOf(c) !== 'entity'))
        return
      }
    }
    setSelected(next)
  }, [companies, getPrev, setSelected])

  const noticeElement = notice ? (
    <FlashMessage type="info" autoHideMs={4000} onAutoHide={() => setNotice(null)} className="mt-2">
      {notice}
    </FlashMessage>
  ) : null

  return { handleCompaniesChange, noticeElement }
}
```

- [ ] **Step 4: 跑测试确认通过（hook 部分）**

Run: `cd web && npx vitest run src/hooks/__tests__/use-exclusive-company-filter.test.tsx`
Expected: PASS（3 个用例）。

- [ ] **Step 5: 接入 overview.tsx**

Modify `web/src/pages/transactions/overview.tsx`:

(1) 新增 import（`useCallback` import 后）：

```tsx
import { useExclusiveCompanyFilter } from '@/hooks/use-exclusive-company-filter'
```

(2) 替换 `handleCompaniesChange`（原 73-92 行）：

```tsx
  // 主体互斥业务规则：单体公司与汇总主体不能同时筛选；逻辑与轻提示收敛于共享 hook
  const { handleCompaniesChange, noticeElement } = useExclusiveCompanyFilter({
    companies,
    getPrev: () => usePageStore.getState().transactions.overview.companies,
    setSelected: setSelectedCompanies,
  })
```

> 注意：原 `handleCompaniesChange` 中的 `typeOf` 依赖 `companies`，hook 内部已封装；`useCallback` import 如不再使用需一并清理（本页 `useCallback` 仍在其他处使用，勿删）。

(3) 筛选卡内渲染轻提示（原 159 行 `</div>` 后、`</Card>` 前）：

```tsx
          </div>
          {noticeElement}
          </Card>
```

- [ ] **Step 6: 接入 aging.tsx**

Modify `web/src/pages/transactions/aging.tsx`:

(1) 新增 import（`FlashMessage` import 后；aging 当前无 FlashMessage import，需新增）：

```tsx
import { FlashMessage } from '@/components/ui/flash-message'
import { useExclusiveCompanyFilter } from '@/hooks/use-exclusive-company-filter'
```

(2) 替换 `handleCompaniesChange`（原 108-127 行）：

```tsx
  // 主体互斥业务规则：单体公司与汇总主体不能同时筛选；逻辑与轻提示收敛于共享 hook
  const { handleCompaniesChange, noticeElement } = useExclusiveCompanyFilter({
    companies,
    getPrev: () => usePageStore.getState().transactions.aging.companies,
    setSelected: setCompanyFilter,
  })
```

(3) 导出失败 alert 改轻提示（原 241-242 行附近）：页面组件内新增 state（`exporting` state 附近）：

```tsx
  const [exportFlash, setExportFlash] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
```

catch 分支替换（原 242 行）：

```tsx
    } catch (e) {
      setExportFlash({ type: 'error', text: (e as Error).message || '导出失败，请稍后重试' })
    } finally {
```

(4) 筛选卡内渲染轻提示（原 394 行折叠摘要之后、`</Card>` 之前）：

```tsx
        {!detailOpen && detailSummary.length > 0 && (
          <p className="mt-2 truncate text-xs text-muted-foreground">{detailSummary.join(' · ')}</p>
        )}
        {noticeElement}
        {exportFlash && (
          <FlashMessage type={exportFlash.type} className="mt-2">{exportFlash.text}</FlashMessage>
        )}
        </Card>
```

- [ ] **Step 7: 接入 inventory/index.tsx**

Modify `web/src/pages/inventory/index.tsx`:

(1) 新增 import（`FlashMessage` 与 hook；inventory 当前无 FlashMessage import，需新增）：

```tsx
import { FlashMessage } from '@/components/ui/flash-message'
import { useExclusiveCompanyFilter } from '@/hooks/use-exclusive-company-filter'
```

(2) 替换 `handleCompaniesChange`（原 307-326 行）：

```tsx
  // 主体互斥业务规则：单体公司与汇总主体不能同时筛选；逻辑与轻提示收敛于共享 hook
  const { handleCompaniesChange, noticeElement } = useExclusiveCompanyFilter({
    companies,
    getPrev: () => usePageStore.getState().inventory.companies,
    setSelected: setSelectedCompanies,
  })
```

(3) 筛选卡内渲染轻提示（原 616 行 `</div>` 后、`</Card>` 前）：

```tsx
          <span className="text-xs text-muted-foreground">金额单位：万元</span>
        </div>
        {noticeElement}
        </Card>
```

- [ ] **Step 8: 验证 + 提交**

Run: `cd web && npx vitest run && npm run lint && npm run build`
Expected: 全绿（三个页面编译通过、测试无回归）。

手工冒烟清单（dev 环境）：
1. 往来总览页：已选汇总主体 → 再勾单体公司 → 筛选卡内出现轻提示且汇总主体被移除；
2. 账龄分析页：同上；导出失败（断网）→ 筛选卡内出现红色错误提示，无浏览器弹窗；
3. 存货管理页：同上。

```bash
git add web/src/hooks/use-exclusive-company-filter.tsx web/src/hooks/__tests__/use-exclusive-company-filter.test.tsx web/src/pages/transactions/overview.tsx web/src/pages/transactions/aging.tsx web/src/pages/inventory/index.tsx
git commit -m "refactor(web): 主体互斥逻辑收敛为共享 hook 并改轻提示，账龄导出失败去原生弹窗"
```

---

## Task 7: 经营分析占位页跳转与说明

**Files:**
- Modify: `web/src/pages/dashboard/analysis-placeholder.tsx`
- Modify: `web/src/pages/dashboard/analysis.tsx:15-20, 146-147`
- Test: `web/src/pages/dashboard/__tests__/analysis-placeholder.test.tsx`

- [ ] **Step 1: 写失败测试**

Create `web/src/pages/dashboard/__tests__/analysis-placeholder.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AnalysisPlaceholder } from '../analysis-placeholder'
import { AnalysisPage } from '../analysis'

vi.mock('@/hooks/useDashboardFilters', () => ({
  useDashboardFilters: () => ({
    dimFilter: '', setDimFilter: vi.fn(), selectedPeriod: '', setSelectedPeriod: vi.fn(),
    periodOptions: [], companyCode: '',
  }),
}))

vi.mock('@/hooks/api-queries', () => ({
  useCompanies: () => ({ data: [] }),
}))

describe('经营分析占位页', () => {
  it('带跳转配置时渲染跳转按钮（应收账龄 → 往来账龄分析）', () => {
    render(
      <MemoryRouter>
        <AnalysisPlaceholder title="应收账款账龄分析表" actionLabel="前往往来账龄分析" actionHref="/transactions/aging" />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: '前往往来账龄分析' })
    expect(link).toHaveAttribute('href', '/transactions/aging')
  })

  it('带说明文案时渲染 note 而非默认文案', () => {
    render(
      <MemoryRouter>
        <AnalysisPlaceholder title="存货库龄分析表" note="功能规划中，如有需求请联系管理员反馈优先级" />
      </MemoryRouter>,
    )
    expect(screen.getByText('功能规划中，如有需求请联系管理员反馈优先级')).toBeInTheDocument()
    expect(screen.queryByText('功能开发中，敬请期待')).not.toBeInTheDocument()
  })

  it('AnalysisPage 的 receivable-aging 子页渲染真实跳转入口', async () => {
    render(
      <MemoryRouter>
        <AnalysisPage variant="receivable-aging" />
      </MemoryRouter>,
    )
    const link = await screen.findByRole('link', { name: '前往往来账龄分析' })
    expect(link).toHaveAttribute('href', '/transactions/aging')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd web && npx vitest run src/pages/dashboard/__tests__/analysis-placeholder.test.tsx`
Expected: FAIL——`AnalysisPlaceholder` 无 action/note props 渲染，`AnalysisPage` 无跳转链接。

- [ ] **Step 3: 实现 placeholder 组件**

Modify `web/src/pages/dashboard/analysis-placeholder.tsx`（整体重写为）：

```tsx
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Link } from 'react-router-dom'
import { ArrowRight, Inbox } from 'lucide-react'

interface AnalysisPlaceholderProps {
  /** 占位入口标题（如「壹品慧关键指标表」） */
  title: string
  /** 补充说明（功能规划状态 / 需求反馈渠道）；缺省时展示通用文案 */
  note?: string
  /** 跳转动作按钮标签（如「前往往来账龄分析」） */
  actionLabel?: string
  /** 跳转目标（react-router 内部路径） */
  actionHref?: string
}

/**
 * 经营分析占位子页：入口已建、功能待实现。
 * 支持跳转通道（数据已落地的关联页面）与规划说明，避免死胡同。
 */
export function AnalysisPlaceholder({ title, note, actionLabel, actionHref }: AnalysisPlaceholderProps) {
  return (
    <Card className="animate-fade-in border border-border shadow-sm">
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <Inbox className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {note ? (
          <p className="max-w-md text-xs text-muted-foreground">{note}</p>
        ) : (
          <p className="text-xs text-muted-foreground">功能开发中，敬请期待</p>
        )}
        {actionLabel && actionHref && (
          <Link to={actionHref}>
            <Button variant="outline" size="sm">
              {actionLabel}
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </Link>
        )}
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: 实现 analysis.tsx 配置**

Modify `web/src/pages/dashboard/analysis.tsx`——将 `PLACEHOLDER_TITLES`（原 15-20 行）替换为配置对象：

```tsx
interface PlaceholderConfig {
  title: string
  note?: string
  actionLabel?: string
  actionHref?: string
}

/** 占位子页配置（与 Tab 标签一致）；receivable-aging 数据已在往来账龄落地，提供跳转通道 */
const PLACEHOLDER_CONFIG: Record<string, PlaceholderConfig> = {
  'cash-flow': {
    title: '壹品慧业务现金流分析',
    note: '功能规划中，如有需求请联系管理员反馈优先级',
  },
  'receivable-aging': {
    title: '应收账款账龄分析表',
    note: '数据已在「往来分析 · 账龄分析」落地，可直接前往查看',
    actionLabel: '前往往来账龄分析',
    actionHref: '/transactions/aging',
  },
  'inventory-aging': {
    title: '存货库龄分析表',
    note: '功能规划中，如有需求请联系管理员反馈优先级',
  },
}
```

default 分支（原 146-147 行）改为：

```tsx
          default:
            return <AnalysisPlaceholder {...(PLACEHOLDER_CONFIG[variant] ?? { title: '经营分析' })} />
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd web && npx vitest run src/pages/dashboard/__tests__/analysis-placeholder.test.tsx`
Expected: PASS（3 个用例）。再跑 `npx vitest run` 全量回归。

- [ ] **Step 6: 提交**

```bash
git add web/src/pages/dashboard/analysis-placeholder.tsx web/src/pages/dashboard/analysis.tsx web/src/pages/dashboard/__tests__/analysis-placeholder.test.tsx
git commit -m "feat(web): 经营分析占位页提供跳转通道与规划说明，消除信息架构断层"
```

---

## Task 8: 启用 no-alert lint 防线

**Files:**
- Modify: `web/.oxlintrc.json`
- Verify: 全量 lint + grep 扫描

- [ ] **Step 1: 启用规则**

Modify `web/.oxlintrc.json`（rules 段新增）：

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }],
    "no-alert": "error"
  }
}
```

- [ ] **Step 2: 验证 lint 全绿（此时 15 处已全部迁移）**

Run: `cd web && npm run lint`
Expected: 无任何 `no-alert` 报错（oxlint 1.74 已支持该规则，见 `node_modules/oxlint/configuration_schema.json`）。

- [ ] **Step 3: grep 扫描确认零残留**

Run:

```powershell
cd web; Select-String -Path src -Pattern 'window\.(alert|confirm|prompt)' -Recurse -Include *.ts,*.tsx
```

Expected: 仅剩注释提及（`admin/dialogs.tsx`、`confirm-dialog.tsx` 的文档注释），无真实调用。注释可保留（说明性）或同步清理为"已由 useConfirm 替代"——推荐保留 confirm-dialog.tsx 注释（接口文档），删除 dialogs.tsx 中已失效的注释行（原 713 行 `/** 重置成功回调，页面用于展示成功反馈（替代 window.alert） */` 改为 `/** 重置成功回调，页面用于展示成功反馈 */`）。

- [ ] **Step 4: 全量测试 + 提交**

Run: `cd web && npx vitest run && npm run build`
Expected: 全绿。

```bash
git add web/.oxlintrc.json web/src/pages/admin/dialogs.tsx
git commit -m "chore(web): 启用 no-alert lint 规则，强制零原生弹窗"
```

---

## 收尾验证（Phase 1 验收标准）

- [ ] `cd web && npx vitest run` 全绿（含新增 5 个测试文件：session-expired / users-confirm / use-analysis-form / change-password-dialog / link-dialog / use-exclusive-company-filter / analysis-placeholder）
- [ ] `cd web && npm run lint` 无 no-alert 报错（lint 强制零原生弹窗）
- [ ] `cd web && npm run build` 通过（tsc + vite）
- [ ] grep 扫描 `window\.(alert|confirm|prompt)` 仅剩注释
- [ ] 手工冒烟：改密成功轻提示、用户停用/彻底删除确认框、单项分析删除确认框、富文本链接对话框、三页互斥轻提示、占位页跳转按钮

## 假设与说明

1. **P0-3 提前收敛**：方案原将互斥组件化归 Phase 3，但互斥 6 处 alert 不清理则 no-alert 无法启用；本计划以共享 hook 收敛（单一来源达成），Phase 3 组件化时可将 hook 内聚进 `CompanyMultiSelect`，过渡成本为零。
2. **aging 导出失败 alert**（aging.tsx:242）：方案同时出现在 P0-1（Phase 1）与方向 5（Phase 4）；本计划在 Phase 1 仅去原生弹窗（FlashMessage 页面内提示），Phase 4 再统一导出 loading/成功反馈。
3. **rich-text-editor 集成不写单测**：TipTap 在 jsdom 需要大量 DOM polyfill，成本远超收益；以 LinkDialog 独立组件测试 + 手工冒烟清单覆盖。
4. **占位页文案**：cash-flow / inventory-aging 无确定上线时间，使用中性文案"功能规划中，如有需求请联系管理员反馈优先级"，不编造排期。
