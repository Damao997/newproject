import { z } from 'zod'
export const preferenceSchema = z.object({
  theme: z.enum(['light', 'gradient', 'dark', 'antd']), showShortName: z.boolean(),
  sidebarCollapsed: z.boolean(), homePath: z.string(), favoriteCompanies: z.array(z.string()),
  companyStartup: z.enum(['remember', 'all', 'fixed']), defaultCompanies: z.array(z.string()),
  periodStartup: z.enum(['remember', 'latest']), indicatorDensity: z.enum(['default', 'dense', 'compact']),
  dashboardKpiMode: z.enum(['month', 'ytd']).default('month'),
})
export type PersonalPreferences = z.infer<typeof preferenceSchema>
export type PreferenceSnapshot = { preferences: PersonalPreferences; revision: number }
export const DEFAULT_PREFERENCES: PersonalPreferences = {
  theme: 'light', showShortName: false, sidebarCollapsed: false, homePath: 'auto',
  favoriteCompanies: [], companyStartup: 'remember', defaultCompanies: [], periodStartup: 'remember', indicatorDensity: 'default',
  dashboardKpiMode: 'month',
}
