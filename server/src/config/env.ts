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
  /** SMTP 主机：null 表示未配置邮件服务（邮箱重置密码接口返回 503，登录等其他功能不受影响） */
  smtpHost: string | null
  smtpPort: number
  smtpUser: string | null
  smtpPass: string | null
  /** 发件人地址（如 "浙壹品慧平台 <no-reply@example.com>"）；SMTP 发送时必填 */
  mailFrom: string | null
  /** 开发期邮件捕获：写 .eml/.json 到 server/.mail-out/（仅限非生产；生产启用将拒绝启动） */
  mailDevCapture: boolean
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
    smtpHost: process.env.SMTP_HOST && process.env.SMTP_HOST.trim() !== '' ? process.env.SMTP_HOST.trim() : null,
    smtpPort: Number(optional('SMTP_PORT', '465')),
    smtpUser: process.env.SMTP_USER && process.env.SMTP_USER.trim() !== '' ? process.env.SMTP_USER.trim() : null,
    smtpPass: process.env.SMTP_PASS && process.env.SMTP_PASS.trim() !== '' ? process.env.SMTP_PASS.trim() : null,
    mailFrom: process.env.MAIL_FROM && process.env.MAIL_FROM.trim() !== '' ? process.env.MAIL_FROM.trim() : null,
    mailDevCapture: optional('MAIL_DEV_CAPTURE', '0') === '1',
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
  if (Number.isNaN(config.smtpPort) || config.smtpPort < 1 || config.smtpPort > 65535) {
    throw new Error('环境变量 SMTP_PORT 非法（需为 1..65535 的整数）')
  }
  // 安全红线：生产环境把验证码明文落盘等于把账号找回能力暴露给服务器文件系统
  if (config.mailDevCapture && config.nodeEnv === 'production') {
    throw new Error('生产环境禁止启用 MAIL_DEV_CAPTURE（邮件明文落盘会泄露验证码）')
  }

  cached = config
  return config
}
