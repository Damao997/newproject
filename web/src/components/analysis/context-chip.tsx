/**
 * 指标上下文数值卡（分析抽屉上下文区共用）。
 * 标签 + font-num 等宽数值，两列/多列网格布局由父级控制。
 */
export function ContextChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col rounded-md border bg-muted/30 px-3 py-1.5">
      <span className="text-caption text-muted-foreground">{label}</span>
      <span className="font-num text-body text-foreground">{value}</span>
    </div>
  )
}
