# 版本控制与增量交付规范（模块 13）

## Git 分支规范

| 分支类型 | 命名格式 | 说明 |
|---------|---------|------|
| 主分支 | `main` | 生产就绪代码，保护分支，禁止直接推送 |
| 功能分支 | `feat/<简短描述>` | 新功能开发，如 `feat/data-import-improve` |
| 修复分支 | `fix/<简短描述>` | Bug 修复，如 `fix/login-401-error` |
| 重构分支 | `refactor/<简短描述>` | 代码重构，不含功能变更 |
| 紧急修复 | `hotfix/<简短描述>` | 生产环境紧急修复，从 main 分支 |

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

1. 从 `main` 创建功能分支：`git checkout -b feat/xxx`
2. 原子化提交：一个提交只做一件事
3. 提交前验证：TypeScript 类型检查通过 + lint 无错误 + 测试通过
4. 提交后推送：`git push origin feat/xxx`
5. 创建 Pull Request / Merge Request，代码审查通过后合并到 `main`

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
