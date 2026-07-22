# DevOps 与部署规范（模块 14）

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
