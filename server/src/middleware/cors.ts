import cors from 'cors'
import type { RequestHandler } from 'express'
import { loadConfig } from '../config/env'
import { errors } from '../lib/errors'

/**
 * CORS：仅允许配置的前端来源，credentials:true。
 * 安全红线：严禁 Access-Control-Allow-Origin: *（见 docs/references/security.md）。
 */
export function corsMiddleware(): RequestHandler {
  const { frontendOrigin } = loadConfig()
  const allowList = frontendOrigin.split(',').map((o) => o.trim()).filter(Boolean)

  return cors({
    origin: (origin, callback) => {
      // 同源/无 Origin 的请求（如 curl、服务端）放行
      if (!origin) {
        callback(null, true)
        return
      }
      if (allowList.includes(origin)) {
        callback(null, true)
        return
      }
      // 用 AppError(403) 而非裸 Error，避免全局错误处理误报 500
      callback(errors.forbidden(`CORS 拒绝来源：${origin}（请检查 FRONTEND_ORIGIN 配置并重启后端）`))
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  })
}
