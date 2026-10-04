import { createContext, useContext } from 'react'
import type { AnalysisState } from '@/stores/pageStateStore'

export const AnalysisContext = createContext<{ state: AnalysisState; companyType?: 'single' | 'summary'; update: (patch: Partial<AnalysisState>) => void } | null>(null)
export const useAnalysisWorkspace = () => useContext(AnalysisContext)
