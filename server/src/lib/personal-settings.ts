import { z } from 'zod'

export const preferencesSchema = z.object({
  theme: z.enum(['light', 'gradient', 'dark', 'antd']),
  showShortName: z.boolean(),
  sidebarCollapsed: z.boolean(),
  homePath: z.string().max(100),
  favoriteCompanies: z.array(z.string().max(32)).max(200),
  companyStartup: z.enum(['remember', 'all', 'fixed']),
  defaultCompanies: z.array(z.string().max(32)).max(200),
  periodStartup: z.enum(['remember', 'latest']),
  indicatorDensity: z.enum(['default', 'dense', 'compact']),
  dashboardKpiMode: z.enum(['month', 'ytd']).default('month'),
}).strict()
export type PersonalPreferences = z.infer<typeof preferencesSchema>
export const defaultPreferences: PersonalPreferences = {
  theme: 'light', showShortName: false, sidebarCollapsed: false, homePath: 'auto',
  favoriteCompanies: [], companyStartup: 'remember', defaultCompanies: [],
  periodStartup: 'remember', indicatorDensity: 'default',
  dashboardKpiMode: 'month',
}
export const preferencePatchSchema = z.object({
  revision: z.number().int().min(0),
  changes: preferencesSchema.partial(),
}).strict()
const optionalText = (length: number) => z.string().trim().max(length).nullable()
export const profilePatchSchema = z.object({
  name: z.string().trim().min(1, '请输入姓名').max(80, '姓名最多 80 个字').optional(),
  email: z.union([z.string().trim().email('请输入有效邮箱').max(254), z.literal(''), z.null()]).optional(),
  phone: optionalText(32).optional(),
  department: optionalText(80).optional(),
  jobTitle: optionalText(80).optional(),
}).strict()
export const personalHomeRoutes: Record<string, string> = {
  '/dashboard': 'dashboard:view', '/indicators/operating': 'indicators:view',
  '/reports': 'reports:view', '/transactions/overview': 'transactions:view',
  '/inventory': 'inventory:view', '/data/browse': 'data:browse:view',
  '/admin/users': 'admin:users:view',
}
