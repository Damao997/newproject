---
kind: build_system
name: 构建与制品管理（Node.js 多模块 + Vite/Prisma）
category: build_system
scope:
    - '**'
source_files:
    - server/package.json
    - web/package.json
    - server/tsconfig.json
    - web/vite.config.ts
    - server/vitest.config.ts
    - web/vitest.config.ts
    - server/.env
    - docs/references/devops.md
---

## 1. 使用的系统与工具
- **包管理与脚本**：每个子模块独立 `package.json`，通过 npm scripts 组织开发、构建、测试、数据库迁移等命令。
- **后端构建**：TypeScript 5.6 + tsc（CommonJS 输出到 `dist/`），运行时由 `node dist/server.js` 启动；开发使用 `tsx watch` 热重载。
- **前端构建**：Vite 5 + React 插件，先 `tsc -b` 类型检查再 `vite build` 生成静态资源；开发服务器端口 5173，并通过 proxy 将 `/api/v1` 转发到后端 3001 端口。
- **数据库 ORM 与迁移**：Prisma v5，schema 定义在 `server/prisma/schema.prisma`，迁移文件位于 `server/prisma/migrations/`，种子数据在 `server/prisma/seed*.ts`。
- **测试框架**：前后端均使用 Vitest（后端 Node 环境，前端 jsdom 环境），覆盖率基于 `@vitest/coverage-v8`。
- **容器化与部署**：文档规划了 Docker 多阶段构建（`server/Dockerfile` + `web/Dockerfile`）、Docker Compose（postgres + backend + frontend + db-backup）及 Nginx 反向代理，但当前仓库中尚未包含这些部署物料。

## 2. 关键文件与位置
- `server/package.json`：后端脚本入口（dev/build/start/test/prisma:generate/migrate/seed/studio/db:local）。
- `web/package.json`：前端脚本入口（dev/build/lint/preview/test）。
- `server/tsconfig.json`：后端 TypeScript 编译配置（ES2022、CommonJS、strict 模式、输出到 `dist/`）。
- `web/vite.config.ts`：Vite 配置（React 插件、路径别名 `@` → `./src`、开发代理 `/api/v1` → `http://localhost:3001`）。
- `server/vitest.config.ts` / `web/vitest.config.ts`：前后端测试与覆盖率配置。
- `server/.env`：后端环境变量（端口、数据库连接、JWT 密钥、CORS 来源等）。
- `docs/references/devops.md`：DevOps 规范文档，描述 Docker 架构、备份策略、环境变量管理等。

## 3. 架构与约定
- **双模块独立构建**：server 与 web 各自维护依赖与构建流程，无根级 monorepo 工具（如 nx、lerna），通过文档和脚本约定协作。
- **TypeScript 严格模式**：后端启用 strict、noUnusedLocals、noImplicitReturns 等严格选项，确保类型安全。
- **测试隔离**：后端禁用文件级并行（`fileParallelism: false`）避免共享 DB 状态竞争；前端使用 jsdom 模拟浏览器环境。
- **环境变量驱动**：所有敏感信息（JWT_SECRET、DATABASE_URL 等）通过 `.env` 注入，禁止硬编码。
- **Prisma 工作流**：Schema 变更 → `prisma migrate dev` → 生成客户端 → 可选 seed 数据。

## 4. 约定与约束
- **构建产物**：后端输出到 `dist/` 目录，生产运行 `node dist/server.js`；前端构建为静态资源由 Nginx 托管。
- **开发工作流**：前端 `npm run dev` 启动 Vite 并代理 API，后端 `npm run dev` 使用 tsx watch 热重载。
- **测试要求**：核心逻辑覆盖率 ≥80%，测试需实际执行并如实报告结果。
- **部署约束**：当前仓库缺少 `docker-compose.yml`、`Dockerfile`、`nginx.conf` 等部署物料，属于阻塞上线的 P0 问题；文档已明确后续补齐计划。
- **CI/CD**：当前无自动化流水线，文档建议后续接入 GitHub Actions。
- **版本管理**：各模块 `package.json` 中维护版本号（server 0.1.0，web 0.0.0），无统一版本策略。

## 5. 已知缺口
- 仓库中未找到实际的 `Dockerfile`、`docker-compose.yml`、`nginx.conf`、`backup.sh` 等部署相关文件，仅存在于文档规划中。
- 无根级构建脚本或 CI 配置文件，构建与发布仍依赖人工在各模块内执行 npm scripts。