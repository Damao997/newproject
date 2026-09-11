import { create } from 'zustand'
import { persist } from 'zustand/middleware'
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
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      persistentLoginToken: null,
      passwordDialog: { open: false, force: false },
      login: (user, accessToken, refreshToken, options) =>
        set({
          user,
          accessToken,
          refreshToken,
          isAuthenticated: true,
          persistentLoginToken: options?.persistentLoginToken ?? null,
        }),
      logout: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
          persistentLoginToken: null,
          passwordDialog: { open: false, force: false },
        }),
      updateUser: (userData) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...userData } : null,
        })),
      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),
      setPersistentLoginToken: (token) => set({ persistentLoginToken: token }),
      openPasswordDialog: (force) => set({ passwordDialog: { open: true, force } }),
      closePasswordDialog: () => set({ passwordDialog: { open: false, force: false } }),
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
