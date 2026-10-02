import { create } from 'zustand'

/** 公告弹窗打开时的初始视图：main=最新公告内容，list=历史版本列表 */
export type NoticeView = 'main' | 'list'

interface NoticeState {
  open: boolean
  initialView: NoticeView
  /** 打开全局公告弹窗；initialView='list' 直接进入历史版本列表 */
  openNotice: (initialView?: NoticeView) => void
  closeNotice: () => void
}

/**
 * 公告弹窗共享开关（非持久化）。
 *
 * 顶栏用户菜单「更新公告」触发打开，MainLayout 挂载的 VersionNotice 消费；
 * 用于解决「关闭公告弹窗后再无入口查看历史版本」的问题。
 */
export const useNoticeStore = create<NoticeState>((set) => ({
  open: false,
  initialView: 'main',
  openNotice: (initialView = 'main') => set({ open: true, initialView }),
  closeNotice: () => set({ open: false }),
}))