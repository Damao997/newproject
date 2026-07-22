export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1'

export const TOKEN_KEY = 'access_token'
export const REFRESH_TOKEN_KEY = 'refresh_token'

export const ROLES = {
  ADMIN: 'admin',
  FINANCE_MANAGER: 'finance_manager',
  DEPARTMENT_MANAGER: 'department_manager',
  VIEWER: 'viewer',
  FINANCE_ANALYST_IT: 'finance_analyst_it',
} as const

export const ROLE_NAMES: Record<string, string> = {
  admin: '管理员',
  finance_manager: '财务主管',
  department_manager: '部门经理',
  viewer: '查看者',
  finance_analyst_it: '财务分析师(兼IT)',
}

export const TEMPLATE_TYPES = {
  OPERATING: 'operating',
  STATIC: 'static',
  BUDGET: 'budget',
} as const

export const TEMPLATE_TYPE_NAMES: Record<string, string> = {
  operating: '经营数据',
  static: '静态数据',
  budget: '年度预算',
}

export const BATCH_STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  ARCHIVED: 'archived',
  PURGED: 'purged',
} as const

export const BATCH_STATUS_NAMES: Record<string, string> = {
  draft: '草稿',
  active: '生效',
  archived: '归档',
  purged: '清除',
}

export const FINANCIAL_COLORS = {
  RED_UP: '#FF3B30',
  GREEN_DOWN: '#34C759',
  BUDGET_ACHIEVED: '#16A34A',
  BUDGET_WARNING: '#F59E0B',
  BUDGET_DEVIATION: '#EF4444',
} as const

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  PAGE_SIZE_OPTIONS: [10, 20, 50, 100],
} as const
