export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1'

export const TOKEN_KEY = 'access_token'
export const REFRESH_TOKEN_KEY = 'refresh_token'

export const ROLES = {
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  FINANCE_MANAGER: 'finance_manager',
  DEPARTMENT_MANAGER: 'department_manager',
  VIEWER: 'viewer',
  FINANCE_ANALYST_IT: 'finance_analyst_it',
} as const

export const ROLE_NAMES: Record<string, string> = {
  superadmin: '超级管理员',
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
  PAGE_SIZE_OPTIONS: [20, 50, 100, 200],
} as const

/** 权限码模块段→中文名（权限配置弹窗分组标题） */
export const PERMISSION_MODULE_LABELS: Record<string, string> = {
  dashboard: '首页看板',
  indicators: '财务指标',
  transactions: '往来分析',
  inventory: '存货管理',
  reports: '分析报告',
  data: '数据管理',
  tools: '其他工具',
  admin: '权限管理',
}

/** 权限码→中文名（与 server/prisma/seed.ts 权限主清单对齐，未收录码回退显示原文） */
export const PERMISSION_LABELS: Record<string, string> = {
  'dashboard:view': '查看看板',
  'dashboard:export': '导出看板',
  'indicators:view': '查看财务指标',
  'indicators:export': '导出财务指标',
  'transactions:view': '查看往来数据',
  'transactions:create': '新增往来数据',
  'transactions:update': '编辑往来数据',
  'transactions:delete': '删除往来数据',
  'transactions:import': '导入往来数据',
  'transactions:export': '导出往来数据',
  'inventory:view': '查看存货数据',
  'inventory:create': '新增存货数据',
  'inventory:update': '编辑存货数据',
  'inventory:delete': '删除存货数据',
  'inventory:import': '导入存货数据',
  'inventory:export': '导出存货数据',
  'reports:view': '查看分析报告',
  'reports:create': '新建分析报告',
  'reports:update': '编辑分析报告',
  'reports:delete': '删除分析报告',
  'reports:export': '导出分析报告',
  'data:browse:view': '浏览数据',
  'data:import:upload': '上传导入文件',
  'data:metric:create': '新建指标',
  'data:metric:update': '编辑指标',
  'data:metric:delete': '删除指标',
  'data:company:create': '新建公司',
  'data:company:update': '编辑公司',
  'data:company:delete': '删除公司',
  'data:subject:create': '新建科目',
  'data:subject:update': '编辑科目',
  'data:subject:delete': '删除科目',
  'data:reclassify:company': '公司重分类',
  'data:reclassify:subject': '科目重分类',
  'data:export': '导出数据',
  'data:metric:approve': '指标审批',
  'data:import:archive': '归档导入批次',
  'data:import:purge': '清除导入批次',
  'data:company:purge': '彻底删除公司',
  'data:subject:purge': '彻底删除科目',
  'data:metric:purge': '彻底删除指标',
  'data:metric:convert': '指标类型转换',
  'tools:view': '查看其他工具',
  'admin:users:view': '查看用户',
  'admin:users:create': '新增用户',
  'admin:users:update': '编辑用户',
  'admin:users:delete': '停用用户',
  'admin:users:reset-password': '重置用户密码',
  'admin:users:export': '导出用户',
  'admin:users:purge': '彻底删除用户',
  'admin:roles:view': '查看角色',
  'admin:roles:create': '新增角色',
  'admin:roles:update': '编辑角色',
  'admin:roles:delete': '删除角色',
  'admin:permissions:view': '查看权限配置',
  'admin:permissions:update': '编辑权限配置',
}

/** 审计日志模块→中文名（与后端 recordAudit 的 module 取值对齐） */
export const AUDIT_MODULE_LABELS: Record<string, string> = {
  auth: '认证',
  admin: '权限管理',
  permission: '越权拦截',
  data: '数据管理',
  ai: 'AI 模块',
}

/** 审计日志操作类型→中文名（未收录码回退显示原文） */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  login: '登录',
  login_failed: '登录失败',
  logout: '登出',
  create: '新增',
  update: '更新',
  delete: '删除',
  export: '导出',
  user_create: '创建用户',
  user_disable: '停用用户',
  user_purge: '彻底删除用户',
  role_change: '角色变更',
  permission_change: '权限变更',
  denied: '越权拦截',
  rule_change: '公式规则变更',
}
