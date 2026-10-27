import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { clearEmailCollectionSnooze } from '@/lib/email-collection'
import { clearAccountReportDrafts } from '@/lib/report-draft'
import type { User } from '@/types'

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  /**
   * 7 天免登录的持久令牌明文（仅在客户端 localStorage 中持久化）。
   * 服务端只存 SHA-256 哈希；每次成功自动续登会旋转一次。
   * 登出 / 改密会被清空（强制所有自动登录设备重登）。
   */
  persistentLoginToken: string | null
  /** 修改密码对话框状态：force=true 为强制改密（不可关闭） */
  passwordDialog: { open: boolean; force: boolean }
  /**
   * 会话已失效（刷新令牌失败），等待同页重新认证（FE-02）。
   * 保留 user 与页面状态以避免销毁表单输入；不落库、不跨刷新承诺恢复。
   */
  reauthRequired: boolean
  login: (
    user: User,
    accessToken: string,
    refreshToken: string,
    options?: { persistentLoginToken?: string | null }
  ) => void
  logout: () => void
  updateUser: (user: Partial<User>) => void
  setTokens: (accessToken: string, refreshToken: string) => void
  /** 自动登录成功后用新旋转的持久令牌覆盖旧值 */
  setPersistentLoginToken: (token: string | null) => void
  openPasswordDialog: (force: boolean) => void
  closePasswordDialog: () => void
  /** 会话失效统一入口：保留当前账号与页面状态，等待同页重新认证 */
  expireSession: () => void
  /** 同页重新认证成功（仅同一稳定账号）：更新令牌与资料，不清空页面状态 */
  reauthenticate: (user: User, accessToken: string, refreshToken: string) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      persistentLoginToken: null,
      passwordDialog: { open: false, force: false },
      reauthRequired: false,
      login: (user, accessToken, refreshToken, options) =>
        set(() => {
          // 新一轮登录：清掉上次「暂不填写工作邮箱」的会话豁免，让收集引导重新生效
          clearEmailCollectionSnooze()
          return {
            user,
            accessToken,
            refreshToken,
            isAuthenticated: true,
            persistentLoginToken: options?.persistentLoginToken ?? null,
            reauthRequired: false,
          }
        }),
      logout: () => {
        // 显式退出清理本人报告草稿；会话过期走 expireSession/reauthenticate，不经过此处
        const userId = get().user?.id
        if (userId) clearAccountReportDrafts(userId)
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          persistentLoginToken: null,
          passwordDialog: { open: false, force: false },
          reauthRequired: false,
        })
      },
      updateUser: (userData) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...userData } : null,
        })),
      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),
      setPersistentLoginToken: (token) => set({ persistentLoginToken: token }),
      openPasswordDialog: (force) => set({ passwordDialog: { open: true, force } }),
      closePasswordDialog: () => set({ passwordDialog: { open: false, force: false } }),
      expireSession: () => set({ reauthRequired: true }),
      reauthenticate: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken, isAuthenticated: true, reauthRequired: false }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
        persistentLoginToken: state.persistentLoginToken,
      }),
    }
  )
)
