import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '@/types'

interface AuthState {
  user: User | null
  accessToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  /** 修改密码对话框状态：force=true 为强制改密（不可关闭） */
  passwordDialog: { open: boolean; force: boolean }
  login: (user: User, accessToken: string, refreshToken: string) => void
  logout: () => void
  updateUser: (user: Partial<User>) => void
  setTokens: (accessToken: string, refreshToken: string) => void
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
      passwordDialog: { open: false, force: false },
      login: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken, isAuthenticated: true }),
      logout: () =>
        set({ user: null, accessToken: null, refreshToken: null, isAuthenticated: false, passwordDialog: { open: false, force: false } }),
      updateUser: (userData) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...userData } : null,
        })),
      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),
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
      }),
    }
  )
)
