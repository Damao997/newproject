# ZJYPH 运维面板

该面板仅监听 `127.0.0.1:3900`，用于本机查看服务状态、日志、备份和 FRP 状态。

首次配置：

1. 复制 `runtime-config.example.json` 为 `runtime-config.json`，填写端口与访问域名。
2. 如需 AI 诊断，复制 `config.example.json` 为 `config.json` 并填写密钥。
3. 运行 `powershell -File start-panel.ps1`。

`config.json`、`runtime-config.json`、`config-backups/` 均为本机运行数据，已被 `.gitignore` 排除。任何真实密钥不得提交到 Git。
