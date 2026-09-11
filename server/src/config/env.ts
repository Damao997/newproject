import dotenv from 'dotenv'
import { getFiscalStartMonth } from '../lib/period'

dotenv.config()

/**
 * 集中读取并校验环境变量。
 * 安全红线：JWT_SECRET / JWT_REFRESH_SECRET 缺失或过短时抛异常中止启动，
 * 禁止回退默认值（见 docs/references/security.md）。
 */
function required(name: string, minLength = 0): string {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(`环境变量 ${name} 未配置，服务拒绝启动`)
  }
  if (minLength > 0 && value.length < minLength) {
    throw new Error(`环境变量 ${name} 长度不足（至少 ${minLength} 位），服务拒绝启动`)
  }
  return value
}

function optional(name: string, fallback: string): string {
  const value = process.env[name]
  return value && value.trim() !== '' ? value : fallback
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

export interface AppConfig {
  nodeEnv: string
  port: number
  databaseUrl: string
  jwtSecret: string
  jwtRefreshSecret: string
  accessTokenTtl: string
  refreshTokenTtl: string
  /** 「7 天内免登录」持久令牌有效期（天） */
  persistentLoginTtlDays: number
  frontendOrigin: string
  bcryptCost: number
  logLevel: LogLevel
  deepseekApiKey: string | null
  deepseekApiBase: string
  deepseekModel: string
  enterpriseInfoProvider: string
  enterpriseInfoApiKey: string | null
  enterpriseInfoApiBase: string
  fiscalStartMonth: number
}

let cached: AppConfig | null = null

export function loadConfig(): AppConfig {
  if (cached) return cached

  const config: AppConfig = {
    nodeEnv: optional('NODE_ENV', 'development'),
    port: Number(optional('PORT', '3001')),
    databaseUrl: required('DATABASE_URL'),
    jwtSecret: required('JWT_SECRET', 32),
    jwtRefreshSecret: required('JWT_REFRESH_SECRET', 32),
    accessTokenTtl: optional('ACCESS_TOKEN_TTL', '15m'),
    refreshTokenTtl: optional('REFRESH_TOKEN_TTL', '7d'),
    persistentLoginTtlDays: Number(optional('PERSISTENT_LOGIN_TTL_DAYS', '7')),
    frontendOrigin: optional('FRONTEND_ORIGIN', 'http://localhost:5173'),
    bcryptCost: Number(optional('BCRYPT_COST', '12')),
    logLevel: optional('LOG_LEVEL', 'INFO') as LogLevel,
    deepseekApiKey: process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.trim() !== '' ? process.env.DEEPSEEK_API_KEY.trim() : null,
    deepseekApiBase: optional('DEEPSEEK_API_BASE', 'https://api.deepseek.com/v1'),
    deepseekModel: optional('DEEPSEEK_MODEL', 'deepseek-v4-flash'),
    enterpriseInfoProvider: optional('ENTERPRISE_INFO_PROVIDER', 'mock'),
    enterpriseInfoApiKey: process.env.ENTERPRISE_INFO_API_KEY && process.env.ENTERPRISE_INFO_API_KEY.trim() !== '' ? process.env.ENTERPRISE_INFO_API_KEY.trim() : null,
    enterpriseInfoApiBase: optional('ENTERPRISE_INFO_API_BASE', ''),
    fiscalStartMonth: getFiscalStartMonth(),
  }

  if (Number.isNaN(config.port)) {
    throw new Error('环境变量 PORT 非法')
  }
  if (Number.isNaN(config.bcryptCost) || config.bcryptCost < 12) {
    throw new Error('环境变量 BCRYPT_COST 非法（cost 必须 >= 12）')
  }
  if (Number.isNaN(config.persistentLoginTtlDays) || config.persistentLoginTtlDays < 1) {
    throw new Error('环境变量 PERSISTENT_LOGIN_TTL_DAYS 非法（必须 >= 1）')
  }

  cached = config
  return config
}
