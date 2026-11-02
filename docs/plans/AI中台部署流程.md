# 企业 AI 中台部署流程

> 适用范围：将本项目以 Docker 应用发布到企业 AI 中台，与内网 Windows 生产通道并行运行。本文只描述 AI 中台通道；内网 Windows 通道仍执行 `docs/plans/生产部署发布流程.md` 和 `server/scripts/deploy-zjyph.ps1`。

## 1. 双生产通道边界

| 项目 | 内网 Windows 生产 | 企业 AI 中台生产 |
|---|---|---|
| 运行目录/平台 | `D:\ZJYPHFA` | AI 中台应用 `yipinhui-finance` |
| 访问地址 | 内网 8080/FRP 入口 | `https://ai-portal.zrhsh.com/yipinhui-finance` |
| 运行时 | Windows + PM2 + 嵌入式 PG17 | 单 Docker 镜像 + 共享 PostgreSQL |
| 数据库 | `zjyph_prod`，独立生产数据 | `db_yipinhui-finance`，由中台注入连接 |
| 发布入口 | `deploy-zjyph.ps1 -Tag <tag>` | AI 中台 MCP `create_upload` + `deploy_app` |
| 代码来源 | 正式 tag | 同一正式 tag 的源码包 |

两条通道共用代码版本，但数据库、运行资产和回滚链路相互独立。AI 中台部署不得覆盖 Windows 生产目录，也不得把 Windows 生产 `.env`、备份或数据文件带入发布包。

## 2. 当前应用基线

- 应用名称：`浙江壹品慧财年经营数据分析平台`
- Slug：`yipinhui-finance`
- GitLab 仓库：`https://code.zrhsh.com/ai-apps/yipinhui-finance`
- 可见范围：`private`
- 鉴权模式：`self`，保留项目自身登录、JWT、RBAC 和审计
- 平台访问端口：`80`
- 容器内 Node 端口：`8080`

更新时必须复用原 `name` 和 `slug`。修改名称会创建新应用和新 GitLab 仓库，不得使用。

## 3. 首次发布与更新前检查

1. 在开发 worktree 完成修改并执行 `npm run verify`。
2. 通过 PR 合入 `main`，等待 CI 的 `verify` 通过。
3. 在合并后的 `origin/main` 上创建带注释 tag：

```powershell
git fetch origin main --tags
git tag -a v2026.11.6 <merged-main-sha> -m "release: v2026.11.6"
git push origin v2026.11.6
```

4. 调 `list_apps`，确认原应用存在，记录原应用 `name`、`slug`、`visibility` 和当前版本。
5. 创建发布包前检查：

- 包内包含 `deploy/Dockerfile`、`deploy/docker-entrypoint.sh`、`server/`、`web/`、根配置。
- 排除 `docs/`、`.qoder/`、`node_modules/`、`dist/`、`build/`、`.pgdata/`、`.env*`、备份和日志。
- 包内不得出现真实数据库连接串、MCP Token、JWT 密钥或生产 `.env`。

## 4. 打包

在开发 worktree 根目录生成 `tar.gz`。Windows 下文件名含中文时不要用简单 `git archive | tar` 管道，使用 Python `tarfile` 按 `git ls-files -z` 打包，避免 Unicode 路径损坏。

发布包建议命名：

```text
yipinhui-finance-v2026.11.6.tar.gz
```

打包后验证：

```powershell
Get-Item <package> | Select-Object FullName, Length
python -c "import tarfile,sys; t=tarfile.open(sys.argv[1],'r:gz'); n=t.getnames(); print(len(n)); print('deploy/Dockerfile' in n); print(any(x.startswith('docs/') for x in n))" <package>
```

包大小超过 200 MB 时停止上传，先列出最大文件并确认。

## 5. Docker 运行约定

`deploy/Dockerfile` 必须满足：

- 基础镜像使用内网 Harbor：`registry.zrhsh.com/library/node:20-alpine`。
- 多阶段构建；运行阶段只保留构建产物、Prisma 和运行时依赖。
- 运行阶段安装 `openssl socat su-exec`。
- 业务 Node 进程和 Prisma migration 使用 `su-exec node` 降权运行。
- 中台网关固定访问容器 `80` 端口；入口脚本由 root 仅启动 `socat 80 -> 8080`，Node 始终监听 `8080`。
- Prisma `generator client` 必须包含 `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]`，避免 Alpine 运行时缺少查询引擎。
- `HEALTHCHECK` 访问容器当前 `PORT` 的 `/health`；平台注入 `PORT=80` 时由转发链路处理。
- 不执行 seed；只执行 `prisma migrate deploy`。

## 6. MCP 上传与部署

AI 中台认证信息只保存在本机 MCP 客户端配置中，不得写入文档、代码、发布包或聊天记录。

1. 调用 `create_upload`：

- `filename=<package-name>`
- `slug=yipinhui-finance`
- `purpose=app`

2. 使用返回的 `upload_id` 和 `upload_url` 执行 `PUT`：

```powershell
curl.exe -f -sS -X PUT `
  -H "Content-Type: application/octet-stream" `
  --data-binary "@<package>" `
  "<upload_url>"
```

3. 调用 `deploy_app`：

- `upload_id=<id>`
- `name=浙江壹品慧财年经营数据分析平台`
- `slug=yipinhui-finance`
- `port=80`
- `description=浙江壹品慧财年经营数据分析平台`
- `icon=📊`
- 更新流程不修改 `visibility` 和 `auth_mode`

4. 轮询 `get_app_status`，必须同时满足：

- `app.status=running`
- `k8s.status=running`
- `readyReplicas=1`
- Pod `ready=true`
- 重启次数稳定为 `0`

## 7. 验收

```powershell
curl.exe -sS -o NUL -w "HOME=%{http_code}`n" "https://ai-portal.zrhsh.com/yipinhui-finance"
curl.exe -sS -o NUL -w "HEALTH=%{http_code}`n" "https://ai-portal.zrhsh.com/yipinhui-finance/health"
```

要求：

- 首页和 `/health` 均返回 `200`。
- 浏览器进入 `/yipinhui-finance/login`，登录页正常显示。
- 构建产物不包含 `src="/"`、`href="/"`、`fetch("/"` 等丢失子路径前缀的资源地址。
- 登录、改密、退出、报表图片、SPA 回退和 `/api/v1` 均在中台前缀下可用。

发布记录至少保存：应用名、slug、平台版本、正式 tag、镜像地址、GitLab 仓库、验收 HTTP 码和 Pod 状态。

## 8. 常见故障

| 现象 | 根因 | 处理 |
|---|---|---|
| 首页 502，网关报 `ECONNREFUSED <pod-ip>:80` | 容器未监听 80 | 使用 `socat 80 -> 8080`，不要依赖非 root `setcap` |
| Node 报 `EACCES 0.0.0.0:80` | 非 root 直接绑定低端口 | 代理监听 80，Node 监听 8080 |
| Prisma 报缺少 `linux-musl-openssl-3.0.x` | Client 未生成 musl 引擎 | 增加 `binaryTargets` 并重新构建 |
| 数据库连接失败 | 未使用平台注入变量 | 读取 `DATABASE_URL`；不要手工写集群连接串 |
| 页面资源 404 | 使用绝对根路径 | `vite base='./'`，路由使用 basename 或相对路径 |
| 更新后裂出新应用 | `name` 或 `slug` 改变 | 立即停止，恢复原 `name`/`slug` 后重新部署 |

## 9. 回滚

AI 中台回滚通过重新发布上一稳定 tag 的源码包完成：

1. 检查上一稳定 tag 的源码包。
2. 使用原 `name=yipinhui-finance`、`slug=yipinhui-finance` 和 `port=80` 重新上传、部署。
3. 轮询到 `readyReplicas=1`，重新执行首页、健康和登录验收。
4. 若涉及不可逆数据库迁移，先按数据库备份与恢复流程评估，不能只回退镜像。

## 10. 数据与测试账号

AI 中台生产数据库默认只执行结构迁移，不自动执行业务 seed、测试数据或演示账号。需要导入测试数据或新增账号时，必须作为单独的数据变更执行：

- 先确认目标数据库和影响范围。
- 先备份或确认可重建。
- 使用幂等脚本，禁止把密码明文写入仓库。
- 账号密码只通过受控初始化脚本或管理界面设置，发布包和文档只保留用户名，不保存明文密码。
- 测试数据不得与 Windows 生产库混用。

## 11. 并行发布顺序

同一正式 tag 需要同时发布到两条通道时：

1. 完成 PR、CI、tag 和源码包校验。
2. 先部署 AI 中台并验收 `running`、`readyReplicas=1`、HTTP 200。
3. 再在 `D:\ZJYPHFA` 执行 `deploy-zjyph.ps1 -Tag <同一tag>`，完成备份、构建、迁移、冒烟。
4. 两条通道分别记录版本和验收结果；任一通道失败时停止另一通道的后续操作，保留失败现场。

AI 中台部署成功不代表 Windows 生产部署成功，反之亦然。

## 12. 相关文档

- `docs/plans/生产部署发布流程.md`
- `docs/plans/环境管理规范.md`
- `docs/plans/开发与生产更新指南.md`
- `deploy/Dockerfile`
- `deploy/docker-entrypoint.sh`
