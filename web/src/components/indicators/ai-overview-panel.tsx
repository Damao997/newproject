import { useEffect } from 'react'
import { Sparkles, Loader2, Save, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { renderOverviewText } from '@/lib/overview-render'
import { useAiStream } from '@/hooks/use-ai-stream'
import { useAiOverviewStore } from '@/stores/aiOverviewStore'
import type { OperatingRow, StaticRow } from '@/hooks/api-queries'

type Row = OperatingRow | StaticRow

/** 模块级已消费令牌：页面层以 key（公司|期间）重建组件时 ref 会重置，旧令牌不应再次触发自动生成 */
let lastConsumedAutoRunToken = 0

interface AiOverviewDialogProps {
  /** 弹窗开关（受控） */
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 跳转分析管理页（查看已保存的预分析归档） */
  onViewAnalyses: () => void
  /** 分析主体（单一公司/汇总主体编码；全部主体时不传，后端按 scope 汇总表述） */
  companyCode?: string
  period?: string
  operatingRows: Row[]
  staticRows: Row[]
  disabled?: boolean
  /** 递增令牌：非 0 变化时自动触发生成并打开弹窗（页面层数据就绪后递增；顶部按钮与弹窗按钮共用此链路） */
  autoRunToken?: number
  /** 结果槽位 key（与弹窗重建 key 同值），对应 aiOverviewStore 分槽缓存 */
  slotKey: string
  /** 生成前数据准备回调：另一体系指标数据缺失时由页面层按需拉取，就绪后递增 autoRunToken */
  onNeedData?: () => void
}

/**
 * AI 全局预分析弹窗：将当前主体显示的经营+静态指标行一次性提交后端，
 * SSE 流式展示综合预分析报告（趋势概览/关键变化/预算达成/月度累计对比）。
 *
 * 保存机制：后端在流式生成完成后自动将报告归档为「单项分析」（主体 × 全局预分析 OVERVIEW × 期间，
 * 幂等覆盖），弹窗在 done 态提示保存结果并提供「查看分析」入口。
 *
 * 后台完成机制：结果写入全局 aiOverviewStore（按 slotKey 分槽），弹窗关闭不中断请求
 * （useAiStream abortOnUnmount=false + requestId 竞态防护）；页面切换后分析在后台
 * 继续完成，重新打开时从 store 恢复（进行中的槽位实时更新）。
 */
export function AiOverviewDialog({ open, onOpenChange, onViewAnalyses, companyCode, period, operatingRows, staticRows, disabled, autoRunToken, slotKey, onNeedData }: AiOverviewDialogProps) {
  const slot = useAiOverviewStore((s) => s.slots[slotKey])
  const streaming = slot?.status === 'streaming'
  const hasData = operatingRows.length > 0 || staticRows.length > 0

  const ai = useAiStream({
    path: '/ai/overview',
    body: { companyCode, period, operating: operatingRows, static: staticRows },
    abortOnUnmount: false,
    // 请求标识 = store 槽位序号：begin 在发起时递增，回调携带该序号，旧请求晚到写入被忽略
    requestId: () => useAiOverviewStore.getState().begin(slotKey),
    onToken: (d, rid) => useAiOverviewStore.getState().append(slotKey, rid ?? 0, d),
    onDone: (finalText, rid) => useAiOverviewStore.getState().finish(slotKey, rid ?? 0, finalText),
    onError: (msg, rid) => useAiOverviewStore.getState().fail(slotKey, rid ?? 0, msg),
  })

  const handleGenerate = () => {
    if (!hasData || disabled || streaming) return
    // 先保证两体系数据就绪（缺失时页面层按需拉取），就绪后递增 autoRunToken 触发本 effect 启动生成；
    // 未接入页面层（无 onNeedData）时直接启动，保持组件独立可用
    if (onNeedData) onNeedData()
    else ai.start()
  }

  // 生成唯一执行点（顶部按钮 → 页面层数据就绪 → 令牌递增）：自动打开弹窗展示生成过程；
  // 令牌单调递增且仅在首次出现时消费（模块级标记跨重挂载保留，key 变化重建组件不重复触发）
  useEffect(() => {
    if (autoRunToken && autoRunToken > lastConsumedAutoRunToken) {
      lastConsumedAutoRunToken = autoRunToken
      onOpenChange(true)
      ai.start()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunToken])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            AI 全局预分析
          </DialogTitle>
          <DialogDescription>
            基于当前主体的经营与静态指标生成综合性预分析报告，生成后自动保存到「单项分析」列表。
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
          {!hasData && <p className="text-body text-muted-foreground">当前筛选无指标数据，无法生成预分析。</p>}

          {/* 内容区：流式增长限高内部滚动，不撑高弹窗 */}
          {slot && hasData && (
            <>
              {slot.status === 'error' ? (
                <p className="text-body text-destructive">{slot.error}</p>
              ) : (
                <div className="rounded-md border bg-muted/20 px-3 py-2 text-body leading-relaxed" aria-live="polite">
                  {slot.status === 'streaming' && (
                    <p className="mb-1 flex items-center gap-1 text-caption text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> AI 预分析生成中…（模型推理通常需 10-40 秒）
                    </p>
                  )}
                  {slot.preview ? renderOverviewText(slot.preview) : slot.status === 'streaming' ? <p>…</p> : null}
                </div>
              )}

              {/* 生成完成：后端已自动归档为单项分析（全局预分析），提供查看/插入报告入口 */}
              {slot.status === 'done' && (
                <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/[0.08] px-3 py-2 text-body text-success-strong">
                  <Save className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">已自动保存到「单项分析」列表（全局预分析），可在分析管理页编辑或插入报告章节。</span>
                  <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={onViewAnalyses}>
                    <Eye className="mr-1 h-3.5 w-3.5" /> 查看分析
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-between gap-2 border-t px-5 py-3">
          <span className="text-xs text-muted-foreground">{slot?.status === 'done' ? '重新生成将覆盖已保存内容' : '报告生成后自动保存'}</span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleGenerate}
            disabled={disabled || !hasData || streaming}
            aria-busy={streaming}
            className="text-primary"
          >
            {streaming ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
            {streaming ? '生成中…' : slot?.status === 'done' ? '重新生成' : '生成预分析'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
