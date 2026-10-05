# FRP 内网穿透安全加固 设计规格

> 状态：待评审 | 日期：2026-10-05 | 范围决策：配置加固 + 运维面板鉴权审计

## 1. 背景与现状

ZJYPH 生产通过 frp 把本机 Windows 的 `127.0.0.1:8080` 前端经公网服务器暴露为
`https://zjyphfa.damaospace.ltd`。链路：浏览器 → nginx(443, TLS 终结) → `127.0.0.1:8080`
(frps vhostHTTP) → frp 控制通道 `:7000` (TLS + token) → frpc@本机 → `127.0.0.1:8080`。

生产服务器：腾讯云 Lighthouse `43.155.177.109`（Ubuntu 22.04）。frp 版本 0.71.0。

现状事实（依据 `frp-tunnel-config.md` 与本机运行时文件）：

- frps 线上 `bindAddr = "0.0.0.0"`，`vhostHTTPPort = 8080`，`vhostHTTPSPort = 8443`，
  `auth.method = "token"`，`transport.tls.force = true`，`webServer.addr = "127.0.0.1"`，
  `allowPorts = [{6000,6009}]`。
- frpc 本机 `frpc.toml` 明文 token，`transport.tls.enable = true`，单一 `http` 代理。
- 运维面板 `ops-panel/server.mjs` 监听 `127.0.0.1:3900`，零依赖，无鉴权、无操作审计。

## 2. 威胁模型

| 威胁 | 载体 | 现有防护 |
|---|---|---|
| T1 控制端口爆破 | 公网 `:7000` | 仅 token，无限源、无限速 |
| T2 vhost 端口意外暴露 | `8080/8443` 绑全网卡 | 仅 UFW 拦截（无内核级隔离） |
| T3 浏览器跨站触发面板动作（CSRF / DNS rebinding） | 本机 `127.0.0.1:3900` | 无 |
| T4 本机文件泄露 token / 口令 | `D:\ZJYPHFA\frp\*.toml` | 仅目录 gitignore，无 ACL |
| T5 控制通道 MITM | 公网 `:7000` 控制连接 | TLS 加密但不鉴别服务端（**本次不处理，见 §5**） |

## 3. 加固设计

### 3.1 网络暴露面（服务器）

1. `/etc/frp/frps.toml` 新增 `proxyBindAddr = "127.0.0.1"`。
   依据 frp 官方文档，`proxyBindAddr` 默认等于 `bindAddr`，故当前 vhost 端口监听
   `0.0.0.0`；显式回环后由内核保证不可达，不再依赖 UFW 正确性。
2. 删除 `allowPorts`（当前无 `remotePort` 代理，纯多余开放面）。
3. `:7000` **保持全网放行**（决策：避免家宽 IP 变动导致隧道中断），仅以 UFW `limit`
   做限速兜底（单源 IP 30 秒内约 6 次连接）。云防火墙本次不改。
4. `transport.tls.force = true` 保持。

### 3.2 运维面板鉴权与审计（本机）

新增 `ops-panel/lib/panel-guard.mjs`（零依赖纯函数模块）：

- `createToken()` / `loadOrCreateToken(file)`：32 字节随机 hex，持久化到 `ops-panel/.panel-token`。
- `isAllowedHost(host, port)`：Host 白名单（`127.0.0.1`/`localhost`/`[::1]` + 面板端口），阻断 DNS rebinding。
- `tokenMatches(provided, expected)`：`crypto.timingSafeEqual` 常量时间比较。
- `auditLine(fields)`：JSON Lines 审计记录。

`server.mjs` 接线：

- 请求入口先做 Host 白名单校验，不通过返回 403。
- 全部 `/api/*` 校验 `x-ops-token` 头，不通过返回 401。
- 非 GET 的 `/api/*` 在 `res` 的 `finish` 事件写审计（方法、路径、状态码、耗时、来源地址）。
- `serveStatic` 返回 `index.html` 时注入 `window.__OPS_TOKEN__`（同源策略使跨站无法读取）。

前端 `public/app.js`：`api()` 与 SSE 直连 `fetch` 统一携带 `x-ops-token`。

### 3.3 本机运行时资产

- `frpc.toml`、`frpc-start.vbs`、`.panel-token` 用 `icacls` 收紧到当前用户 + SYSTEM/Administrators。
- 删除冗余的 `D:\ZJYPHFA\frp\frps.toml`（服务端配置副本，含 token 与 dashboard 明文口令）。

### 3.4 已知边界

令牌注入可阻断**浏览器跨站**路径；**本机其他进程**仍可 `GET /` 读取注入值并复用令牌。
该威胁由 OS 用户隔离与文件 ACL 承担，本次不引入登录口令，避免运维摩擦。

## 4. 非目标（本次不做）

- frpc 校验 frps 证书（`trustedCaFile` / mTLS）。
- frpc 看门狗自愈。
- frps dashboard 口令轮换。
- nginx 配置清理（仅订正文档描述，不改线上 nginx）。

## 5. 残留风险

- T5 控制通道仍只加密不鉴别服务端，具备链路劫持能力者可 MITM 并窃取 token。
- 本机任意进程可读取注入令牌（§3.4）。
- `:7000` 仍对全网开放，仅靠 token 强度与 UFW 限速抵抗爆破（未做 IP 限源）。

## 6. 验收标准

1. 服务器 `ss -ltnp` 显示 `8080/8443/7500` 绑 `127.0.0.1`，`:7000` 绑 `0.0.0.0` 且 UFW 规则为 `LIMIT`。
2. `frps verify` / `frpc verify` 通过；公网 `curl --noproxy '*' https://zjyphfa.damaospace.ltd/` 返回 200。
3. 面板：无令牌 `/api/status` → 401；错误 Host → 403；带令牌 → 200；UI 功能正常；`audit.log` 有记录。
4. 本机 `frp\*.toml` ACL 仅当前用户 + SYSTEM/Administrators 可读写。

## 7. 回滚

- 服务器：改前备份 `/etc/frp/frps.toml.bak-<时间戳>`；异常 `cp` 回滚 + `systemctl restart frps`。
  UFW 记录原规则，异常时恢复 `ufw allow 7000/tcp`。
- 本机/仓库：面板代码走 `git revert` + 重新发版；运行时文件用 `config-backups` 或 `.bak` 还原。
