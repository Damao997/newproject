-- 审计日志补 trace_id：与访问日志/统一响应 traceId 贯穿，便于按请求溯源关联（M6）
ALTER TABLE "audit_log" ADD COLUMN "trace_id" VARCHAR(64);
CREATE INDEX "audit_log_trace_id_idx" ON "audit_log"("trace_id");
