import { describe, it, expect } from 'vitest'
import {
  LOGIN_CAPTCHA_THRESHOLD,
  LOGIN_CAPTCHA_WINDOW_MS,
  clearLoginFailures,
  hasExceededFailureThreshold,
  isCaptchaNeeded,
  recordLoginFailure,
} from './LoginAttemptService'

/**
 * 登录失败计数（内存态，模块级状态在文件内共享）：
 * 用互不相同的账号名隔离用例，避免相互污染；窗口用显式 now 推进，无需假定时器。
 */
describe('LoginAttemptService', () => {
  it('未达阈值不要求验证码，达到阈值（5 次）才要求', () => {
    const user = 'threshold-user'
    for (let i = 0; i < LOGIN_CAPTCHA_THRESHOLD - 1; i++) recordLoginFailure(user)
    expect(hasExceededFailureThreshold(user)).toBe(false)
    expect(isCaptchaNeeded(user, false)).toBe(false)

    recordLoginFailure(user)
    expect(hasExceededFailureThreshold(user)).toBe(true)
    expect(isCaptchaNeeded(user, false)).toBe(true)
  })

  it('窗口过期后重新放行（15 分钟滑动）', () => {
    const user = 'window-user'
    const start = Date.now()
    for (let i = 0; i < LOGIN_CAPTCHA_THRESHOLD; i++) recordLoginFailure(user, start)
    expect(isCaptchaNeeded(user, false, start)).toBe(true)

    // 窗口内仍在计算周期内
    expect(isCaptchaNeeded(user, false, start + LOGIN_CAPTCHA_WINDOW_MS - 1)).toBe(true)
    // 超出窗口：旧失败被丢弃
    expect(isCaptchaNeeded(user, false, start + LOGIN_CAPTCHA_WINDOW_MS)).toBe(false)
  })

  it('滑动窗口只统计窗口内的失败（旧记录过期、新记录仍计数）', () => {
    const user = 'sliding-user'
    const start = Date.now()
    // 4 次旧失败 + 窗口过期
    for (let i = 0; i < LOGIN_CAPTCHA_THRESHOLD - 1; i++) recordLoginFailure(user, start)
    const later = start + LOGIN_CAPTCHA_WINDOW_MS + 1000
    expect(isCaptchaNeeded(user, false, later)).toBe(false)
    // 新窗口内再失败 5 次 → 要求验证码；此时旧记录已被清理
    for (let i = 0; i < LOGIN_CAPTCHA_THRESHOLD; i++) recordLoginFailure(user, later)
    expect(isCaptchaNeeded(user, false, later)).toBe(true)
  })

  it('登录成功清零失败计数', () => {
    const user = 'clear-user'
    for (let i = 0; i < LOGIN_CAPTCHA_THRESHOLD; i++) recordLoginFailure(user)
    expect(isCaptchaNeeded(user, false)).toBe(true)

    clearLoginFailures(user)
    expect(hasExceededFailureThreshold(user)).toBe(false)
    expect(isCaptchaNeeded(user, false)).toBe(false)
  })

  it('账号名大小写与空格归一：换个写法绕不开计数', () => {
    recordLoginFailure('Case.User ', Date.now())
    recordLoginFailure('case.user', Date.now())
    for (let i = 0; i < LOGIN_CAPTCHA_THRESHOLD - 2; i++) recordLoginFailure('CASE.USER')
    expect(isCaptchaNeeded('case.user', false)).toBe(true)
    expect(isCaptchaNeeded('  Case.User  ', false)).toBe(true)
  })

  it('应急开关开启时任何账号（含从未失败过）都要求验证码', () => {
    expect(isCaptchaNeeded('never-failed-user', true)).toBe(true)
    expect(isCaptchaNeeded('never-failed-user', false)).toBe(false)
  })

  it('账号之间互不影响', () => {
    const victim = 'isolated-a'
    for (let i = 0; i < LOGIN_CAPTCHA_THRESHOLD; i++) recordLoginFailure(victim)
    expect(isCaptchaNeeded(victim, false)).toBe(true)
    expect(isCaptchaNeeded('isolated-b', false)).toBe(false)
  })
})
