import type { ReactNode } from 'react'

/** 完整保留标签和读数；比较与排名共用紧凑行，窄卡片恢复两层。 */
export function DistributionBar({ label, value, meta, width, color, variant = 'default' }: {
  label: string; value: ReactNode; meta?: ReactNode; width: number; color?: string
  variant?: 'default' | 'comparison' | 'ranking'
}) {
  return <div className="distribution-row" data-distribution-variant={variant}>
    <div className="distribution-row-info">
      <span className="distribution-row-label">{label}</span>
      <div className="distribution-row-values font-num">
        <span className="distribution-row-value">{value}</span>
        {meta && <span className="distribution-row-meta">{meta}</span>}
      </div>
    </div>
    <div className="distribution-row-track" aria-hidden>
      <div className="distribution-row-fill" style={{ width: `${Math.max(0, Math.min(100, width))}%`, ...(color ? { background: color } : {}) }} />
    </div>
  </div>
}
