# DevOps 与部署规范（模块 14）

> **当前实际部署形态**：内网、非 Docker（生产目录 `D:\ZJYPH-prod`，PM2 托管）。
> 本文前半部分为 Docker 资产说明（**未来迁移路径**，暂未启用），
> 实际部署与运维以本文末尾的「内网非 Docker 部署与运维」章节为准。

## 技术栈（以项目现有为准）

- **容器化**：Docker（server/Dockerfile + web/Dockerfile → 多阶段构建）
- **编排**：Docker Compose（4 服务：postgres + backend + frontend + db-backup）
- **反向代理**：Nginx（frontend 容器内，配 gzip / 安全头 / SSE proxy_buffering off）
- **部署架构**：内网 Docker 单机
- **CI/CD**：当前无自动流水线（后续可接入 GitHub Actions）
- **监控**：当前无 Prometheus/Grafana（后续实现）

## Docker 架构

```
nginx(80) → frontend(nginx静态托管)
           → backend(3001) → postgres(5432)
                            → db-backup(定时cron)
```

## 部署配置

| 服务 | 镜像 | 端口 | 健康检查 |
|------|------|------|---------|
| postgres | postgres:15-alpine | 5432 | pg_isready |
| backend | 多阶段构建 | 3001 | （待添加 `/health` 探针） |
| frontend | 多阶段构建 → nginx:alpine | 80 | nginx 自动 |
| db-backup | postgres:15-alpine | — | — |

## 环境变量管理

- **所有敏感信息走环境变量**，通过 `.env` 文件注入 docker-compose
- 变量清单 → `.env.example`
- 生产环境通过 Docker Secret 或手动配置，禁止明文写入配置文件

## 备份策略

- **全量备份**：每日凌晨 2:00 pg_dump
- **WAL 归档**：每小时（持续归档）
- **加密**：openssl aes-256-cbc
- **保留策略**：全量 30 天 / WAL 7 天
- **恢复演练**：季度执行

## 质量要求

- Dockerfile 多阶段构建（已有：server/Dockerfile + web/Dockerfile）
- 容器配置健康检查探针（postgres 已配，backend 待补充）
- 环境变量通过 Secret 管理，严禁明文写入配置文件
- 日志结构化输出（待实现 JSON 格式）
- 构建产物最小化（alpine 基础镜像）

## 详细参考

- Docker Compose 配置 → Read `docker-compose.yml`
- Nginx 配置 → Read `nginx.conf`
- 部署运维完整文档 → Read `docs/plans/部署运维规范.md`
- 备份脚本 → Read `backup.sh`
- 数据库初始化 SQL → `server/prisma/init-roles.sql`

## 内网非 Docker 部署与运维（当前实际方案，ZJYPH 生产环境）

### 目录布局（与开发环境 D:\flies\pj3 完全隔离）

```
D:\ZJYPH-prod    生产代码（git 检出 tag，严禁开发操作）
  ├─ server\    后端（.env 为生产专用，不进 git）
  ├─ web\       前端
  └─ logs\      生产日志（pm2-logrotate 轮转，保留 30 天）
D:\ZJYPH-data    生产 PostgreSQL 数据目录（embedded-postgres 实例）
D:\ZJYPH-backup  加密备份（full\ 目录 + logs\）
D:\ZJYPH-tools   PostgreSQL 官方 zip 二进制（pg_dump/psql/pg_restore，免安装）
```

### 端口与进程（PM2 托管，开机自启）

| 服务 | 端口 | 进程名 | 说明 |
|------|------|--------|------|
| PostgreSQL | 5433（仅 127.0.0.1） | zjyph-postgres | embedded-postgres 17，数据目录 D:\ZJYPH-data |
| 后端 API | 3100 | zjyph-backend | `node dist/src/server.js`（构建产物实际路径） |
| 前端 | 8080（对外，防火墙放行） | zjyph-frontend | `node serve-static.cjs`（SPA 托管 web/dist） |

- 进程配置：`server/zjyph-ecosystem.config.cjs`；日志轮转：pm2-logrotate（10MB/保留 30 天）
- 开机自启：`pm2 save` + `pm2-windows-startup`（注册表 HKCU Run）
- 生产库账号：业务账号 `zjyph_app`（仅 DML，无 DDL，脚本 `init-zjyph-roles.mjs` 幂等初始化）；超级用户 postgres 仅迁移/备份

### 发布流程（checklist）

1. `develop` 经 PR 合并进 `main`，打 tag：`git tag v2026.08.x && git push origin v2026.08.x`
2. 生产目录更新：`cd D:\ZJYPH-prod && git fetch --tags && git checkout v2026.08.x`
3. 一键部署：`powershell -File server\scripts\deploy-zjyph.ps1 -Tag v2026.08.x`
   脚本自动执行：发布前备份 → `prisma migrate deploy`（超级用户）→ 后端/前端构建（注入 VITE_API_BASE_URL 与版本标识）→ PM2 重启 → /health 检查 → 冒烟验证（`production-smoke-zjyph.ps1`）

### 备份与恢复

- 每日 02:00 Windows 计划任务执行 `server/scripts/backup-zjyph.ps1 -Action full`：
  pg_dump -Fc → AES-256 加密（.NET，密钥 = 环境变量 `ZJYPH_BACKUP_KEY`，≥32 字符，**单独保管**）→ `D:\ZJYPH-backup\full\zjyph_prod_*.dump.enc`（保留 30 天，产出后立即自校验）
- 校验：`backup-zjyph.ps1 -Action verify -BackupFile <文件>`
- 恢复（破坏性，双重确认）：`backup-zjyph.ps1 -Action restore -BackupFile <文件> -ConfirmRestore`（恢复前自动做保护性备份）
- 回滚发布：`cd D:\ZJYPH-prod && git checkout <上一tag>` → 重新跑 deploy 脚本；数据损坏时先恢复备份再回滚代码

### 巡检

- 每周运行 `server/scripts/ops-check-zjyph.ps1`（可加计划任务）：PM2 进程、/health、前端 8080、磁盘空间、备份时效、数据库连接数；关键项失败退出码非 0

### 安全基线

- Windows 防火墙放行入站 **8080（前端）与 3100（后端，内网访问必需）**；数据库 5433 仅本机（PG 已配置 listen_addresses=127.0.0.1）
- 前端构建地址：内网访问场景 `VITE_API_BASE_URL` 必须用服务器内网 IP（192.168.1.43:3100），不能用 localhost（否则内网浏览器指向访问者本机，报"网络连接异常"）
- 生产 `server/.env` 权限已收紧（icacls 仅当前用户），密钥不进 git
- 登录限流（5 次/分钟）与审计日志（audit_log）默认启用
- 已知风险：内网无 HTTPS（内网可信环境可接受；如需加固可后续加自签证书）

### 未来迁移到 Docker 的路径

`D:\ZJYPH-prod` 检出代码 + 根目录 `.env`（模板 `.env.example` 已就绪）+ `docker compose up -d --build` 即可切换；分支模型与目录隔离无需改动。迁移前注意：Docker 版镜像入口为 `dist/src/server.js`（与 start 脚本一致），备份体系切换为 backup.sh（openssl 格式，与 PowerShell 版加密不互通）。
