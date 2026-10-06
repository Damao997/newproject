import { newCaptcha } from '../services/CaptchaService'

/**
 * 集成测试专用：取一个真实图形验证码。
 * 与被测 app 同进程，共享 CaptchaService 的内存 store，
 * 因此这里 newCaptcha() 的答案可直接通过 /auth/login 的校验。
 */
export function validCaptchaFields(): { captchaId: string; captcha: string } {
  const { captchaId, answer } = newCaptcha()
  return { captchaId, captcha: answer }
}
