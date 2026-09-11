/**
 * Vitest 全局 setup：优先加载 server/.env（存在时用真实配置，支撑 DB 集成测试），
 * 再为缺失项注入满足 env 校验的测试默认值。
 */
import 'dotenv/config'

function setDefault(key: string, value: string): void {
  if (!process.env[key] || process.env[key]?.trim() === '') {
    process.env[key] = value
  }
}

setDefault('DATABASE_URL', 'postgresql://test:test@localhost:5432/test?schema=public')
setDefault('JWT_SECRET', 'test-jwt-secret-0123456789abcdef0123456789abcdef')
setDefault('JWT_REFRESH_SECRET', 'test-refresh-secret-0123456789abcdef0123456789ab')
setDefault('ACCESS_TOKEN_TTL', '15m')
setDefault('REFRESH_TOKEN_TTL', '7d')
setDefault('FRONTEND_ORIGIN', 'http://localhost:5173')
setDefault('BCRYPT_COST', '12')
setDefault('LOG_LEVEL', 'ERROR')
setDefault('PORT', '3001')
setDefault('NODE_ENV', 'test')
