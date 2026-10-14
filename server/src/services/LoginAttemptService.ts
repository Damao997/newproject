/**
 * 登录失败计数（进程内存态，与 CaptchaService 同构）。
 *
 * 口径：**按账号**累计（不按 IP —— 公司同一出口 IP 下会互相连累），15 分钟滑动窗口，
 * 窗口内失败达到阈值后，该账号后续登录必须带图形验证码；登录成功即清零。
 * 仅适用于单实例部署（生产 PM2 为 fork 模式，见 zjyph-ecosystem.config.cjs）；
 * 若未来改为 cluster 多实例，需将存储迁移到 PostgreSQL 等共享介质。
 */

/** 触发验证码所需的窗口内失败次数 */
export const LOGIN_CAPTCHA_THRESHOLD = 5
/** 失败计数观察窗口（滑动） */
export const LOGIN_CAPTCHA_WINDOW_MS = 15 * 60 * 1000

/**
 * 账号 key：统一去空格 + 小写。
 * 用户名查库是大小写敏感的精确匹配，若按原始写法计数，攻击者可用 Admin / admin 变体把计数拆开绕过。
 */
function keyOf(username: string): string {
  return username.trim().toLowerCase()
}

const failures = new Map<string, number[]>()

/** 读取窗口内的失败时间戳，并顺手丢弃窗口外的记录（惰性清理） */
function recentFailures(key: string, now: number): number[] {
  const kept = (failures.get(key) ?? []).filter((at) => now - at < LOGIN_CAPTCHA_WINDOW_MS)
  if (kept.length === 0) failures.delete(key)
  else failures.set(key, kept)
  return kept
}

/** 记一次登录失败（凭证错误：账号不存在 / 停用 / 密码错） */
export function recordLoginFailure(username: string, now: number = Date.now()): void {
  const key = keyOf(username)
  const list = recentFailures(key, now)
  list.push(now)
  failures.set(key, list)
}

/** 该账号窗口内的失败次数是否已达阈值 */
export function hasExceededFailureThreshold(username: string, now: number = Date.now()): boolean {
  return recentFailures(keyOf(username), now).length >= LOGIN_CAPTCHA_THRESHOLD
}

/**
 * 登录是否必须携带验证码：应急开关（全局）或该账号失败次数达阈值。
 * 判定只在这里做，调用方传入开关值，便于单测覆盖四种组合。
 */
export function isCaptchaNeeded(username: string, alwaysRequired: boolean, now: number = Date.now()): boolean {
  return alwaysRequired || hasExceededFailureThreshold(username, now)
}

/** 登录成功：清零该账号的失败计数 */
export function clearLoginFailures(username: string): void {
  failures.delete(keyOf(username))
}
