# 测试策略规范（模块 12）

## 测试框架

- **前端**：Vitest（与 Vite 深度集成）+ @testing-library/react
- **后端**：Vitest + supertest（API 集成测试）
- **端到端测试**：Playwright（后续实现）

## 测试金字塔

```
    ╱╲
   ╱ E2E ╲          ← 核心用户旅程（登录→看板→导入→导出）
  ╱────────╲
 ╱ 集成测试 ╲       ← API 接口 + 数据库交互
╱────────────╲
╱  单元测试   ╲    ← Service 层核心业务逻辑
╱──────────────╲
```

## 覆盖率目标

| 层 | 目标 | 说明 |
|----|------|------|
| Service 层（后端核心逻辑） | ≥ 80% | 指标计算、权限校验、数据导入解析 |
| API 路由层 | ≥ 60% | 请求校验、错误处理路径 |
| UI 组件层 | ≥ 40% | 核心业务组件、表单 |
| E2E 核心流程 | ≥ 5 条场景 | 登录、数据导入、报表生成、导出、权限验证 |

## 测试规范

- 测试独立、可重复、无副作用
- 测试数据通过 Prisma 种子脚本生成（`prisma/seed.ts`），与生产数据隔离
- Mock 外部依赖（DeepSeek API）遵循最小 Mock 原则
- 如实报告：通过 / 失败 / 跳过 / 覆盖率
- 禁止伪造测试通过、禁止注释失败用例
- 测试失败须分析原因并修复，而非跳过
- 测试代码本身也符合代码质量标准（lint + type-check）

## 测试目录结构

```
server/src/
├── services/
│   └── __tests__/         ← Service 层单元测试
├── middleware/
│   └── __tests__/         ← 中间件单元测试
└── routes/
    └── __tests__/         ← API 集成测试（supertest）

web/src/
├── components/
│   └── __tests__/         ← 组件单元测试
├── hooks/
│   └── __tests__/         ← 自定义 Hook 测试
└── pages/
    └── __tests__/         ← 页面集成测试
```

## 详细参考

- 测试配置参考 → Vitest 文档
- API 接口定义 → Read `docs/plans/整体方案v3.md`
