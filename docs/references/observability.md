# 可观测性与日志规范（模块 8）

## 日志分级

| 级别 | 使用场景 | 示例 |
|------|----------|------|
| DEBUG | 开发调试，生产默认关闭 | SQL 语句、变量值 |
| INFO | 关键业务节点 | 登录、导入完成、报告生成 |
| WARN | 异常但不影响主流程 | 第三方响应慢、缓存未命中 |
| ERROR | 影响主流程的异常 | 数据库连接失败、DeepSeek API 调用失败 |

## traceId 链路追踪

- 每个请求在入口处（`app.ts`）由中间件 `express-request-id` 生成全局唯一 traceId（UUID v4）
- traceId 注入到 `req.traceId`，贯穿整个请求生命周期
- 所有日志输出**必须包含 traceId**（`[traceId=xxx]` 前缀或 JSON 字段）
- 响应体中返回 traceId 字段，便于前端或调用方定位问题
- 跨模块调用（Service → Prisma → API）传递同一 traceId

## 日志内容规范

- **必须记录**：脱敏后的关键参数、完整异常堆栈、外部调用耗时与状态码、业务状态变更
- **绝不记录**：密码/密钥/Token 等凭证、完整身份证号/银行卡号等 PII、原始请求体中的敏感字段

## 审计日志

- **核心操作**（认证/数据变更/导出分享/权限变更）→ `audit_log` 表
- **字段**：userId / module / action / targetId / detail（不记金额）/ ip
- **留存**：5 年，按月分区
- **限制**：仅 INSERT + SELECT（不可篡改），通过独立数据库账号限制

## 告警指标（待实现）

- 接口响应时间（P50 / P95 / P99）
- 错误率（按接口、按错误码）
- 备份成功/失败通知
- 资源指标（Container CPU、内存、磁盘）

## 详细参考

- 部署监控配置 → Read `docs/plans/部署运维规范.md`
- 审计中间件实现 → `server/src/middleware/audit.ts`
