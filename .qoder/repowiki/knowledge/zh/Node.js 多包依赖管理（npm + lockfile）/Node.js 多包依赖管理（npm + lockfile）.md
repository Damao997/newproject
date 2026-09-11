---
kind: dependency_management
name: Node.js 多包依赖管理（npm + lockfile）
category: dependency_management
scope:
    - '**'
source_files:
    - server/package.json
    - server/package-lock.json
    - web/package.json
    - web/package-lock.json
    - package-lock.json
---

本仓库采用 Node.js 生态的 npm 作为包管理器，以 monorepo 形式在 `server/` 和 `web/` 两个子目录中分别维护独立的 `package.json` 与 `package-lock.json`，根目录仅保留一个占位性质的 `package-lock.json`。

**使用的系统与工具**
- 包管理器：npm（lockfileVersion 3），通过各子模块的 `package.json` 声明依赖，`package-lock.json` 锁定精确版本。
- 后端（Express + Prisma）：`server/package.json` 声明运行时依赖（express、prisma/client、bcryptjs、xlsx、zod 等）与开发依赖（typescript、vitest、tsx、supertest、embedded-postgres 等）。
- 前端（React + Vite）：`web/package.json` 声明 UI 组件库（antd、@radix-ui/*）、数据请求（axios）、状态管理（zustand）、图表（echarts）、富文本（tiptap）及构建工具链（vite、tailwindcss、oxlint、vitest）。
- 数据库迁移与种子：Prisma 通过 `server/package.json` 中的 `scripts` 暴露 `prisma:generate`、`prisma:migrate`、`prisma:seed` 等命令。

**关键文件与位置**
- `server/package.json`、`server/package-lock.json`：后端依赖声明与锁定。
- `web/package.json`、`web/package-lock.json`：前端依赖声明与锁定。
- `package-lock.json`（根）：空 packages 对象，仅作占位，无实际作用。
- `server/prisma/schema.prisma`：数据库模型定义，配合 Prisma Client 生成类型。

**架构与约定**
- 每个子模块独立管理依赖，不共享 `node_modules`，避免跨模块版本冲突。
- 依赖版本统一使用 `^` 语义化版本范围（如 `"express": "^4.21.2"`），由 npm 解析为具体安装版本并写入 lockfile。
- 开发依赖与生产依赖严格分离：测试（vitest、supertest）、类型（@types/*）、构建（typescript、vite、tsx）均放在 `devDependencies`。
- 未使用 vendoring（无 `vendor/` 或 `third_party/`），所有第三方包通过 npm registry 下载。
- 未发现私有 npm registry、`.npmrc` 或 `NPM_REGISTRY` 环境变量配置，默认使用官方 npm registry。

**约束与规范**
- 所有依赖必须通过 `package.json` 声明，禁止直接修改 `node_modules`。
- 变更依赖后需提交对应的 `package-lock.json` 以保证构建可重现。
- Prisma 相关操作通过 npm scripts 调用，禁止直接运行 `prisma` 二进制而不经过脚本封装。