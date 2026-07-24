import { createApp } from './app'
import { loadConfig } from './config/env'
import { logger } from './lib/logger'
import { basePrisma } from './lib/prisma'

/**
 * 服务启动入口。
 * 启动前强制加载并校验配置（JWT_SECRET 缺失将在此抛异常中止启动）。
 */
async function bootstrap(): Promise<void> {
  const config = loadConfig()
  const app = createApp()

  const server = app.listen(config.port, () => {
    logger.info(undefined, `后端服务已启动：http://localhost:${config.port}（env=${config.nodeEnv}）`)
  })

  const shutdown = async (signal: string): Promise<void> => {
    logger.info(undefined, `收到 ${signal}，开始优雅关闭...`)
    server.close(() => logger.info(undefined, 'HTTP 服务器已关闭'))
    await basePrisma.$disconnect()
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

bootstrap().catch((err) => {
  logger.error(undefined, '服务启动失败', err)
  process.exit(1)
})
