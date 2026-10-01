# 浙江壹品慧财年经营数据分析平台

内部经营与财务数据分析平台，支持 Excel 数据导入、指标与预算分析、往来及存货管理、分析报告、权限和审计。

## 技术栈

- Web：React 19、TypeScript 6、Vite 5、Tailwind CSS、Radix UI、Ant Design
- 服务端：Node.js 20、Express 4、TypeScript 5.6、Prisma 5
- 数据库：PostgreSQL 17（Windows 生产使用嵌入式实例）
- 生产运行：Windows、PM2、`serve-static.cjs` 同源 API 代理、可选 FRP 公网入口

## 工作区约定

- `D:\ZJYPHFA-dev`：开发工作区，只在这里修改、测试和提交代码。
- `D:\ZJYPHFA`：生产工作区，只检出 `main` 的正式 tag 并执行部署脚本。

生产数据、备份、PostgreSQL 工具、真实环境变量和运维密钥均不得进入 Git。

## 常用命令

```powershell
# 开发环境
npm ci
npm ci --prefix server
npm ci --prefix web
npm run dev:up

# 提交前完整验证（后端测试需要隔离的测试数据库）
npm run verify

# 正式发布：仅在生产目录执行
powershell -File server\scripts\deploy-zjyph.ps1 -Tag v2026.09.2
```

## 文档入口

- AI/工程约束：[CLAUDE.md](CLAUDE.md)
- 开发与生产更新流程：[开发与生产更新指南](docs/plans/开发与生产更新指南.md)
- 环境隔离与运维：[环境管理规范](docs/plans/环境管理规范.md)
- 标准操作流程：[标准操作流程手册](docs/plans/标准操作流程手册.md)
- 安全与权限：[安全与权限规范](docs/plans/安全与权限规范.md)
