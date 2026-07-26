---
kind: logging_system
name: 后端日志系统：轻量分级日志与 traceId 链路追踪
category: logging_system
scope:
    - '**'
source_files:
    - server/src/lib/logger.ts
    - server/src/middleware/trace-id.ts
    - server/src/config/env.ts
    - server/src/app.ts
    - docs/references/observability.md
---

## 1. 使用的系统与框架
- 自定义轻量级日志模块 `server/src/lib/logger.ts`，基于 Node.js 原生 `console.log/warn/error` 输出。
- 通过环境变量 `LOG_LEVEL`（DEBUG/INFO/WARN/ERROR）控制日志级别阈值，默认 INFO。
- 链路追踪由内建中间件 `server/src/middleware/trace-id.ts` 实现，使用 `crypto.randomUUID()` 生成 UUID v4 作为 traceId。
- 可观测性规范文档位于 `docs/references/observability.md`，定义了日志分级、traceId 传递、内容脱敏与审计日志要求。

## 2. 核心文件与包
- `server/src/lib/logger.ts` — 日志门面，提供 debug/info/warn/error 四个方法，统一格式化 `[traceId=xxx]` 前缀。
- `server/src/config/env.ts` — 集中读取环境变量，定义 `LogLevel` 类型与 `logLevel` 配置项。
- `server/src/middleware/trace-id.ts` — 请求级 traceId 注入中间件，透传 `X-Request-Id` 响应头。
- `server/src/app.ts` — Express 应用装配，traceId 中间件置于最前，保证全链路可用。
- `docs/references/observability.md` — 可观测性与日志规范文档。
- 种子脚本与调试脚本（如 `prisma/seed*.ts`、`scripts/*.ts`）仍直接使用 `console.log`，未走 logger 模块。

## 3. 架构与约定
- **日志级别权重**：DEBUG(10) < INFO(20) < WARN(30) < ERROR(40)，低于阈值的日志直接丢弃。
- **格式规范**：每条日志输出 ISO 时间戳 + 级别 + `[traceId=xxx]` + 消息文本，可选附带 meta 对象。
- **traceId 生命周期**：请求进入时由 `traceId` 中间件生成或透传上游 `X-Request-Id`，挂载到 `req.traceId`，所有日志调用需传入该 ID；响应头回写 `X-Request-Id`，便于前端与调用方关联。
- **安全约束**：logger 注释明确禁止打印密码、Token、PII 等敏感信息。
- **生产扩展点**：logger 注释指出“生产可替换为结构化 JSON 输出”，当前以控制台文本为主。
- **错误处理集成**：全局错误处理器 `middleware/error-handler.ts` 负责捕获异常并输出 ERROR 级别日志。

## 4. 约定与约束
- **必须记录**：脱敏后的关键参数、完整异常堆栈、外部调用耗时与状态码、业务状态变更（见 observability.md）。
- **绝不记录**：密码/密钥/Token、身份证号/银行卡号等 PII、原始请求体中的敏感字段（见 observability.md 与 logger 注释）。
- **traceId 必填**：所有日志输出必须包含 `[traceId=xxx]` 前缀（observability.md 明确要求）。
- **审计日志独立存储**：核心操作写入 `audit_log` 表，字段含 userId/module/action/targetId/detail/ip，仅 INSERT+SELECT，5 年留存按月分区（observability.md）。
- **日志级别默认 INFO**：未配置 `LOG_LEVEL` 时回退至 INFO，启动早期配置未就绪时 logger 也回退 INFO（env.ts 与 logger.ts 共同保障）。
- **健康检查端点**：`/health` 探针不经过限流与鉴权，直接返回服务与数据库状态（app.ts）。

## 5. 现状评估
- 后端已实现统一的轻量日志门面与 traceId 链路追踪，符合 observability.md 规范。
- 部分辅助脚本（seed、live 测试）仍直接使用 `console.log`，未接入 logger 模块，属于开发期临时输出。
- 尚未实现结构化 JSON 输出与外部日志收集（如 ELK/ Loki），但代码预留了替换入口。