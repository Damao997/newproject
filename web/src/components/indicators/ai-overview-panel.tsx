import { useEffect, useRef, useState } from 'react'
import { Sparkles, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { streamAI, type StreamController } from '@/lib/ai-stream'
import type { OperatingRow, StaticRow } from '@/hooks/api-queries'

type Row = OperatingRow | StaticRow

interface AiOverviewPanelProps {
  /** 分析主体（单一公司/汇总主体编码；全部主体时不传，后端按 scope 汇总表述） */
  companyCode?: string
  period?: string
  operatingRows: Row[]
  staticRows: Row[]
  disabled?: boolean
  /** 递增令牌：非 0 变化时自动触发生成（供筛选栏按钮作为入口触发） */
  autoRunToken?: number
}

/**
 * AI 全局预分析面板：将当前主体显示的经营+静态指标行一次性提交后端，
 * SSE 流式展示综合预分析报告（趋势概览/关键变化/预算达成/月度累计对比）。
 * 手动触发，一次 LLM 调用，不阻塞页面。
 */
export function AiOverviewPanel({ companyCode, period, operatingRows, staticRows, disabled, autoRunToken }: AiOverviewPanelProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState<string | null>(null)
  const ctrlRef = useRef<StreamController | null>(null)

  // 卸载时中止 AI 流（筛选切换重建组件或页面离开时，旧流不再写回状态）
  useEffect(() => () => ctrlRef.current?.abort(), [])

  // 筛选栏入口触发：令牌变化时自动生成（重建后的组件闭包为当前筛选数据）
  useEffect(() => {
    if (autoRunToken) handleGenerate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRunToken])

  const hasData = operatingRows.length > 0 || staticRows.length > 0

  const handleGenerate = () => {
    if (!hasData || disabled || streaming) return
    setError(null)
    setPreview('')
    setStreaming(true)
    ctrlRef.current?.abort()
    ctrlRef.current = streamAI(
      '/ai/overview',
      { companyCode, period, operating: operatingRows, static: staticRows },
      {
        onToken: (d) => setPreview((p) => p + d),
        onDone: () => setStreaming(false),
        onError: (msg) => {
          setError(msg)
          setStreaming(false)
        },
      },
    )
  }

  return (
    <Card className="animate-fade-in">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            <h3 className="shrink-0 text-sm font-semibold text-foreground">AI 全局预分析</h3>
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">
              基于当前主体的经营与静态指标生成综合性预分析报告
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="outline" size="sm" onClick={handleGenerate} disabled={disabled || !hasData || streaming} className="h-7 text-primary">
              {streaming ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
              {streaming ? '生成中…' : preview ? '重新生成' : '生成预分析'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCollapsed((v) => !v)} className="h-7 px-2 text-muted-foreground" title={collapsed ? '展开' : '折叠'}>
              {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {!hasData && !collapsed && (
          <p className="mt-2 text-xs text-muted-foreground">当前筛选无指标数据，无法生成预分析。</p>
        )}

        {!collapsed && (streaming || preview || error) && hasData && (
          <div className="mt-3 rounded-md border bg-muted/20 px-3 py-2 text-[13px] leading-relaxed">
            {error ? (
              <span className="text-finance-red">{error}</span>
            ) : (
              <p className="whitespace-pre-wrap text-foreground">{preview || '…'}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
