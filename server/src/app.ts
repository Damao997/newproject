import express, { type Application, type NextFunction, type Request, type Response } from 'express'
import { traceId } from './middleware/trace-id'
import { securityHeaders } from './middleware/helmet'
import { corsMiddleware } from './middleware/cors'
import { generalRateLimiter } from './middleware/rate-limit'
import { errorHandler, notFoundHandler } from './middleware/error-handler'
import { createPortalWebHandler, stripBasePath } from './middleware/portal-web'
import { sendOk } from './lib/response'
import { basePrisma } from './lib/prisma'
import { logger } from './lib/logger'
import { REPORT_IMAGE_DIR } from './lib/uploads'
import { normalizeBasePath } from './lib/base-path'
import { loadConfig } from './config/env'
import authRouter from './routes/auth'
import dashboardRouter from './routes/dashboard'
import indicatorsRouter from './routes/indicators'
import dataRouter from './routes/data'
import adminRouter from './routes/admin'
import aiRouter from './routes/ai'
import reportsRouter from './routes/reports'
import reportsPublicRouter from './routes/reports-public'
import transactionsRouter from './routes/transactions'
import inventoryRouter from './routes/inventory'
import toolsRouter from './routes/tools'

/**
 * 访问日志脱敏：剥离查询串（可能携带 token 类凭证），公开分享链接的
 * 令牌路径段替换为占位——日志读取者不得借此获得可用分享凭证。
 */
function sanitizePathForLog(raw: string): string {
  const path = raw.split('?')[0]
  return path.replace(/(\/shared\/)[0-9a-fA-F-]{8,}/i, '$1:token')
}

/**
 * 后端只信任直接连入的本机回环代理。公网与局域网流量统一先到
 * serve-static:8080，由它根据 socket 来源清洗并重写 X-Forwarded-*，再从回环地址转给后端。
 * 客户端若绕过前端直连 3100，其 socket 地址非回环，客户端自带 XFF 不会被信任。
 */
export function isTrustedProxy(ip: string): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

/**
 * 构建 Express 应用并装配中间件链：
 *   traceId → helmet → cors → express.json → 通用限流 → 路由 → 404 → 全局错误处理
 * 认证路由内部再叠加 auth/rate-limit/audit（登录限流在 /auth/login）。
 */
export interface AppOptions {
  /** 覆盖环境变量 BASE_PATH，供单元测试或嵌入场景使用。 */
  basePath?: string
  /** 提供后由同一 Express 进程托管构建后的前端。 */
  webRoot?: string | null
}

export function createApp(options: AppOptions = {}): Application {
  const app = express()
  const config = loadConfig()
  const basePath = normalizeBasePath(options.basePath ?? config.basePath)
  const webRoot = options.webRoot ?? config.webRoot

  // 单机旧部署只信任本机代理；中台入口按明确配置的可信跳数读取 X-Forwarded-For。
  app.set('trust proxy', config.trustProxyHops > 0 ? config.trustProxyHops : isTrustedProxy)

  // 兼容网关保留 /<slug>/ 前缀的转发方式；已剥离前缀的请求不受影响。
  app.use(stripBasePath(basePath))

  // 链路追踪最先执行，保证后续中间件/错误处理均可用 traceId
  app.use(traceId)

  // 请求访问日志：记录谁在什么时间访问了哪个接口
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now()
    res.on('finish', () => {
      const user = req.authUser?.username ?? 'anonymous'
      const ip = req.ip ?? '-' // trust proxy 可信口径，客户端伪造的 XFF 首段被忽略
      const ms = Date.now() - start
      logger.info(req.traceId, `${req.method} ${sanitizePathForLog(req.originalUrl)} → ${res.statusCode} [user=${user}] [ip=${ip}] ${ms}ms`)
    })
    next()
  })

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

  // 报告插图静态服务：uuid 文件名不可枚举，与 /health 一样不经通用限流
  // （报告页一次加载多张图片会迅速耗尽 100 次/分钟配额；helmet CSP imgSrc 'self' 已放行同源图片）
  app.use(
    '/api/v1/uploads/report-images',
    express.static(REPORT_IMAGE_DIR, { maxAge: '30d', immutable: true, index: false, dotfiles: 'ignore' }),
  )

  // 报告公开分享（GET /api/v1/reports/shared/:token）：免 JWT（token 即授权），
  // 注册于通用限流与鉴权 reports 路由之前，自带独立限流（20 次/分/IP）+ 审计
  app.use('/api/v1/reports', reportsPublicRouter)

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
  app.use('/api/v1/transactions', transactionsRouter)
  app.use('/api/v1/inventory', inventoryRouter)
  app.use('/api/v1/tools', toolsRouter)

  // 中台单镜像模式：同一进程托管前端静态资源与 SPA 路由。
  if (webRoot) {
    app.use(createPortalWebHandler(webRoot, basePath))
  }

  // 兜底 404 与全局错误处理
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
