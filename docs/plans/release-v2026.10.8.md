# v2026.10.8 审计日志人话化与真实客户端 IP 修复发布记录

发布日期：2026-10-06。上一稳定版本：v2026.10.7。变更分类：用户可感知的体验优化与生产缺陷修复，另含开发/运维工具改进（不参与部署产物）。

## 发布范围

1. **审计日志可读性**：时间线改为「谁在什么时候做了什么」的白话摘要；新增「简明 / 完整」双视图（简明面向非技术同事，完整保留原始 detail、操作对象 ID 与链路 ID）；登录失败、越权拦截、彻底删除用户、批次回滚、指标彻底删除/驳回标出「需关注」；分类名由「数据/权限」改为「数据变更 / 权限与安全」；导出 Excel 增加「操作摘要」列，操作对象改用富化名称。
2. **服务端名称富化**：新增 `server/src/services/audit-labels.ts`，仅对当前页（≤20 条）批量解析 `targetId` 与 detail 中的编码为业务名称（用户、角色、公司、科目、指标、产品品类、运营费用映射、报告/模板/汇总分析、导入批次、业务员/催收计划/客商等），查询失败静默降级为空标签，不影响审计列表本身。
3. **真实客户端 IP 修复**：`web/serve-static.cjs` 的 `clientIpForProxy` 由「取 X-Forwarded-For 最右一项」改为「从右往左跳过回环跳数、取第一个非回环合法 IP」。根因是 frps v0.71.0 的 vhost 反向代理（`pkg/util/vhost/http.go`：`r.SetXForwarded()`）会把 nginx 的回环地址追加到 XFF 最右侧，旧逻辑因此把公网登录 IP 记成 127.0.0.1。生产日志佐证：09-20/09-21 公网 IP 记录正常，自 09-22 换用 serve-static 后归零。局域网直连分支保持原样，防伪造语义不变。
4. **刷新审计补 IP**：`AuthService.refresh` 增加 `meta` 参数并落 `ip/user_agent/trace_id`，消除该类记录 IP 为空。
5. **开发/运维工具（随批入库，不参与部署产物）**：`dev:up` / `dev:check` 一键起停与连通性校验、`dev:db-check`、开发三端口单一来源（`DB_PORT`/`DATABASE_URL` 端口不再两处写死）、`local-db.ts` 端口解析统一；`deploy-zjyph.ps1` 新增发布前 sparse-checkout 集合必须含 `ops-panel` 且面板入口必须存在两条硬校验（防止 2026-10-02 面板被清理出工作区的静默故障重演）。

## 数据与依赖

**本次无数据库迁移**。不新增或升级运行时依赖（`server/package.json` 仅新增 `dev:db-check` 脚本，不引入 nodemailer/svg-captcha，后者属下一批次账号安全）。生产沿用 8080/3100/5433 与同源 API，不更改真实环境配置。

## 发布门禁

功能分支先经 PR/CI 合入 develop，develop 再经 PR/CI 合入 main；正式注释 tag 指向最终 main 合并提交，不直推 main。提交前在隔离工作区执行完整 `npm run verify`（check:naming + typecheck + vitest + server build + web lint + web 单测 + serve-static 静态测试 + web build）。

本批次不改动登录契约（不引入图形验证码），因此生产冒烟 `production-smoke-zjyph.ps1` 按原样执行并应全 PASS——这是本批次可独立回滚的关键前提。

## 备份、验收与回滚

发布前全量加密备份 `zjyph_prod_20261006_095046.dump.enc`（4.13 MB）已生成并通过自动校验。部署于 2026-10-06 09:50:46 开始、10:00 结束，退出码 0：停进程 → 检出 tag `v2026.10.8` → 前后端 `npm ci` 与分阶段构建 → 启动 PostgreSQL → `migrate deploy`（无待应用迁移）→ 原子切换产物 → 重载 backend/frontend。

部署后验收：生产 `HEAD` 精确匹配 `v2026.10.8`，工作区无已跟踪漂移；`ops-check-zjyph.ps1` 全绿（三进程 online、`/health` 双 up、前端 8080、同源 `/api/v1` 401、磁盘、备份时效、连接数）；`production-smoke-zjyph.ps1` 五项全 PASS（`/health`、前端首页、未授权 401、错误密码 401、审计落库）；PM2 三进程均 online（postgres pid 22368、backend pid 18688、frontend pid 22560）。部署产物 `web/dist/assets/audit-logs-awGWM99d.js` 已包含新的「简明视图 / 完整视图」与「需关注」文案。

**真实客户端 IP 修复的功能验证**：从公网经 `https://zjyphfa.damaospace.ltd/api/v1/dashboard/overview` 发起一次未授权请求，生产访问日志记录为 `[ip=103.151.173.99]`（真实公网来源地址），不再出现修复前的 `127.0.0.1`。

正式合并 SHA（`17bae79e`）、PR（#24 `feat/audit-log-plain` → develop、#25 develop → main）、备份文件、巡检与冒烟明细同时保存在生产 `logs/release-v2026.10.8.json`。

回滚目标为 v2026.10.7，仍调用统一 `deploy-zjyph.ps1 -Tag`。本批次无迁移，回滚不涉及数据恢复。

## 已知限制

- `deploy-zjyph.ps1` 的 sparse 守卫在本批次 tag 内，但**生效时机是下一次部署**（本批次部署时运行的仍是 v2026.10.7 的旧脚本副本，进程已加载旧内容）。
- 真实客户端 IP 已在生产经公网访问实测通过；本地开发为局域网直连，走非回环分支，无法覆盖该路径。
