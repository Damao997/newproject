/** 密码规则校验（与后端 assertPasswordRule 一致）：至少 8 位且含字母与数字 */
export function validatePassword(password: string): string | null {
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return '密码至少 8 位，且需同时包含字母与数字'
  }
  return null
}
