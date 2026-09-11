# 后端开发规范（模块 5）

## 技术栈（以项目现有为准）

- **语言/框架**：Node.js 20+ / Express 4.19+ / TypeScript 5.5
- **ORM**：Prisma v5（provider = postgresql / sqlite local dev）
- **认证授权**：JWT（access 15min + refresh 7day + 轮转）+ RBAC + scope 数据权限
- **校验**：Zod（前后端共享 schema，校验逻辑收敛到后端）
- **文件上传**：multer（fileFilter 仅 .xlsx/.xls + 50MB 上限 + MIME magic number 校验）
- **HTML 净化**：DOMPurify + sanitize-html（存储前净化）
- **AI 引擎**：DeepSeek API（OpenAI 兼容，SSE 流式）
- **测试框架**：Vitest（目标覆盖率 ≥80% 核心逻辑）

## API 规范

- **前缀**：`/api/v1/<resource>`
- **统一响应**：`{ code: number, data: any, message: string, traceId: string }`
- **成功**：`{ code: 0, data, message: 'success', traceId }`
- **端口**：3001

## 中间件执行链

```
helmet(CSP/HSTS) → cors(前端origin) → express.json → 速率限制
  → auth(JWT+黑名单) → permission(requirePermission,默认拒绝)
    → scope(Prisma extension自动拦截) → softDelete(status='active'过滤)
      → audit(核心操作INSERT到audit_log) → Service → Prisma → PostgreSQL
```

## 质量要求

- 所有接口输入校验（Zod），禁止信任客户端数据
- 数据库查询使用 Prisma 参数化查询，严禁裸 SQL 拼接
- 核心写操作（导入/创建/更新/删除）支持幂等性，通过 bizId 去重
- 敏感操作记录审计日志（audit_log 表），留存 5 年
- 实现全局错误处理中间件，返回统一错误码
- 每个请求生成 traceId，贯穿日志链路
- **速率限制**：登录接口 5 次/分钟，通用接口 100 次/分钟（express-rate-limit）
- 日志遵守分级规范（DEBUG/INFO/WARN/ERROR），含 traceId，不记 PII

## 详细参考

- 完整 API 设计 → Read `docs/plans/整体方案v3.md`
- AI 模块后端实现 → Read `docs/plans/AI模块规范.md`
- 错误码规范 → Read `docs/references/errorcode.md`
