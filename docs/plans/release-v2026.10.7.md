# v2026.10.7 frp 内网穿透与运维面板安全加固 发布记录

## 一、变更内容（安全加固，最终用户不可感知）

本次不改动业务功能与用户界面，只收敛运维侧的攻击面，分两块。

### 1. 网络暴露面（生产服务器）

- `frps.toml` 新增 `proxyBindAddr = "127.0.0.1"`。此前 `bindAddr = "0.0.0.0"` 且未设 `proxyBindAddr`（frp 默认等于 `bindAddr`），导致 vhost 端口 `8080/8443` 实际监听全网卡，仅靠 UFW 拦截；实测加固前 `ss -ltnp` 显示 `*:8080` / `*:8443`。现在由内核层收敛到回环，不再依赖防火墙规则正确性。
- 删除 `allowPorts`（`6000-6009`）：当前无 `remotePort` 代理使用，属无效开放面。
- UFW 对 `:7000` 由 `ALLOW` 改为 `LIMIT`（单源 IP 约 30 秒 6 次连接）。
  **刻意不做 IP 限源**：家宽出口 IP 变动会导致隧道中断并需人工恢复，可用性优先；该残留风险已写入 `frp-tunnel-config.md`。
- 删除本机冗余副本 `D:\ZJYPHFA\frp\frps.toml`（内含明文 token 与 dashboard 口令，服务器为唯一权威副本）。
- 对 `D:\ZJYPHFA\frp\frpc.toml` 与 `frpc-start.vbs` 用 `icacls` 收紧 ACL（仅当前用户 + SYSTEM + Administrators）。

### 2. 运维面板鉴权与审计

- 新增 `ops-panel/lib/panel-guard.mjs`（零依赖纯函数模块）：令牌生成/持久化、Host 白名单、常量时间令牌比较、审计行生成。
- `ops-panel/server.mjs` 请求入口新增：`Host` 白名单（阻断 DNS rebinding，不匹配返回 403）；全部 `/api/*` 校验 `X-Ops-Token` 头（不匹配返回 401）；非 GET 的 `/api/*` 写入 `ops-panel/logs/audit.log`。
- 令牌由服务启动时生成到 `ops-panel/.panel-token`（已 gitignore + ACL 收紧），并在返回 `index.html` 时注入 `window.__OPS_TOKEN__`，由前端 `api()` 统一携带。
- `ops-panel/start-panel.ps1` 在服务就绪后收紧令牌文件权限；`ops-panel/README.md` 与 `frp-tunnel-config.md` 补充说明。

**已知边界**：令牌注入可阻断浏览器跨站（CSRF / DNS rebinding），但本机其他用户或进程仍可读取注入的令牌；该路径由操作系统用户隔离与文件 ACL 承担。

## 二、影响文件

- `ops-panel/lib/panel-guard.mjs`（新增）
- `ops-panel/lib/panel-guard.test.mjs`（新增）
- `ops-panel/server.mjs`
- `ops-panel/public/app.js`
- `ops-panel/start-panel.ps1`
- `ops-panel/README.md`
- `frp-tunnel-config.md`
- `.gitignore`
- `docs/superpowers/specs/2026-10-05-frp-security-hardening-design.md`（新增）
- `docs/superpowers/plans/2026-10-05-frp-security-hardening.md`（新增）

生产服务器与本机运行时改动（`/etc/frp/frps.toml`、UFW、`D:\ZJYPHFA\frp\*`）不在仓库内，仅在本记录与 `frp-tunnel-config.md` 中文档化。

## 三、迁移与依赖

本次无数据库迁移（部署时 `prisma migrate deploy` 报 `No pending migrations to apply`），无依赖升级，无环境变量或构建配置变更。

## 四、验收结果

- 开发侧：`node --test ops-panel/lib/panel-guard.test.mjs` 7/7 通过；`npm run verify` 全量通过（server 67 个测试文件 + web 66 个测试文件 + 命名检查/类型检查/构建）。
- 隔离实例冒烟：无令牌 → 401；错误 Host → 403；带令牌 → 200；首页注入令牌；审计文件落盘。
- 浏览器实机：面板「总览」在令牌鉴权下取到真实数据（三进程 online、后端/前端健康）。
- 服务器：`frps verify` 通过；重启后 `ss -ltnp` 确认 `8080/8443/7500` 绑 `127.0.0.1`、`:7000` 保持 `0.0.0.0` 并被 UFW `LIMIT`；公网 `https://zjyphfa.damaospace.ltd/` 返回 200。
- 生产部署：`deploy-zjyph.ps1 -Tag v2026.10.7` 退出码 0；发布前备份 `zjyph_prod_20261005_110403.dump.enc`（4.13 MB）校验通过；冒烟 5 项全 PASS（后端 /health、前端 8080、未授权 401、登录错误密码 401、审计日志落库）。
- 部署后重启运维面板：无令牌 `/api/status` → 401；错误 Host → 403；带令牌 → 200 且返回真实 PM2 数据；`POST /api/config/validate` 在 `ops-panel/logs/audit.log` 留下审计行。

## 五、发布方式与回滚

- 合并提交：`2a2541d7`（PR #23，`security/frp-hardening` → `main`）。
- 正式 tag：`v2026.10.7`（带注释），指向 `2a2541d7`，属 `origin/main`。
- 上一稳定版本为 `v2026.10.6`；代码回滚仍使用同一入口：
  `server/scripts/deploy-zjyph.ps1 -Tag v2026.10.6`。
- 服务器 `frps.toml` 改动已备份为 `/etc/frp/frps.toml.bak-20261005005713`；UFW 恢复方式为 `sudo ufw delete limit 7000/tcp && sudo ufw allow 7000/tcp`。
- **注意**：`deploy-zjyph.ps1` 不重启运维面板进程，本次已手工重启（否则 3900 上仍运行旧面板代码）。

## 六、对外公告

本次为运维侧安全加固，无用户可感知的功能、界面或口径变化，**本次无对外公告项**。
