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
}

/** 从请求中提取客户端 IP（信任反向代理链首段） */
export function clientIp(req: Request): string | null {
  const forwarded = req.header('X-Forwarded-For')
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() ?? null
  }
  return req.ip ?? req.socket?.remoteAddress ?? null
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
      },
    })
  } catch (err) {
    // 审计失败不阻断主流程
    logger.error(traceId, `审计日志写入失败 module=${input.module} action=${input.action}`, err)
  }
}
