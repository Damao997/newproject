# ZJYPH 运维面板

该面板仅监听 `127.0.0.1:3900`，用于本机查看服务状态、日志、备份和 FRP 状态。

首次配置：

1. 复制 `runtime-config.example.json` 为 `runtime-config.json`，填写端口与访问域名。
2. 如需 AI 诊断，复制 `config.example.json` 为 `config.json` 并填写密钥。
3. 运行 `powershell -File start-panel.ps1`。

`config.json`、`runtime-config.json`、`config-backups/` 均为本机运行数据，已被 `.gitignore` 排除。任何真实密钥不得提交到 Git。

## 访问安全

- 面板仅监听 `127.0.0.1`，且请求入口校验 `Host` 白名单（`127.0.0.1` / `localhost` / `[::1]`）阻断 DNS rebinding。
- 所有 `/api/*` 请求必须携带 `X-Ops-Token` 头；令牌由服务启动时生成并保存在本机 `ops-panel/.panel-token`（已 gitignore + 权限收紧），由页面自动注入，无需手工填写。
- 所有非 GET 的 `/api/*` 动作会记录到 `ops-panel/logs/audit.log`（方法、路径、状态码、耗时、来源地址）。
- 令牌在页面加载时注入，只在那一刻有效：页面停留过久（跨令牌轮换）或停留在改造前的旧页面时会失效。此时前端收到 401 会静默重载一次自动换回新令牌（`sessionStorage` 去重、成功后清除，避免死循环），无需人工刷新。浏览器禁用 `sessionStorage` 时回退为提示错误，需手动重载页面。
- 已知边界：本机其他进程仍可直接读取页面注入的令牌，该路径由操作系统用户隔离与文件权限承担。
