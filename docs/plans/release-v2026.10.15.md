# v2026.10.15 修复「记住用户名」回填导致登录被表单校验卡死

> 合入路径：`hotfix/login-remembered-required` → `main`（紧急修复，按 `生产部署发布流程.md` §3.2；合入后须把 `main` 同步回 `develop`）
> 对外公告：已随本版发布（`web/public/release-notes.json` 条目 `v2026.10.15`）

## 现象（生产实测复现）

勾选过「7 天内免登录」的账号（浏览器 localStorage 存有记住的用户名），打开登录页时账号被自动回填、复选框自动勾选。此时填入正确密码点击「登录」，页面报 **「请检查 1 项内容 / Required」**，请求根本没有发出，**该账号完全无法登录**。

## 根因

`web/src/pages/login/index.tsx` 的「记住用户名」回填用了**局部** `form.reset`：

```ts
model.form.reset({ username: remembered, password: '', rememberMe: true })  // 漏了 captcha
```

React Hook Form 的 `reset` 是**整体替换**：未提供的键会被置为 `undefined`。而 `useFormModel` 对不在 required 映射里的字符串字段生成的是 `z.string()`，**不接受 `undefined`**，zod 因此抛出默认文案 `Required`。

该缺陷**在 v2026.10.14 之前就已存在**（同样的 reset 调用），只是当时验证码框常驻显示，用户随手填一次验证码就会把 `captcha` 写回具体值，问题被掩盖；v2026.10.14 把验证码改为按需隐藏后，用户再没有任何途径设置该字段 → 从「偶发提示」变成**硬性阻断**。

- 影响面：**仅**使用过「7 天内免登录（记住用户名）」的浏览器；未勾选过的账号不受影响。
- 与图形验证码、邮箱收集等本批次特性无关，属于既有表单缺陷被新交互放大。

## 修复

回填时带全模型的所有键：`model.form.reset({ username: remembered, password: '', rememberMe: true, captcha: '' })`。

同类风险排查：全仓其余局部 `form.reset` 调用点（`budget-ratio-panel`、`batch-permission-dialog`）所传键与其模型字段一一对应，无同类缺陷。

## 测试

- 新增回归用例：`web/src/pages/login/__tests__/login-captcha-policy.test.tsx` —「记住用户名」回填后仍可提交（先确认能复现失败，再验证通过）。
- 整仓 `npm run verify` 退出码 0（server 76 / web 72 测试文件）。
- 真实浏览器：生产（修复前）复现「请检查 1 项内容 / Required」；开发实例（修复后）同路径提交直达后端并返回「用户名或密码错误」。

## 数据与依赖

**无数据库迁移**；无依赖变化。

## 发布门禁

- 热修 PR #35（`hotfix/login-remembered-required` → `main`）CI `verify` **pass**（4m3s）。
- 本地 `npm run verify` 退出码 0（server 76 / web 72 测试文件）。
- 合并提交 SHA：**`e5a9bbe1`**（`74756f6b` 为上一发布点）。
- 正式 tag：**`v2026.10.15`**（注释 tag，指向 `e5a9bbe1`，已推送远端）。
- 合并后已把 `main` 同步回 `develop`（`80bff8f4`），两者仅差 `release-v2026.10.14.md` 一文（该文件为 develop 上的发版记录回填，不影响运行产物）。

## 备份、验收与回滚

部署命令：`powershell -File server\scripts\deploy-zjyph.ps1 -Tag v2026.10.15 -ProdDir D:\ZJYPHFA`（未使用 `-SkipBackup`/`-SkipSmoke`）。

**发布前备份**：`D:\ZJYPHFA\backup\full\zjyph_prod_20261014_184032.dump.enc`（4.16 MB，2026-10-14 18:40）。

**验收结果（2026-10-14 18:40–18:52 实测）**：

| 检查项 | 结果 |
|---|---|
| 生产 `HEAD` | `git describe --tags --exact-match` = **v2026.10.15** |
| 工作区 | 无已跟踪文件漂移 |
| 部署步骤 | 前置校验 → 备份 → 检出 tag（`e5a9bbe1`）→ `No pending migrations to apply` → 切产物重载 → 服务 → 冒烟 |
| 冒烟（脚本内 + 事后复跑） | **5/5 PASS** |
| 前端产物 | `app-version = v2026.10.15`；`/release-notes.json` 含 `v2026.10.15` 修复条目 |
| 真实浏览器回归 | 在运行白名单来源 `http://192.168.1.201:8080` 上：记住用户名自动回填 + 勾选免登录 → 填密码点登录 → **直达后端并返回「用户名或密码错误」**（修复前同一路径报「请检查 1 项内容 / Required」且请求不发出） |

**验收期间的一处既有现象（非本批引入）**：从 `http://localhost:8080` 访问生产会收到 403「CORS 拒绝来源」。原因是运行中后端的 CORS 白名单来自 PM2 注入的 **ops-panel `runtime-config.json` 的 `access.frontendOrigin`**（当前为 `https://zjyphfa.damaospace.ltd,http://192.168.1.201:8080`），而 `server/.env` 的 `FRONTEND_ORIGIN` **被 PM2 环境变量覆盖、不生效**（dotenv 不覆盖已存在的环境变量）。如需放开其他来源，要改运行配置后重启后端，而不是改 `.env`。

**回滚**：`deploy-zjyph.ps1 -Tag v2026.10.14`（无迁移，无需动数据）。**注意**：回滚会重新引入本缺陷。

## 给受影响用户的临时办法（修复上线前）

在浏览器中清除该站点的本地存储（或换用无痕窗口 / 另一浏览器）后登录；或改用登录页的「忘记密码」自助重置后登录。修复上线后刷新页面即恢复正常。
