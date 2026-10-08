# v2026.10.10 更新公告渲染崩溃热修复记录

发布日期：2026-10-07。上一稳定版本：v2026.10.9。变更分类：用户可见的缺陷修复（生产事故复盘与修复）。

## 事故现象与影响

登录后访问任意页面出现「页面渲染出错 / 页面加载过程中出现异常，请重试；若反复出现请联系管理员。」，页面被错误边界接管。

触发条件有两个，均来自同一个根因：

1. 用户在**停留在旧版本页面**（浏览器里还开着 v2026.10.9 部署前加载的页签）时，版本公告组件检测到服务器已发布新版本 → 弹出「发现新版本」对话框；
2. 用户主动点击顶栏「更新公告」入口。

## 根因

`web/src/components/layout/version-notice.tsx` 的公告类型映射表只有 `feature / fix / improvement` 三个键：

```ts
const NOTE_TYPE_META = { feature: …, fix: …, improvement: … }
```

而 v2026.10.9 的对外公告中新增了一条 `"type": "note"`（"邮箱找回密码需管理员配置邮件服务后开放…"）。于是 `NOTE_TYPE_META['note']` 为 `undefined`，渲染时 `NOTE_TYPE_META[n.type].variant` 抛出 `TypeError: Cannot read properties of undefined (reading 'variant')`，公告组件挂在登录后全局布局（MainLayout）上，异常上抛导致整页被错误边界接管。

`web/src/lib/app-version.ts` 里 `ReleaseNoteItem['type']` 是联合类型，但 release-notes.json 属于**运行时数据**，TypeScript 无法约束，构建与 CI 都不会报错——这是本次缺陷能穿透全部本地校验与 CI 的原因。

## 修复内容

1. **数据契约**：`ReleaseNoteType` 正式纳入 `note`；`NOTE_TYPE_META` 增加 `note: { label: '提示', variant: 'info' }`。
2. **代码兜底（关键）**：新增 `noteMeta(type: string)`，对映射表外的类型回落为 `{ label: '更新', variant: 'secondary' }`。文案渲染不再直接索引映射表，人工维护的公告数据在未来出现任何新类型都不会再崩溃整页。
3. **回归测试**：在 `version-notice.history.test.tsx` 新增两例——「未知公告类型不崩溃，回落为『更新』标签」与「note 类型渲染为『提示』标签」，锁定本次事故的修复。

## 应急处理（手工干预，事后说明）

考虑到生产在报错期间已登录用户无法正常使用，经用户明确授权后，**先在 v2026.10.9 版本位**把生产产物 `D:\ZJYPHFA\web\dist\release-notes.json` 中该条 `note` 临时改为 `improvement`（静态文件即时生效、无需重启），使页面立即恢复；原始文件已备份为 `D:\ZJYPHFA\logs\release-notes.json.pre-hotfix-v2026.10.9.bak`。

该手工改动**违反《生产部署发布流程》「不得手工覆盖生产文件」的约定**，属线上事故下的受限止血：本版本发布后，`web/dist` 由正式构建产物整体替换，仓库内 release-notes.json（`note` 类型已正式支持）与之保持一致，手工改动被自然覆盖、不残留漂移。

## 数据与依赖

无数据库迁移，无依赖变更，不改动任何接口契约。

## 发布门禁

功能分支先经 PR/CI 合入 develop，develop 再经 PR/CI 合入 main；正式注释 tag 指向最终 main 合并提交。提交前在隔离工作区执行完整 `npm run verify`，其中新增的两条回归用例为本次事故的防复发门禁。

## 备份、验收与回滚

部署脚本先执行生产全量加密备份并校验，再停进程、检出 tag、前后端 `npm ci` 与构建、启动 PostgreSQL、`migrate deploy`（本次无待应用迁移）、原子切换产物、重载 backend/frontend、健康检查与冒烟。正式合并 SHA、部署时间、备份文件与验收明细保存在生产 `logs/release-v2026.10.10.json`。

回滚目标为 v2026.10.9，仍调用统一 `deploy-zjyph.ps1 -Tag`。本版本无迁移，回滚不涉及数据恢复。

## 复盘要点

- 本次缺陷穿透了本地 verify、端到端浏览器检查与远端 CI：前两者只在**登录页**做了浏览器验证，未覆盖登录后的全局布局；CI 只对代码做类型/测试校验，**无法约束运行时数据**（release-notes.json）。
- 已做的改进：代码侧对未知公告类型兜底 + 回归用例。后续新增公告类型时，即使忘记同步映射表也不会再影响页面可用性。
