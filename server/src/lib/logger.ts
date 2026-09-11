import { loadConfig, type LogLevel } from '../config/env'

/**
 * 轻量分级日志（DEBUG/INFO/WARN/ERROR）。
 * 规范：所有输出携带 [traceId=xxx]；绝不打印密码/Token/PII。
 * 生产可替换为结构化 JSON 输出（devops 增量）。
 */

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
}

function currentThreshold(): number {
  try {
    return LEVEL_WEIGHT[loadConfig().logLevel] ?? LEVEL_WEIGHT.INFO
  } catch {
    // 配置尚未就绪（如启动早期）时退回 INFO
    return LEVEL_WEIGHT.INFO
  }
}

function format(level: LogLevel, traceId: string | undefined, message: string): string {
  const ts = new Date().toISOString()
  const trace = traceId ? `[traceId=${traceId}]` : '[traceId=-]'
  return `${ts} ${level} ${trace} ${message}`
}

function output(level: LogLevel, traceId: string | undefined, message: string, meta?: unknown): void {
  if (LEVEL_WEIGHT[level] < currentThreshold()) return
  const line = format(level, traceId, message)
  const args: unknown[] = meta === undefined ? [line] : [line, meta]
  switch (level) {
    case 'ERROR':
      console.error(...args)
      break
    case 'WARN':
      console.warn(...args)
      break
    default:
      console.log(...args)
  }
}

export const logger = {
  debug: (traceId: string | undefined, message: string, meta?: unknown) => output('DEBUG', traceId, message, meta),
  info: (traceId: string | undefined, message: string, meta?: unknown) => output('INFO', traceId, message, meta),
  warn: (traceId: string | undefined, message: string, meta?: unknown) => output('WARN', traceId, message, meta),
  error: (traceId: string | undefined, message: string, meta?: unknown) => output('ERROR', traceId, message, meta),
}
