# v2026.10.14 登录验证码按需触发与工作邮箱补全引导

> 合入路径：`feature/login-ux-batch` → `develop`（PR #33，已合并）→ `main`（PR #34）
> 对外公告：已随本版发布（`web/public/release-notes.json` 条目 `v2026.10.14`，标题「完成重置密码功能及其他优化」，文案由用户复核定稿）

## 发布范围

1. **登录图形验证码改为「按需」**（此前为每次登录强制）：新增 `server/src/services/LoginAttemptService.ts`（进程内存态）——按账号累计凭证失败，15 分钟滑动窗口内失败满 5 次后，该账号后续登录必须携带图形验证码；成功登录即清零。计数 key 统一 `trim + toLowerCase`。需要但未携带 → 新增错误码 **428**（`errors.captchaRequired`，文案「密码错误次数过多，请输入图形验证码」）；登录请求体 `captchaId`/`captcha` 改为可选，一旦携带仍照常校验（不做「当前不需要就放行」）。前端登录页默认不渲染验证码框、不预拉图，收到 428 才展开并拉图。
2. **工作邮箱补全引导**：`EMAIL_COLLECTION_ENABLED=1` 且邮件服务可用时，`GET /auth/login-options` 下发 `emailCollectionRequired:true`；未绑邮箱的账号登录后弹**不可关闭**的「补全工作邮箱」引导（可「暂不填写」豁免本次浏览器会话，登出重登再提醒；强制改密期间让位不叠加）。写入复用既有 `PATCH /auth/profile`（唯一性校验 + `profile_update` 审计），**无新增后端写入通道**。
3. **用户管理**：新增「未填邮箱」统计卡，搜索范围扩展至邮箱。
4. **文档与运维**：`docs/references/errorcode.md` 增 428；`docs/plans/安全与权限规范.md` 升 v1.5（含本次安全让步与例外说明）；生产冒烟脚本第 4 项由「缺验证码应 400」改为「错误凭证被拒（401，兼容 400/428）」。
5. **随批上线的一次性开关（默认全关）**：`EMAIL_COLLECTION_ENABLED`（邮箱收集活动）、`CAPTCHA_ALWAYS_REQUIRED`（验证码应急开关）。默认关 → 上线后行为与现状一致。

## 数据与依赖

**无数据库迁移**：本批次无 schema 变更、无新增迁移目录文件。

**无依赖变化**：`server/package.json`、`web/package.json` 与 `package-lock.json` 均未改动。

生产 `.env` 未写入新增开关，两项均取默认值「关」。

## 发布门禁

- 远端 CI：PR #33 `verify` **pass**（3m46s）；PR #34 `verify`（部署后回填）。
- 本地门禁：`npm run verify` 退出码 0（server 76 个测试文件 / web 72 个测试文件，含 typecheck、lint、双端 build）。
- 新增用例 28 个：`LoginAttemptService` 7、`AuthService` 验证码策略 5、登录页交互 6、邮箱收集弹窗 9（另有 app 接口契约 1、env 解析 5 并入既有文件）。
- 合并提交 SHA（`develop → main`）：部署后回填。

## 备份、验收与回滚

部署命令：`powershell -File server\scripts\deploy-zjyph.ps1 -Tag v2026.10.14 -ProdDir D:\ZJYPHFA`（正式发布，未使用 `-SkipBackup`/`-SkipSmoke`/`-AllowUntagged`）。

验收结果：**部署后回填**（发布前备份文件名与校验、`HEAD` 是否精确匹配 tag、`/health`、前端 8080、同源 `/api/v1` 代理、生产冒烟五项、PM2 重启次数、巡检结论）。

回滚：代码回滚走同一入口 `deploy-zjyph.ps1 -Tag v2026.10.11`（上一稳定 tag）。本批次**无数据库迁移，无需数据回滚**。

## 已知限制与残留风险

- 失败计数为**进程内存态**（单实例前提，生产 PM2 fork 成立）：后端重启即清零；改 cluster 需迁共享存储。
- **安全让步**：达阈值之前的登录尝试没有图形验证码，仅由登录限流（5 次/分钟）兜底；应急开关 `CAPTCHA_ALWAYS_REQUIRED=1` 可改 env 重启立即恢复「每次都要」。已记入 `安全与权限规范.md` v1.5。
- 登录限流与阈值同为 5 次/分钟：连错 5 次后第 6 次通常先返回 429，需等窗口过后才返回 428（实测行为）。
- 邮箱收集引导**仅前端拦截**，清 sessionStorage 或直接调接口即可绕过，不构成服务端鉴权；邮箱真实性不校验（仅格式 + 唯一性）。
- 生产 13 个账号当前 **0 个绑定邮箱**，自助找回需管理员先在用户管理分配邮箱后才有人可用。
