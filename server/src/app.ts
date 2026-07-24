import express, { type Application, type Request, type Response } from 'express'
import { traceId } from './middleware/trace-id'
import { securityHeaders } from './middleware/helmet'
import { corsMiddleware } from './middleware/cors'
import { generalRateLimiter } from './middleware/rate-limit'
import { errorHandler, notFoundHandler } from './middleware/error-handler'
import { sendOk } from './lib/response'
import { basePrisma } from './lib/prisma'
import authRouter from './routes/auth'
import dashboardRouter from './routes/dashboard'
import indicatorsRouter from './routes/indicators'
import dataRouter from './routes/data'
import adminRouter from './routes/admin'
import aiRouter from './routes/ai'
import reportsRouter from './routes/reports'

/**
 * 构建 Express 应用并装配中间件链：
 *   traceId → helmet → cors → express.json → 通用限流 → 路由 → 404 → 全局错误处理
 * 认证路由内部再叠加 auth/rate-limit/audit（登录限流在 /auth/login）。
 */
export function createApp(): Application {
  const app = express()

  // 位于反向代理之后，信任代理以正确解析客户端 IP
  app.set('trust proxy', 1)

  // 链路追踪最先执行，保证后续中间件/错误处理均可用 traceId
  app.use(traceId)
  app.use(securityHeaders())
  app.use(corsMiddleware())
  app.use(express.json({ limit: '1mb' }))

  // 健康检查（探针，不经限流/鉴权）
  app.get('/health', async (_req: Request, res: Response) => {
    let db = 'unknown'
    try {
      await basePrisma.$queryRaw`SELECT 1`
      db = 'up'
    } catch {
      db = 'down'
    }
    sendOk(res, { service: 'up', db, time: new Date().toISOString() })
  })

  // 通用限流（100 次/分钟）作用于业务 API
  app.use('/api/v1', generalRateLimiter)

  // 认证路由
  app.use('/api/v1/auth', authRouter)
  // 业务路由
  app.use('/api/v1/dashboard', dashboardRouter)
  app.use('/api/v1/indicators', indicatorsRouter)
  app.use('/api/v1/data', dataRouter)
  app.use('/api/v1/admin', adminRouter)
  app.use('/api/v1/ai', aiRouter)
  app.use('/api/v1/reports', reportsRouter)

  // 兜底 404 与全局错误处理
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
