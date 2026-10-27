# ZJYPH 内网穿透（frp）与防火墙端口配置

> 环境：腾讯云 Lighthouse `43.155.177.109`（Ubuntu 22.04，主机名 `VM-0-14-ubuntu`）+ 本机 Windows 生产机
> frp 版本：0.71.0（linux_amd64 / windows_amd64）
> 域名：`zjyphfa.damaospace.ltd`
>
> ⚠️ 文中 `auth.token`、`webServer.password` 已替换为 `<REDACTED>`，实际值见各自文件位置说明。

---

## 拓扑

```
浏览器 → https://zjyphfa.damaospace.ltd:443
           → nginx (TLS 终结)
             → 127.0.0.1:8080  frps vhostHTTPPort
               → frp 控制通道 :7000 (TLS + token)
                 → frpc @ 本机 Windows
                   → 127.0.0.1:8080  本机前端
```

---

## 1. 客户端 `D:\ZJYPHFA\frp\frpc.toml`

> 该目录已整目录 gitignore（`frp/` 不入库），token 只存本地。

```toml
serverAddr = "43.155.177.109"
serverPort = 7000

auth.method = "token"
auth.token  = "<REDACTED>"            # 必须与服务端 frps.toml 完全一致

transport.tls.enable = true           # v0.50+ 默认开启，显式声明防降级
loginFailExit = false                 # 连接失败不退出，持续重连（适合常驻自启）
transport.heartbeatInterval = 30
transport.heartbeatTimeout  = 90

log.to = 'd:\ZJYPHFA\frp\logs\frpc.out.log'
log.level = "info"
log.maxDays = 7

[[proxies]]
name = "zjyph-web"
type = "http"
localIP = "127.0.0.1"
localPort = 8080
customDomains = ["zjyphfa.damaospace.ltd"]
```

启动方式：`frpc-start.vbs` 静默拉起，或由运维面板（`ops-panel/server.mjs`）托管。

---

## 2. 服务端 `/etc/frp/frps.toml`

> 文件权限 `-rw-r----- root:root`。

```toml
bindAddr = "0.0.0.0"
bindPort = 7000

transport.tls.force = true            # 只接受 TLS 控制连接

auth.method = "token"
auth.token  = "<REDACTED>"

# vhost 端口只监听回环（内核层面不可达，不依赖 UFW）
proxyBindAddr = "127.0.0.1"

# vhost 端口：80/443 归 nginx 所有，故 frps 用高位端口，由 nginx 反代进来
vhostHTTPPort  = 8080
vhostHTTPSPort = 8443

# 管理面板只绑回环，公网不可见
webServer.addr     = "127.0.0.1"
webServer.port     = 7500
webServer.user     = "admin"
webServer.password = "<REDACTED>"
```

> `allowPorts` 已于 2026-10-05 删除：当前无 `remotePort` 代理使用，白名单属多余开放面。

systemd 单元 `/etc/systemd/system/frps.service`：

```ini
[Unit]
Description=Frp Server (frps)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.toml
Restart=on-failure
RestartSec=5s
LimitNOFILE=1048576
# hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=

[Install]
WantedBy=multi-user.target
```

### 本机不再保留服务端配置副本

本机 `D:\ZJYPHFA\frp\frps.toml` 曾是线上配置的副本，内含明文 token 与 dashboard 口令，属多余泄露面，已于 2026-10-05 删除。**服务端配置以 SSH 登录后的 `/etc/frp/frps.toml` 为唯一权威**，本机需要查看时按本文档或直接 SSH 查看。

---

## 3. nginx 反向代理 `/etc/nginx/sites-enabled/damaospace`

路由总览：

| listen | server_name | 去向 |
|---|---|---|
| 80 | `damaospace.ltd` `app.damaospace.ltd` `admin.damaospace.ltd` | `301 → https://$host$request_uri` |
| 443 | `admin.damaospace.ltd` | `http://127.0.0.1:7500`（frps 面板，叠加 `auth_basic`） |
| 443 | `zjyphfa.damaospace.ltd` | `http://127.0.0.1:8080`（frps vhostHTTPPort） |

server_name 声明顺序有意为之：apex/具体主机在通配之前匹配。

```nginx
# --- 80: ACME + 全局跳转 https ---
server {
    listen 80;
    listen [::]:80;
    server_name damaospace.ltd app.damaospace.ltd admin.damaospace.ltd;
    return 301 https://$host$request_uri;
}

# --- 443: admin 子域 -> frps dashboard（basic-auth 保护）---
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name admin.damaospace.ltd;

    ssl_certificate     /etc/nginx/ssl/damaospace.ltd.fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/damaospace.ltd.key.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options            "SAMEORIGIN"   always;
    add_header X-Content-Type-Options     "nosniff"      always;
    add_header Referrer-Policy            "no-referrer"  always;

    auth_basic "frp dashboard";
    auth_basic_user_file /etc/nginx/.htpasswd_frp;

    location / {
        proxy_pass http://127.0.0.1:7500;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 5s;
        proxy_read_timeout    30s;
    }
}

# --- 443: 业务子域 -> frps vhostHTTPPort ---
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name zjyphfa.damaospace.ltd;

    ssl_certificate     /etc/nginx/ssl/damaospace.ltd.fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/damaospace.ltd.key.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options            "SAMEORIGIN"   always;
    add_header X-Content-Type-Options     "nosniff"      always;
    add_header Referrer-Policy            "no-referrer"  always;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_intercept_errors on;
        error_page 404 502 503 504 = @frp_offline;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 透传
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_ssl_verify off;
        proxy_ssl_server_name on;
    }

    location @frp_offline {
        default_type text/html;
        add_header Cache-Control "no-store" always;
        return 503 "Service temporarily unavailable";
    }
}
```

> 备注：① nginx 文件头注释写的是「子域 → `127.0.0.1:8443`」，但实际 `proxy_pass` 指向 `8080`，与 frps `vhostHTTPPort = 8080` 一致——注释为陈旧内容，配置本身正确；`proxy_ssl_*` 对 http 上游不生效，属冗余指令。② frps 侧 vhost 端口自 2026-10-05 起由 `proxyBindAddr = "127.0.0.1"` 收敛到回环。③ `admin.damaospace.ltd` 当前**无 DNS 记录**（114 / 8.8.8.8 均 NXDOMAIN），该 dashboard 入口公网打不开。

---

## 4. 防火墙端口（三层，缺一不可）

### ① 腾讯云 Lighthouse 云防火墙（控制台侧配置）

| 端口 | 用途 |
|---|---|
| `22/tcp` | SSH |
| `7000/tcp` | frp 控制通道（frpc 出连入口） |
| `80/tcp` | HTTP → 301 https / ACME |
| `443/tcp` | 业务站点 + frp 面板入口 |

排障要点：**云防火墙与主机 UFW 是两套独立规则**，任一关闭都会表现为「ICMP 通、TCP 超时」，而 80/443 仍正常服务。

### ② 服务器主机防火墙 UFW

`Status: active` / `Logging: on (low)` / `Default: deny (incoming), allow (outgoing), disabled (routed)` / `New profiles: skip`

```
22/tcp     ALLOW IN  Anywhere
7000/tcp   LIMIT IN  Anywhere        # 2026-10-05 起由 ALLOW 改为 LIMIT（单源 IP 30s 约 6 次连接）
80/tcp     ALLOW IN  Anywhere        # frp dashboard http -> 301 https
443/tcp    ALLOW IN  Anywhere         # frp dashboard https
22/tcp (v6)   ALLOW IN  Anywhere (v6)
7000/tcp (v6) LIMIT IN  Anywhere (v6)
80/tcp (v6)   ALLOW IN  Anywhere (v6)
443/tcp (v6)  ALLOW IN  Anywhere (v6)
```

**故意不对公网放行、且已由 frps 绑定到回环**（自 2026-10-05 起，不再仅依赖 UFW）：`8080`（frps vhostHTTP）、`8443`（frps vhostHTTPS）、`7500`（frps 面板）。

> `:7000` 仍对全网放行，仅靠 token 强度与 UFW 限速抵抗爆破。**未做 IP 限源**是刻意取舍：家宽出口 IP 变动会导致隧道中断，需要手动改规则。若日后要收紧，可把 UFW 与云防火墙的来源改为生产机出口 IP。

> `iptables -S` 中存在额外的 `YJ-FIREWALL-INPUT` 链，且 `:INPUT` 首条规则即跳转至它（云镜/主机安全组件残留）。排查端口问题时需一并核查，不要只看 UFW。

### ③ 本机 Windows Defender 防火墙（入站规则）

| DisplayName | Direction | Action | Enabled |
|---|---|---|---|
| `ZJYPH-web-8080` | Inbound | Allow | True |
| `ZJYPH-api-3100` | Inbound | Allow | True |
| `Node.js JavaScript Runtime` | Inbound | Allow | True |
| `Node.js JavaScript Runtime` | Inbound | Allow | True |

frpc 为纯出站连接，无需额外入站规则。

### 端口一览

| 端口 | 位置 | 暴露范围 | 说明 |
|---|---|---|---|
| 3100 | 本机 Windows | 内网（Windows FW 放行） | 后端 API |
| 5433 | 本机 Windows | `127.0.0.1` only | 嵌入式 PostgreSQL |
| 8080 | 本机 Windows | `0.0.0.0` + Windows FW 放行 | 前端静态服务 |
| 22 | 服务器 | 公网 | SSH |
| 80 / 443 | 服务器 nginx | 公网 | 入口 |
| 7000 | 服务器 frps | 公网（UFW `LIMIT`） | frp 控制通道（TLS + token） |
| 8080 | 服务器 frps | `127.0.0.1`（`proxyBindAddr`） | vhostHTTP |
| 8443 | 服务器 frps | `127.0.0.1`（`proxyBindAddr`） | vhostHTTPS（当前未使用） |
| 7500 | 服务器 frps | `127.0.0.1` | 管理面板 |
| 3900 | 本机 Windows | `127.0.0.1` only | 运维面板（需 `X-Ops-Token`） |

---

## 5. 运维面板访问安全（2026-10-05 起）

面板 `ops-panel/server.mjs` 仍是零依赖、仅监听 `127.0.0.1:3900`，但请求入口新增两层校验：

| 机制 | 作用 |
|---|---|
| `Host` 白名单 | 仅接受 `127.0.0.1:3900` / `localhost:3900` / `[::1]:3900`，阻断 DNS rebinding |
| `X-Ops-Token` 令牌 | 全部 `/api/*` 必须携带；令牌存于本机 `ops-panel/.panel-token`（已 gitignore + ACL 收紧），由页面自动注入，无需手工填写 |
| 操作审计 | 所有非 GET 的 `/api/*` 写入 `ops-panel/logs/audit.log`（方法、路径、状态码、耗时、来源地址） |
| 令牌失效自愈 | 令牌随页面加载注入、停留过久即失效；前端遇 401 静默重载一次换回新令牌（`sessionStorage` 去重、成功后清除），不需要人工刷新 |

**已知边界**：令牌注入能阻断浏览器跨站（CSRF / DNS rebinding），但本机其他用户或进程仍可 `GET /` 读到注入的令牌；该路径由操作系统用户隔离与文件 ACL 承担。自愈依赖浏览器 `sessionStorage`，被禁用时回退为提示错误、需手动重载页面。

---

## 敏感信息位置（不外发）

| 项 | 位置 |
|---|---|
| frp token | 服务器 `/etc/frp/frps.toml`、本机 `D:\ZJYPHFA\frp\frpc.toml` |
| 运维面板访问令牌 | 本机 `D:\ZJYPHFA\ops-panel\.panel-token`（icacls 仅当前用户 + SYSTEM/Administrators） |
| frps 面板账号密码 | 服务器 `/etc/frp/frps.toml` |
| 面板 basic-auth 口令文件 | 服务器 `/etc/nginx/.htpasswd_frp` |
| TLS 私钥 | 服务器 `/etc/nginx/ssl/damaospace.ltd.key.pem` |
| 腾讯云 API 凭据 | 服务器 `/etc/frp/dnspod-SecretId`、`/etc/frp/dnspod-SecretKey`（`0600 root:root`） |

轮换 token 时需同步修改 `frpc.toml` 与 `frps.toml` 两处，再 `systemctl restart frps` 并重启本机 frpc。
