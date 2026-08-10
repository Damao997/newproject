# 版本控制与增量交付规范（模块 13）

## Git 分支规范（开发与生产分离模型）

| 分支类型 | 命名格式 | 说明 |
|---------|---------|------|
| 生产分支 | `main` | **生产就绪代码，唯一部署来源**，受保护，禁止直接推送（本地 pre-push 钩子拦截——GitHub 免费个人账户不强制执行 rulesets/分支保护；正常发布走 develop → PR 合并进 main） |
| 开发分支 | `develop` | 开发集成分支，日常开发汇聚地，从 main 派生 |
| 功能分支 | `feat/<简短描述>` | 新功能开发，从 develop 派生，合并后删除 |
| 修复分支 | `fix/<简短描述>` | Bug 修复，从 develop 派生 |
| 重构分支 | `refactor/<简短描述>` | 代码重构，不含功能变更 |
| 紧急修复 | `hotfix/<简短描述>` | 生产环境紧急修复，从 main 派生，修复后分别合回 main 与 develop |

发布标签：`v<年>.<月>.<序号>`（如 v2026.08.1、v2026.08.2），标记生产可部署状态。

## 开发与生产并行工作流

```
main（生产，受保护，部署基准 = 生产目录 D:\ZJYPH-prod 只检出 tag）
  └── develop（开发集成）
        └── feat/*、fix/*、refactor/*（短期分支）
  └── hotfix/*（从 main 派生）
```

- **日常开发**：从 `develop` 派生 `feat/xxx` → 开发验证 → 合并回 `develop`
- **发布**：`develop` 走 PR 合并进 `main` → 打 tag（v2026.08.x）→ 生产目录 `git checkout <tag>` → 运行 `server/scripts/deploy-zjyph.ps1`（备份 → 迁移 → 构建 → 重启 → 健康检查 → 冒烟）
- **紧急修复**：从 `main` 派生 `hotfix/xxx` → 修复 → 分别合回 `main` 与 `develop`
- **部署基准**：生产目录（`D:\ZJYPH-prod`）永远从 main 的 tag 更新，严禁检出未发布的 develop/main 代码

## 提交信息规范（Conventional Commits）

```
<类型>: <简体中文描述>

[可选正文]
```

| 类型 | 使用场景 |
|------|----------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `refactor` | 代码重构 |
| `docs` | 文档变更 |
| `style` | 样式/格式变更（非功能逻辑） |
| `test` | 测试相关 |
| `chore` | 构建/工具/依赖变更 |

**示例**：
```
feat: 添加经营数据批量导入功能
fix: 修复 JWT 过期后未正确返回 401
docs: 更新 API 文档中的错误码说明
```

## 开发流程

1. 从 `develop` 创建功能分支：`git checkout -b feat/xxx develop`
2. 原子化提交：一个提交只做一件事
3. 提交前验证：TypeScript 类型检查通过 + lint 无错误 + 测试通过
4. 提交后推送：`git push origin feat/xxx`
5. 创建 Pull Request / Merge Request，代码审查通过后合并到 `develop`（发布时再经 PR 合入 `main`）

## 增量交付规则

- 复杂任务拆分为多个可独立验证的子任务
- 每个子任务完成后同步进度
- 变更附带变更说明，便于代码审查
- 重大变更必须提供回滚方案

## 禁止提交的文件

- `.env`（含密钥/密码/Token）
- `node_modules/`、`.prisma/` 等生成目录
- 构建产物（`dist/`、`build/`）
- 操作系统文件（`.DS_Store`、`Thumbs.db`）
- IDE 配置（`.vscode/`、`.idea/`）

## 详细参考

- Git 配置 → `.gitignore`
- 当前项目状态 → `git log --oneline`
