import helmet from 'helmet'
import type { RequestHandler } from 'express'

/**
 * HTTP 安全响应头：CSP / HSTS / X-Frame-Options / X-Content-Type-Options。
 * 见 docs/references/security.md。
 */
export function securityHeaders(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: {
      maxAge: 15552000, // 180 天
      includeSubDomains: true,
    },
    frameguard: { action: 'deny' },
    noSniff: true,
  })
}
