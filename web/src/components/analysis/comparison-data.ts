import type { ReactNode } from 'react'
import type { AnalysisState } from '@/stores/pageStateStore'

export interface ComparisonItem { id: string; label: string; amount: number; budget?: number | null; rate?: number | null; detail?: ReactNode; share?: number | null; expense?: boolean }
export function sortComparisons(items: ComparisonItem[], sort: AnalysisState['sort']) {
  return [...items].sort((a, b) => sort === 'name' ? a.label.localeCompare(b.label, 'zh-CN') : sort === 'gap' ? (a.amount - (a.budget ?? a.amount)) - (b.amount - (b.budget ?? b.amount)) : sort === 'rate' ? (b.rate ?? -Infinity) - (a.rate ?? -Infinity) : b.amount - a.amount)
}
