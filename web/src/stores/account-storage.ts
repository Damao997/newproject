import type { StateStorage } from 'zustand/middleware'
let account: string | null = null
export function setStorageAccount(id: string | null) { account = id }
/** 登录前不加载业务筛选；旧数据只允许首次绑定的账号继承。 */
export const accountStorage: StateStorage = {
  getItem(name) { return account ? localStorage.getItem(name + ':' + account) : null },
  setItem(name, value) { if (account) localStorage.setItem(name + ':' + account, value) },
  removeItem(name) { if (account) localStorage.removeItem(name + ':' + account) },
}
export function claimLegacyStorage(id: string) {
  const owner = localStorage.getItem('legacy-settings-owner')
  if (owner && owner !== id) return false
  if (!owner) localStorage.setItem('legacy-settings-owner', id)
  for (const name of ['period-storage', 'page-state-storage']) {
    const scoped = name + ':' + id
    if (!localStorage.getItem(scoped) && localStorage.getItem(name)) localStorage.setItem(scoped, localStorage.getItem(name)!)
  }
  return true
}
