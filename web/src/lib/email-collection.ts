/**
 * 一次性邮箱收集活动的客户端豁免状态。
 *
 * 「暂不填写」只豁免**本次浏览器会话**（sessionStorage）：页面刷新不再骚扰，
 * 但登出后重新登录会清空（见 authStore.login），因此下次登录必再提醒。
 */
export const EMAIL_COLLECTION_SNOOZE_KEY = 'email-collection-snoozed'

export function isEmailCollectionSnoozed(): boolean {
  try {
    return sessionStorage.getItem(EMAIL_COLLECTION_SNOOZE_KEY) === '1'
  } catch (cause) {
    // 无痕模式等禁用存储的场景：读取失败按未豁免处理，弹窗照常引导
    console.error('邮箱收集引导：读取会话存储失败', cause)
    return false
  }
}

export function snoozeEmailCollection(): void {
  try {
    sessionStorage.setItem(EMAIL_COLLECTION_SNOOZE_KEY, '1')
  } catch (cause) {
    console.error('邮箱收集引导：写入会话存储失败', cause)
  }
}

export function clearEmailCollectionSnooze(): void {
  try {
    sessionStorage.removeItem(EMAIL_COLLECTION_SNOOZE_KEY)
  } catch (cause) {
    console.error('邮箱收集引导：清除会话存储失败', cause)
  }
}
