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

- 热修 PR（`hotfix/login-remembered-required` → `main`）CI `verify`：部署后回填。
- 合并提交 SHA：部署后回填。
- 正式 tag：`v2026.10.15`。

## 备份、验收与回滚

部署命令：`powershell -File server\scripts\deploy-zjyph.ps1 -Tag v2026.10.15 -ProdDir D:\ZJYPHFA`。

验收结果：**部署后回填**（备份文件、`HEAD` 精确匹配、冒烟五项、PM2、巡检、真实浏览器回归验证）。

回滚：`deploy-zjyph.ps1 -Tag v2026.10.14`（本修复不涉及迁移，回滚无需动数据）。**注意**：回滚到 v2026.10.14 会重新引入本缺陷。

## 给受影响用户的临时办法（修复上线前）

在浏览器中清除该站点的本地存储（或换用无痕窗口 / 另一浏览器）后登录；或改用登录页的「忘记密码」自助重置后登录。修复上线后刷新页面即恢复正常。
