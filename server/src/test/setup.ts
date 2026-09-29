/**
 * Vitest 全局 setup：优先加载 server/.env（存在时用真实配置，支撑 DB 集成测试），
 * 再为缺失项注入满足 env 校验的测试默认值。
 *
 * 测试库身份校验（fail-fast）：.env 携带的真实 DATABASE_URL 若不含 test 库标识，
 * 直接中止测试进程——开发终端误继承开发/生产连接串时，集成测试的建删数据会写坏真实库。
 */
import 'dotenv/config'

function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL ?? ''
  if (!url) throw new Error('DATABASE_URL 未设置，无法运行测试')
  // 内置测试默认值直接放行
  if (url === 'postgresql://test:test@localhost:5432/test?schema=public') return
  let database = ''
  try {
    database = decodeURIComponent(new URL(url).pathname.replace(/^\//, '').split('?')[0] ?? '')
  } catch {
    // 非法 URL 交给 Prisma 在连接时报错
    return
  }
  if (!/test/i.test(database)) {
    throw new Error(
      `测试环境隔离校验失败：DATABASE_URL 指向的库「${database || '未知'}」不含 test 标识。`
      + '请在测试环境使用独立测试库（如 zjyph_test），禁止对开发/生产库运行集成测试',
    )
  }
}

function setDefault(key: string, value: string): void {
  if (!process.env[key] || process.env[key]?.trim() === '') {
    process.env[key] = value
  }
}

// 先注入内置测试默认值（.env 未配置 DATABASE_URL 时），再校验库身份
setDefault('DATABASE_URL', 'postgresql://test:test@localhost:5432/test?schema=public')
assertTestDatabase()

setDefault('JWT_SECRET', 'test-jwt-secret-0123456789abcdef0123456789abcdef')
setDefault('JWT_REFRESH_SECRET', 'test-refresh-secret-0123456789abcdef0123456789ab')
setDefault('ACCESS_TOKEN_TTL', '15m')
setDefault('REFRESH_TOKEN_TTL', '7d')
setDefault('FRONTEND_ORIGIN', 'http://localhost:5173')
setDefault('BCRYPT_COST', '12')
setDefault('LOG_LEVEL', 'ERROR')
setDefault('PORT', '3001')
setDefault('NODE_ENV', 'test')
