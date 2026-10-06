# v2026.10.9 账号安全：图形验证码、邮箱找回密码与邮箱唯一发布记录

发布日期：2026-10-06。上一稳定版本：v2026.10.8。变更分类：用户可感知的功能（登录安全加固、密码自助找回）、管理员可感知的字段变更（邮箱），以及生产冒烟脚本的契约适配。

## 发布范围

1. **登录图形验证码**：新增 `server/src/services/CaptchaService.ts` 与公开端点 `GET /api/v1/auth/captcha`（30 次/分钟限流）；登录请求体新增 `captchaId`/`captcha`，`AuthService.login` 在校验密码**之前**先验验证码（一次性消费，失败不记 `login_failed` 审计以避免噪音，暴力尝试由登录限流与拉图限流兜底）。登录页在密码字段后新增验证码区块，点击图片可刷新，登录失败自动换图。
2. **忘记密码（邮箱验证码）**：新增 `PasswordResetService` 与公开端点 `POST /api/v1/auth/forgot-password`、`POST /api/v1/auth/reset-password`（均受 `passwordResetRateLimiter`）；验证码仅存 SHA-256 哈希、10 分钟有效、60 秒重发冷却、错误尝试达上限即作废；重置成功吊销该账号全部会话。登录页新增「忘记密码」弹窗。**防枚举**：申请接口的响应与账号是否存在无关。
3. **邮件服务未配置时的降级**：新增公开端点 `GET /api/v1/auth/login-options`，返回 `mailConfigured`；生产未配置 SMTP 时，「忘记密码？」保留原有「请联系平台管理员重置密码」的指引文案，不把用户引向必然失败的流程。
4. **用户邮箱唯一与维护**：`user.email` 增加唯一索引，作为密码找回的收件目标；管理员用户管理页新增邮箱字段（格式校验 + 唯一性预检，冲突返回 409「该邮箱已被其他账号使用」），导出 Excel 增加邮箱列。
5. **个人资料改邮箱口径统一**：`PersonalSettingsService.updateProfile` 对邮箱做去空格 + 小写归一（与管理员维护、找回查找三处口径一致），写库前做唯一性预检，并把唯一索引冲突（P2002）映射为 409 而非 500；个人资料页邮箱提示改为「用于联系与密码找回，登录仍使用用户名」。
6. **生产冒烟脚本适配（必须与本批次同版本发布）**：登录已强制图形验证码，脚本无法反解 SVG 答案，故第 4 项由「错误密码应 401」改为「缺少验证码应被拒（400，兼容旧契约 401）」；第 5 项由「近 2 分钟内有登录审计」改为「审计写入通道可用（近 7 天有记录）」——登录失败不再产生审计，凌晨发布时原窗口会误报。
7. **随批入库的开发工具**（不参与部署产物）：`server/package.json` 新增 `dev:db-check`；`.gitignore` 忽略 `server/.mail-out/`（`MAIL_DEV_CAPTURE=1` 时落盘的邮件含验证码明文）。

## 数据与依赖

唯一迁移为 `20261005000538_add_password_reset_code`：`user.email` 建唯一索引（可空列，多个 NULL 不冲突），新建 `password_reset_code` 表（外键 `ON DELETE CASCADE`，索引 user_id / expires_at）。**只增不改不删**，旧代码可保留该增量结构。

新增运行时依赖：`nodemailer`、`svg-captcha`；开发依赖：`@types/nodemailer`。生产**未配置任何 SMTP 环境变量**，因此 `POST /auth/forgot-password` 返回 503「邮件服务未配置」，登录与其他功能不受影响；配置 SMTP 后无需改代码即可启用。

## 发布门禁

功能分支先经 PR/CI 合入 develop，develop 再经 PR/CI 合入 main；正式注释 tag 指向最终 main 合并提交，不直推 main。提交前在隔离工作区执行完整 `npm run verify`。

**迁移前置门禁（部署前必做，已执行）**：对生产库只读检查 `user.email` 存量数据——精确重复 0、大小写不敏感重复 0、空串 0；11 个用户邮箱全部为 NULL。唯一索引可安全创建。

## 备份、验收与回滚

发布前全量加密备份 `zjyph_prod_20261006_120912.dump.enc`（4.13 MB）已生成并通过自动校验。部署于 2026-10-06 12:09:12 开始、12:16 结束，退出码 0：停进程 → 检出 tag `v2026.10.9` → 前后端 `npm ci` 与分阶段构建 → 启动 PostgreSQL → `prisma migrate deploy` → 原子切换产物 → 重载 backend/frontend。

**迁移结果**：`20261005000538_add_password_reset_code` 于 12:15:43 应用成功。结构核对：`user_email_key` 唯一索引存在、`password_reset_code` 表存在、外键 `password_reset_code_user_id_fkey` 的删除规则为 **CASCADE**。迁移前置门禁在部署前复核：生产库精确重复 0、大小写不敏感重复 0、空串 0，11 个用户邮箱全为 NULL。

**部署后验收**：生产 `HEAD` 精确匹配 `v2026.10.9`，工作区无已跟踪漂移；`ops-check-zjyph.ps1` 全绿（三进程 online、`/health` 双 up、前端 8080、同源 `/api/v1` 401、磁盘、备份时效、连接数）；`production-smoke-zjyph.ps1`（本版本已适配强制验证码）五项全 PASS：`/health`、前端首页、未授权 401、登录接口强制图形验证码、审计通道可用；PM2 三进程均 online（postgres pid 22012 重启 1 次、backend pid 38524、frontend pid 39812）。

**接口与页面实测**：`GET /auth/login-options` 返回 `{"mailConfigured":false,"captchaRequired":true}`；`GET /auth/captcha` 200；`POST /auth/forgot-password` 对未绑定邮箱的账号返回 200（防枚举语义，不发信）。生产登录页用真实浏览器实测 **7/7 通过**：验证码渲染与点击刷新、未配邮件时「忘记密码」降级为「请联系平台管理员重置密码」且不打开自助弹窗、无页面级 JS 异常。

正式合并 SHA（`137b2f4a`）、PR（#26 `feat/account-security` → develop、#27 develop → main）、备份文件、迁移与验收明细同时保存在生产 `logs/release-v2026.10.9.json`。

回滚目标为 v2026.10.8，仍调用统一 `deploy-zjyph.ps1 -Tag`。迁移为增量结构，回滚代码不涉及数据恢复；回滚期间若用旧版界面维护邮箱，唯一索引冲突会以 409 呈现，不丢数据。

## 已知限制

- 生产未配置 SMTP，「忘记密码」在邮件服务配置前不可用（入口降级为联系管理员指引）；启用只需在生产 `.env` 增加 `SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/MAIL_FROM` 并重启后端。
- **残余信息差异（低风险，建议配置邮件时一并收敛）**：未配置邮件服务时，若账号**已绑定邮箱**，`forgot-password` 会因发信失败返回 503，而「账号不存在 / 未绑定邮箱」返回 200——两者响应不同，理论上可用于探测哪些账号绑定了邮箱。当前生产所有账号均未绑定邮箱，且前端在未配邮件时不展示该入口，实际风险低；配置 SMTP 后该差异自然消失。若要彻底消除，可在账号查询之前先做邮件配置检查并统一返回 503。
- `CaptchaService` 与限流均为**进程内存态**，仅适用于 PM2 fork 单实例（现状成立）；将来改 cluster 需迁移到共享存储。
- 冒烟第 4/5 项为适配强制验证码后的等价校验，覆盖强度弱于原「错误密码 401 + 登录审计落库」，已在脚本内注明原因。
