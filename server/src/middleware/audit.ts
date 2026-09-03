import type { Request } from 'express'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'

/**
 * 审计日志记录（见 docs/references/observability.md / 数据模型规范 §7.9）。
 * detail 仅记录操作元信息（类型/目标/字段名），严禁记录原始金额值与 PII。
 * 记录失败不得中断主流程，仅告警。
 */

export interface AuditInput {
  userId?: string | null
  module: string
  action: string
  targetId?: string | null
  detail?: Record<string, unknown> | null
  ip?: string | null
  userAgent?: string | null
}

/** 从请求中提取客户端 IP：req.ip 为 trust proxy 解析后的可信口径（nginx 追加段），
 *  客户端伪造的 X-Forwarded-For 首段被 Express 忽略，防止审计 IP 被污染误导溯源 */
export function clientIp(req: Request): string | null {
  return req.ip ?? req.socket?.remoteAddress ?? null
}

/** User-Agent 上限（与 audit_log.user_agent VARCHAR(512) 对齐，超长截断避免写入失败） */
const USER_AGENT_MAX = 512

/** 从请求中提取 User-Agent（截断至 512 字符）；与 IP 配合用于区分同 IP 的不同客户端 */
export function clientUserAgent(req: Request): string | null {
  const ua = req.header('User-Agent')
  if (!ua) return null
  return ua.length > USER_AGENT_MAX ? ua.slice(0, USER_AGENT_MAX) : ua
}

/** 一次性提取审计所需的请求上下文（IP + User-Agent），供各路由/服务复用 */
export function auditMeta(req: Request): { ip: string | null; userAgent: string | null; traceId: string } {
  return { ip: clientIp(req), userAgent: clientUserAgent(req), traceId: req.traceId }
}

export async function recordAudit(input: AuditInput, traceId?: string): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        module: input.module,
        action: input.action,
        targetId: input.targetId ?? null,
        detail: (input.detail ?? undefined) as never,
        ip: input.ip ?? null,
        // 兜底截断：即使调用方直接传入未处理的 UA，也不会因超长导致写入失败
        userAgent: input.userAgent ? input.userAgent.slice(0, USER_AGENT_MAX) : null,
      },
    })
  } catch (err) {
    // 审计失败不阻断主流程
    logger.error(traceId, `审计日志写入失败 module=${input.module} action=${input.action}`, err)
  }
}
