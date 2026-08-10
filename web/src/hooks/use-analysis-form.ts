import { useEffect, useRef, useState } from 'react'
import { useAnalyses, useCreateAnalysis, useUpdateAnalysis, useDeleteAnalysis } from '@/hooks/api-queries'

/**
 * 单项分析表单状态机（指标抽屉 / 往来抽屉共用）。
 *
 * 封装两个抽屉重复的逻辑：既有分析查询回填（existingId/title/content）、
 * 新增/更新/删除（upsert 幂等键 公司×科目×期间）、保存反馈与 busy 态。
 *
 * buildPayload 由组件提供闭包（捕获最新 metricContext 等上下文快照），
 * hook 通过 optsRef 读取最近一次渲染的闭包，保证保存时使用最新值。
 */

export interface AnalysisPayload {
  companyCode: string
  subjectCode: string
  subjectType: 'operating' | 'static' | 'transaction'
  fiscalYear: string
  period: string
  title: string
  content: string
  metricContext?: Record<string, unknown> | null
}

export function useAnalysisForm(opts: {
  /** 既有分析查询参数（与后端唯一键一致） */
  fetchParams: { companyCode: string; subjectCode: string; period: string }
  /** 查询开关（如未选公司/类型时不查询） */
  fetchEnabled?: boolean
  /** 保存 payload 构建（闭包捕获组件最新上下文快照；可抛错以阻止保存并反馈） */
  buildPayload: (title: string, content: string) => AnalysisPayload
  /** 无既有记录时的默认标题 */
  defaultTitle: () => string
  /** 删除确认文案 */
  deleteConfirmText?: string
}): {
  title: string
  setTitle: (v: string) => void
  content: string
  setContent: (v: string) => void
  existingId: string | null
  feedback: { type: 'ok' | 'err'; msg: string } | null
  busy: boolean
  save: () => Promise<void>
  remove: () => Promise<void>
} {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [existingId, setExistingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null)
  const optsRef = useRef(opts)
  optsRef.current = opts
  // 查询参数变化（公司/科目/期间切换）时重置表单
  const paramsKey = `${opts.fetchParams.companyCode}|${opts.fetchParams.subjectCode}|${opts.fetchParams.period}`

  const { data } = useAnalyses(opts.fetchParams, { enabled: opts.fetchEnabled !== false })
  const existing = data?.items?.[0]

  // 查询结果到达或查询目标变化时一次性回填/重置
  useEffect(() => {
    if (existing) {
      setExistingId(existing.id)
      setTitle(existing.title)
      setContent(existing.content)
    } else {
      setExistingId(null)
      setTitle(optsRef.current.defaultTitle())
      setContent('')
    }
    setFeedback(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id, paramsKey])

  const createMutation = useCreateAnalysis()
  const updateMutation = useUpdateAnalysis()
  const deleteMutation = useDeleteAnalysis()
  const busy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending

  const save = async () => {
    setFeedback(null)
    try {
      const payload = optsRef.current.buildPayload(title, content)
      if (existingId) {
        await updateMutation.mutateAsync({ id: existingId, data: { title: payload.title, content: payload.content, metricContext: payload.metricContext ?? null } })
        setFeedback({ type: 'ok', msg: '已保存修改' })
      } else {
        const created = await createMutation.mutateAsync(payload)
        setExistingId(created.id)
        setFeedback({ type: 'ok', msg: '已新增分析' })
      }
    } catch (e) {
      setFeedback({ type: 'err', msg: (e as Error).message || '保存失败' })
    }
  }

  const remove = async () => {
    if (!existingId) return
    const text = optsRef.current.deleteConfirmText ?? '确认删除该单项分析？删除后引用它的报告章节将标记为"原文已删除"。'
    if (!window.confirm(text)) return
    setFeedback(null)
    try {
      await deleteMutation.mutateAsync(existingId)
      setExistingId(null)
      setTitle(optsRef.current.defaultTitle())
      setContent('')
      setFeedback({ type: 'ok', msg: '已删除' })
    } catch (e) {
      setFeedback({ type: 'err', msg: (e as Error).message || '删除失败' })
    }
  }

  return { title, setTitle, content, setContent, existingId, feedback, busy, save, remove }
}
