import { create } from 'zustand'

/**
 * AI 全局预分析结果缓存（模块级内存，不持久化）。
 *
 * 目的：用户切换页面（SPA 路由）后，面板组件卸载但流式请求继续在后台完成，
 * 结果写入本 store（按 主体|期间 分槽）；返回页面时组件从 store 恢复，
 * 进行中的槽位随后台写入实时更新。
 *
 * 竞态防护：begin 递增该 key 的 requestSeq，append/finish/fail 先校验 seq 匹配
 * 才写入——筛选切换重建组件后，旧请求即使未被 abort 也无法覆盖新槽位结果。
 * 刷新页面/关闭浏览器后内存清空，需重新生成（已知边界）。
 */

export interface OverviewSlot {
  status: 'idle' | 'streaming' | 'done' | 'error'
  preview: string
  error?: string
}

interface AiOverviewStore {
  /** key = `${companyCode}|${period}`（与面板重建 key 同值） */
  slots: Record<string, OverviewSlot>
  /** 每个 key 当前生效的请求序号（防旧请求覆盖新请求） */
  requestSeq: Record<string, number>
  /** 开始生成：槽位置 streaming 并递增序号，返回当前序号 */
  begin: (key: string) => number
  /** 追加流式片段（仅当序号匹配且槽位为 streaming） */
  append: (key: string, seq: number, delta: string) => void
  /** 完成：置 done 并写入最终文本（仅当序号匹配） */
  finish: (key: string, seq: number, text: string) => void
  /** 失败：置 error（仅当序号匹配） */
  fail: (key: string, seq: number, msg: string) => void
  /** 清空槽位 */
  reset: (key: string) => void
}

export const useAiOverviewStore = create<AiOverviewStore>()((set, get) => ({
  slots: {},
  requestSeq: {},

  begin: (key) => {
    const seq = (get().requestSeq[key] ?? 0) + 1
    set((s) => ({
      requestSeq: { ...s.requestSeq, [key]: seq },
      slots: { ...s.slots, [key]: { status: 'streaming', preview: '' } },
    }))
    return seq
  },

  append: (key, seq, delta) =>
    set((s) => {
      if (s.requestSeq[key] !== seq) return s
      const slot = s.slots[key]
      if (!slot || slot.status !== 'streaming') return s
      return { slots: { ...s.slots, [key]: { ...slot, preview: slot.preview + delta } } }
    }),

  finish: (key, seq, text) =>
    set((s) => {
      if (s.requestSeq[key] !== seq) return s
      return { slots: { ...s.slots, [key]: { status: 'done', preview: text } } }
    }),

  fail: (key, seq, msg) =>
    set((s) => {
      if (s.requestSeq[key] !== seq) return s
      return { slots: { ...s.slots, [key]: { status: 'error', preview: '', error: msg } } }
    }),

  reset: (key) =>
    set((s) => {
      if (!(key in s.slots)) return s
      const slots = { ...s.slots }
      delete slots[key]
      return { slots }
    }),
}))
