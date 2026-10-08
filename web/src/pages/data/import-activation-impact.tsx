import { CheckCircle } from 'lucide-react'
import type { ImportActivationImpact, ImportCompanyPeriod } from '@/lib/api'

function CoverageGroup({ label, keys }: { label: string; keys: ImportCompanyPeriod[] }) {
  if (keys.length === 0) return null
  const textOf = (key: ImportCompanyPeriod) => key.companyCode + ' × ' + key.period
  return (
    <div>
      <p className="break-words text-sm">{label} {keys.length} 个公司月份组合：{keys.slice(0, 6).map(textOf).join('、')}{keys.length > 6 ? ' 等' : ''}。</p>
      {keys.length > 6 && (
        <details className="mt-1 text-xs">
          <summary className="cursor-pointer">查看全部{label}范围</summary>
          <ul className="mt-1 max-h-48 list-inside list-disc overflow-auto">
            {keys.map((key) => <li key={textOf(key)}>{textOf(key)}</li>)}
          </ul>
        </details>
      )}
    </div>
  )
}

/** 单文件与多表合并使用同一提示，直接展示服务端计算出的实际组合。 */
export function MonthlyActivationImpact({ impact }: { impact: ImportActivationImpact }) {
  const added = impact.newCompanyPeriods ?? []
  const replaced = impact.overlappingCompanyPeriods ?? []
  const retained = impact.retainedCompanyPeriods ?? []
  if (added.length + replaced.length + retained.length === 0) return null
  return (
    <div className="flex items-start space-x-2 rounded-lg border border-info/25 bg-info/10 p-3 text-info">
      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 space-y-1">
        <CoverageGroup label="将新增" keys={added} />
        <CoverageGroup label="将替换" keys={replaced} />
        <CoverageGroup label="继续保留" keys={retained} />
        <p className="text-xs">按公司整月替换；同公司同月未包含的旧科目也会被替换，文件未包含的公司及月份继续保留。</p>
      </div>
    </div>
  )
}
