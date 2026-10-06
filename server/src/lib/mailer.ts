import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import nodemailer, { type Transporter } from 'nodemailer'
import { loadConfig } from '../config/env'
import { errors } from './errors'
import { logger } from './logger'

/**
 * 邮件发送（SMTP）。
 * - SMTP 参数来自 env（SMTP_HOST/PORT/USER/PASS/MAIL_FROM），全部可选：
 *   未配置时邮箱类功能（忘记密码）返回 503，登录等其他功能不受影响。
 * - MAIL_DEV_CAPTURE=1（仅限非生产，env.ts 启动校验拦截）：不连 SMTP，
 *   把邮件写为 server/.mail-out/*.eml（可双击用邮件客户端打开预览）+
 *   同名 .json（含验证码明文，供开发联调与集成测试读码）。该目录已 gitignore。
 * 安全：验证码/收件人等凭证与 PII 不打日志，仅记发送成功/失败事件。
 */

export interface MailPayload {
  to: string
  subject: string
  html: string
  /** 附加元数据：仅写入 dev 捕获 .json（如 { purpose, code }），不进入 SMTP 或日志 */
  captureMeta?: Record<string, unknown>
}

/** 生产部署若更换目录，可用环境变量覆盖（默认仓库内 .mail-out，已 gitignore） */
function captureDir(): string {
  return process.env.MAIL_OUT_DIR || path.resolve(__dirname, '../../.mail-out')
}

let transporter: Transporter | null = null

function getTransporter(): Transporter {
  const config = loadConfig()
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtpHost ?? undefined,
      port: config.smtpPort,
      // 465 为隐式 TLS（SMTPS），587/25 走明文连接后升级 STARTTLS
      secure: config.smtpPort === 465,
      // 内网中继可能免认证：仅当配置了账号时携带 auth
      ...(config.smtpUser ? { auth: { user: config.smtpUser, pass: config.smtpPass ?? '' } } : {}),
    })
  }
  return transporter
}

function assertMailConfigured(): void {
  const config = loadConfig()
  if (!config.smtpHost || !config.mailFrom) {
    throw errors.serviceUnavailable(
      '邮件服务未配置：请在 server/.env 配置 SMTP_HOST / MAIL_FROM 后重启服务（详见 .env.example 邮件段）',
    )
  }
}

/** dev 捕获：写 .eml（人工预览）+ .json（自动化读码），并打印落盘路径（不含验证码） */
function captureToFile(payload: MailPayload): void {
  const config = loadConfig()
  const dir = captureDir()
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const base = path.join(dir, `${stamp}-${(payload.captureMeta?.purpose as string) ?? 'mail'}`)
  const eml = [
    `From: ${config.mailFrom ?? 'dev-capture@local'}`,
    `To: ${payload.to}`,
    `Subject: ${payload.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    payload.html,
  ].join('\r\n')
  writeFileSync(`${base}.eml`, eml, 'utf8')
  writeFileSync(
    `${base}.json`,
    JSON.stringify({ to: payload.to, subject: payload.subject, capturedAt: new Date().toISOString(), ...payload.captureMeta }, null, 2),
    'utf8',
  )
  logger.info(undefined, `[mailer] 邮件已捕获到 ${base}.eml（MAIL_DEV_CAPTURE，未真实发送）`)
}

/** 发送邮件：SMTP 未配置且未开捕获时抛 503；发送失败抛 503（由统一响应兜底，不泄内部细节） */
export async function sendMail(payload: MailPayload): Promise<void> {
  const config = loadConfig()
  if (config.mailDevCapture) {
    captureToFile(payload)
    return
  }
  assertMailConfigured()
  try {
    await getTransporter().sendMail({
      from: config.mailFrom ?? undefined,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
    })
  } catch (err) {
    // 只记事件与错误类型，不记收件人/内容（PII 与凭证不入日志）
    logger.error(undefined, `[mailer] 邮件发送失败：${err instanceof Error ? err.name : 'unknown'}`)
    throw errors.serviceUnavailable('邮件发送失败，请稍后重试')
  }
}

/** HTML 转义：用户名等动态内容进邮件模板前转义，防 HTML/脚本注入 */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch)
}

/** 密码重置验证码邮件模板（简体中文，纯 HTML；不含密码等敏感信息） */
export function buildPasswordResetMail(payload: { to: string; code: string; expiresAt: Date; username: string }): MailPayload {
  const minutes = 10
  const safeUsername = escapeHtml(payload.username)
  return {
    to: payload.to,
    subject: '【浙壹品慧经营分析平台】密码重置验证码',
    html: [
      '<div style="max-width:520px;margin:0 auto;font-family:PingFang SC,Microsoft YaHei,Arial,sans-serif;color:#222;">',
      '  <h2 style="font-size:18px;">密码重置验证码</h2>',
      `  <p style="font-size:14px;line-height:1.8;">您好（账号：<strong>${safeUsername}</strong>），</p>`,
      `  <p style="font-size:14px;line-height:1.8;">您正在通过邮箱重置登录密码。验证码如下，<strong>${minutes} 分钟内有效</strong>：</p>`,
      `  <p style="font-size:30px;font-weight:700;letter-spacing:8px;margin:16px 0;color:#FF830F;">${payload.code}</p>`,
      '  <p style="font-size:13px;line-height:1.8;color:#666;">如非本人操作，请忽略本邮件；您的账号暂时无人改动。为保障安全，请勿把验证码告知任何人。</p>',
      '  <p style="font-size:12px;color:#999;">本邮件由系统自动发送，请勿回复。</p>',
      '</div>',
    ].join('\n'),
    captureMeta: { purpose: 'password_reset', code: payload.code, expiresAt: payload.expiresAt.toISOString() },
  }
}
